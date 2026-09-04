/**
 * Phase B5 — Industry & Job APIs verification
 * Run: node tests/verify-b5.mjs  (server must be on :4000)
 *
 * Groups:
 *  1.  Auth enforcement
 *  2.  Industry creation — validation + happy path
 *  3.  Industry duplicate guard
 *  4.  Industry get one + list + search + filters
 *  5.  Industry update (partial PATCH, owner guard)
 *  6.  Industry delete (government soft-delete + cascade)
 *  7.  Job role creation — validation + happy path
 *  8.  Job role get one + list + filters + search
 *  9.  Job role update (partial PATCH, salary guards)
 * 10.  Job descriptions upload + list + delete
 * 11.  Required skills — set, enrich, merge, remove
 * 12.  Job search (cross-field regex)
 * 13.  Job role delete (soft + cascade descriptions)
 * 14.  Industry → jobs sub-route
 * 15.  Deleted visibility (excluded from all reads)
 */

const BASE = 'http://localhost:4000/api'
let pass = 0, fail = 0

function check(label, got, expect) {
  const ok = String(got) === String(expect)
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${ok ? '' : `  got=${JSON.stringify(got)}  expect=${JSON.stringify(expect)}`}`)
  ok ? pass++ : fail++
}

async function httpCode(path, method = 'GET', token = null, body = null) {
  const h = { 'Content-Type': 'application/json' }
  if (token) h.Authorization = `Bearer ${token}`
  try {
    const r = await fetch(`${BASE}${path}`, {
      method, headers: h,
      body: body !== null ? JSON.stringify(body) : undefined,
    })
    return r.status
  } catch { return 0 }
}

async function api(path, method = 'GET', token = null, body = null) {
  const h = { 'Content-Type': 'application/json' }
  if (token) h.Authorization = `Bearer ${token}`
  const r = await fetch(`${BASE}${path}`, {
    method, headers: h,
    body: body !== null ? JSON.stringify(body) : undefined,
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`${r.status} ${path} ${text}`)
  return JSON.parse(text)
}

// ── SETUP ─────────────────────────────────────────────────────────────────────
console.log('\n[SETUP] Registering test accounts...')
const ts = Date.now()
const { token: tI }  = await api('/auth/register', 'POST', null, { name: 'Ind',     email: `ind_b5_${ts}@t.com`, password: 'pass1234', role: 'industry' })
const { token: tI2 } = await api('/auth/register', 'POST', null, { name: 'Ind2',    email: `ind2_b5_${ts}@t.com`, password: 'pass1234', role: 'industry' })
const { token: tG }  = await api('/auth/register', 'POST', null, { name: 'Govt',    email: `gov_b5_${ts}@t.com`, password: 'pass1234', role: 'government' })
const { token: tL }  = await api('/auth/register', 'POST', null, { name: 'Learner', email: `lrn_b5_${ts}@t.com`, password: 'pass1234', role: 'learner' })

// Create a canonical skill to use in job skill tests
const sk = await api('/skills', 'POST', tI, {
  name: `React ${ts}`, category: 'Frontend', type: 'technical',
  aliases: [`reactjs-${ts}`], tags: ['frontend', 'javascript'],
})
const skillId = sk.skill.id
console.log(`  Tokens ready. Skill created: ${sk.skill.name}`)

// ─────────────────────────────────────────────────────────────────────────────
// 1. AUTH ENFORCEMENT
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[1] AUTH ENFORCEMENT')
check('POST /industries no token → 401',           await httpCode('/industries', 'POST'), 401)
check('PATCH /industries/:id no token → 401',      await httpCode('/industries/fake', 'PATCH'), 401)
check('DELETE /industries/:id no token → 401',     await httpCode('/industries/fake', 'DELETE'), 401)
check('POST /jobs no token → 401',                 await httpCode('/jobs', 'POST'), 401)
check('PATCH /jobs/:id no token → 401',            await httpCode('/jobs/fake', 'PATCH'), 401)
check('DELETE /jobs/:id no token → 401',           await httpCode('/jobs/fake', 'DELETE'), 401)
check('POST /jobs/:id/descriptions no token → 401',await httpCode('/jobs/fake/descriptions', 'POST'), 401)
check('POST /jobs/:id/skills no token → 401',      await httpCode('/jobs/fake/skills', 'POST'), 401)

// Learner cannot write
check('POST /industries learner → 403',            await httpCode('/industries', 'POST', tL, { name: 'x', sector: 'Technology' }), 403)
check('POST /jobs learner → 403',                  await httpCode('/jobs', 'POST', tL, { industryId: 'x', title: 'y' }), 403)

// Industry cannot delete another user's industry (owner guard tested in §5)
// Government-only delete enforced (industry tries to delete)
check('DELETE /industries learner → 403',          await httpCode('/industries/fake', 'DELETE', tL), 403)

// ─────────────────────────────────────────────────────────────────────────────
// 2. INDUSTRY CREATION — validation + happy path
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[2] INDUSTRY CREATION')
check('Missing name → 400',       await httpCode('/industries', 'POST', tI, { sector: 'Technology' }), 400)
check('Missing sector → 400',     await httpCode('/industries', 'POST', tI, { name: 'X' }), 400)
check('Bad sector → 400',         await httpCode('/industries', 'POST', tI, { name: 'X', sector: 'Unicorn' }), 400)
check('Bad companySize → 400',    await httpCode('/industries', 'POST', tI, { name: 'X', sector: 'Technology', companySize: 'huge' }), 400)
check('Bad contactEmail → 400',   await httpCode('/industries', 'POST', tI, { name: 'X', sector: 'Technology', contactEmail: 'bad' }), 400)
check('Bad employeeCount → 400',  await httpCode('/industries', 'POST', tI, { name: 'X', sector: 'Technology', employeeCount: -5 }), 400)

const ind1 = await api('/industries', 'POST', tI, {
  name: `Tata Digital ${ts}`, sector: 'Technology',
  description: 'Digital transformation company.',
  companySize: '1000+', headquarters: 'Mumbai',
  operatingRegions: ['Pune', 'Mumbai', 'Nagpur'],
  website: 'https://tata.com', contactEmail: `hr_${ts}@tata.com`,
  employeeCount: 5000,
})
check('ind1 created id',              !!ind1.industry.id,                       true)
check('ind1 name',                    ind1.industry.name,                       `Tata Digital ${ts}`)
check('ind1 sector',                  ind1.industry.sector,                     'Technology')
check('ind1 companySize',             ind1.industry.companySize,                '1000+')
check('ind1 regions count',           ind1.industry.operatingRegions.length,    3)
check('ind1 employeeCount',           ind1.industry.employeeCount,              5000)
check('ind1 isDeleted false',         ind1.industry.isDeleted,                  false)
check('ind1 createdAt present',       !!ind1.industry.createdAt,                true)
check('ind1 createdBy present',       !!ind1.industry.createdBy,                true)

// Second industry for cross-owner tests
const ind2 = await api('/industries', 'POST', tI2, {
  name: `Infosys ${ts}`, sector: 'Technology', companySize: '1000+',
  headquarters: 'Bangalore', operatingRegions: ['Hyderabad', 'Pune'],
})
check('ind2 created',                 !!ind2.industry.id,                       true)

// Government can also create
const ind3 = await api('/industries', 'POST', tG, {
  name: `MH Govt Corp ${ts}`, sector: 'Government', companySize: '1000+',
  headquarters: 'Pune', operatingRegions: ['Pune'],
})
check('ind3 created by govt',         !!ind3.industry.id,                       true)

// ─────────────────────────────────────────────────────────────────────────────
// 3. INDUSTRY DUPLICATE GUARD
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[3] INDUSTRY DUPLICATE GUARD')
check('Duplicate name → 409',
  await httpCode('/industries', 'POST', tI, { name: `Tata Digital ${ts}`, sector: 'Technology' }), 409)

// ─────────────────────────────────────────────────────────────────────────────
// 4. INDUSTRY GET / LIST / SEARCH / FILTERS
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[4] INDUSTRY GET / LIST / SEARCH')

// GET one
const fetched = await api(`/industries/${ind1.industry.id}`)
check('GET industry id',              fetched.industry.id,                      ind1.industry.id)
check('GET industry name',            fetched.industry.name,                    ind1.industry.name)
check('GET industry description',     fetched.industry.description,             'Digital transformation company.')
check('GET non-existent → 404',       await httpCode('/industries/00000000-0000-0000-0000-000000000000'), 404)

// LIST
const listAll = await api('/industries?limit=100')
check('List array present',           Array.isArray(listAll.industries),        true)
check('List pagination present',      !!listAll.pagination,                     true)
check('List total >= 3',              listAll.pagination.total >= 3,            true)

// Filter by sector
const listTech = await api('/industries?sector=Technology&limit=50')
check('Filter sector=Technology has ind1', listTech.industries.map(i=>i.id).includes(ind1.industry.id), true)
check('Filter sector=Technology has ind2', listTech.industries.map(i=>i.id).includes(ind2.industry.id), true)

// Filter by region
const listPune = await api('/industries?region=Pune&limit=50')
check('Filter region=Pune includes ind1',  listPune.industries.map(i=>i.id).includes(ind1.industry.id), true)

// Pagination
const p1 = await api('/industries?limit=1&page=1')
const p2 = await api('/industries?limit=1&page=2')
check('Page 1 has 1 result',          p1.industries.length,                     1)
check('Pages differ',                 p1.industries[0]?.id !== p2.industries[0]?.id, true)

// SEARCH
check('Search missing q → 400',       await httpCode('/industries/search'), 400)
const srch = await api(`/industries/search?q=Tata+Digital+${ts}`)
check('Search finds ind1',            srch.industries.map(i=>i.id).includes(ind1.industry.id), true)
check('Search count >= 1',            srch.count >= 1,                          true)

// ─────────────────────────────────────────────────────────────────────────────
// 5. INDUSTRY UPDATE
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[5] INDUSTRY UPDATE')

check('PATCH empty body → 400',
  await httpCode(`/industries/${ind1.industry.id}`, 'PATCH', tI, {}), 400)
check('PATCH bad sector → 400',
  await httpCode(`/industries/${ind1.industry.id}`, 'PATCH', tI, { sector: 'Unicorn' }), 400)
check('PATCH bad email → 400',
  await httpCode(`/industries/${ind1.industry.id}`, 'PATCH', tI, { contactEmail: 'bad' }), 400)

// Owner guard: tI2 cannot update ind1
check('PATCH other owner → 403',
  await httpCode(`/industries/${ind1.industry.id}`, 'PATCH', tI2, { description: 'hack' }), 403)

// Government can update any
const govUpd = await api(`/industries/${ind1.industry.id}`, 'PATCH', tG, { description: 'Updated by govt', employeeCount: 6000 })
check('Govt PATCH description',       govUpd.industry.description,              'Updated by govt')
check('Govt PATCH employeeCount',     govUpd.industry.employeeCount,            6000)
check('Govt PATCH name preserved',    govUpd.industry.name,                     ind1.industry.name)

// Owner update
const ownUpd = await api(`/industries/${ind1.industry.id}`, 'PATCH', tI, { headquarters: 'Delhi' })
check('Owner PATCH headquarters',     ownUpd.industry.headquarters,             'Delhi')
check('Owner PATCH updatedAt',        !!ownUpd.industry.updatedAt,              true)

// PATCH non-existent
check('PATCH non-existent → 404',
  await httpCode('/industries/00000000-0000-0000-0000-000000000000', 'PATCH', tI, { description: 'x' }), 404)

// ─────────────────────────────────────────────────────────────────────────────
// 7. JOB ROLE CREATION — validation + happy path
// (§6 industry delete done last to avoid cascade affecting later tests)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[7] JOB ROLE CREATION')

check('Missing industryId → 400',     await httpCode('/jobs', 'POST', tI, { title: 'Dev' }), 400)
check('Missing title → 400',          await httpCode('/jobs', 'POST', tI, { industryId: ind1.industry.id }), 400)
check('Bad status → 400',             await httpCode('/jobs', 'POST', tI, { industryId: ind1.industry.id, title: 'Dev', status: 'pending' }), 400)
check('Bad employmentType → 400',     await httpCode('/jobs', 'POST', tI, { industryId: ind1.industry.id, title: 'Dev', employmentType: 'gig' }), 400)
check('Bad workMode → 400',           await httpCode('/jobs', 'POST', tI, { industryId: ind1.industry.id, title: 'Dev', workMode: 'space' }), 400)
check('salaryMax < salaryMin → 400',  await httpCode('/jobs', 'POST', tI, { industryId: ind1.industry.id, title: 'Dev', salaryMin: 100, salaryMax: 50 }), 400)
check('Non-existent industryId → 404',await httpCode('/jobs', 'POST', tI, { industryId: '00000000-0000-0000-0000-000000000000', title: 'Dev' }), 404)
check('tags not array → 400',         await httpCode('/jobs', 'POST', tI, { industryId: ind1.industry.id, title: 'Dev', tags: 'ai' }), 400)
check('requiredSkills not array → 400',await httpCode('/jobs', 'POST', tI, { industryId: ind1.industry.id, title: 'Dev', requiredSkills: 'react' }), 400)

const job1 = await api('/jobs', 'POST', tI, {
  industryId: ind1.industry.id,
  title: `Senior React Developer ${ts}`,
  description: 'Build scalable React applications.',
  status: 'active', employmentType: 'full-time', workMode: 'hybrid',
  location: 'Pune', salaryMin: 800000, salaryMax: 1500000,
  salaryCurrency: 'INR', experienceYears: 3,
  tags: ['react', 'frontend', 'javascript'],
  requiredSkills: [
    { skillId: skillId, skillName: `React ${ts}`, level: 'advanced', requirement: 'required' },
    { skillName: 'TypeScript', level: 'intermediate', requirement: 'preferred' },
  ],
})
check('job1 id present',              !!job1.jobRole.id,                        true)
check('job1 title',                   job1.jobRole.title,                       `Senior React Developer ${ts}`)
check('job1 status',                  job1.jobRole.status,                      'active')
check('job1 employmentType',          job1.jobRole.employmentType,              'full-time')
check('job1 workMode',                job1.jobRole.workMode,                    'hybrid')
check('job1 salaryMin',               job1.jobRole.salaryMin,                   800000)
check('job1 salaryMax',               job1.jobRole.salaryMax,                   1500000)
check('job1 experienceYears',         job1.jobRole.experienceYears,             3)
check('job1 tags count',              job1.jobRole.tags.length,                 3)
check('job1 requiredSkills count',    job1.jobRole.requiredSkills.length,       2)
check('job1 skill skillId linked',    job1.jobRole.requiredSkills[0].skillId,   skillId)
check('job1 isDeleted false',         job1.jobRole.isDeleted,                   false)
check('job1 industryId',              job1.jobRole.industryId,                  ind1.industry.id)

// Bad skillId in requiredSkills
check('Bad skillId in requiredSkills → 400',
  await httpCode('/jobs', 'POST', tI, {
    industryId: ind1.industry.id, title: 'Dev',
    requiredSkills: [{ skillId: '00000000-0000-0000-0000-000000000000', skillName: 'X' }],
  }), 400)

const job2 = await api('/jobs', 'POST', tI, {
  industryId: ind1.industry.id,
  title: `Backend Engineer ${ts}`,
  description: 'Node.js backend development.',
  status: 'active', employmentType: 'full-time', workMode: 'remote',
  location: 'Mumbai', salaryMin: 700000, salaryMax: 1200000,
  tags: ['nodejs', 'backend'], experienceYears: 2,
  requiredSkills: [{ skillName: 'Node.js', level: 'advanced', requirement: 'required' }],
})
check('job2 created',                 !!job2.jobRole.id,                        true)

const job3 = await api('/jobs', 'POST', tG, {
  industryId: ind2.industry.id,
  title: `Data Scientist ${ts}`, description: 'ML and data analysis.',
  status: 'active', employmentType: 'full-time', workMode: 'onsite',
  location: 'Hyderabad', tags: ['python', 'ml', 'data'],
  requiredSkills: [{ skillName: 'Python', level: 'expert', requirement: 'required' }],
})
check('job3 created by govt',         !!job3.jobRole.id,                        true)

// ─────────────────────────────────────────────────────────────────────────────
// 8. JOB ROLE GET / LIST / FILTERS
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[8] JOB ROLE GET / LIST / FILTERS')

const gotJob = await api(`/jobs/${job1.jobRole.id}`)
check('GET job id',                   gotJob.jobRole.id,                        job1.jobRole.id)
check('GET job title',                gotJob.jobRole.title,                     job1.jobRole.title)
check('GET non-existent → 404',       await httpCode('/jobs/00000000-0000-0000-0000-000000000000'), 404)

const listJobs = await api('/jobs?limit=100')
check('List jobs array',              Array.isArray(listJobs.jobRoles),         true)
check('List total >= 3',              listJobs.pagination.total >= 3,           true)

// Filter by industryId
const listByInd = await api(`/jobs?industryId=${ind1.industry.id}&limit=50`)
const byIndIds   = listByInd.jobRoles.map(j => j.id)
check('Filter industryId has job1',   byIndIds.includes(job1.jobRole.id),       true)
check('Filter industryId has job2',   byIndIds.includes(job2.jobRole.id),       true)
check('Filter industryId excl job3',  !byIndIds.includes(job3.jobRole.id),      true)

// Filter by status
const listActive = await api('/jobs?status=active&limit=50')
check('Filter status=active includes job1', listActive.jobRoles.map(j=>j.id).includes(job1.jobRole.id), true)

// Filter by workMode
const listRemote = await api('/jobs?workMode=remote&limit=50')
check('Filter workMode=remote has job2', listRemote.jobRoles.map(j=>j.id).includes(job2.jobRole.id), true)

// Filter by employmentType
const listFT = await api('/jobs?employmentType=full-time&limit=50')
check('Filter full-time has job1',    listFT.jobRoles.map(j=>j.id).includes(job1.jobRole.id), true)

// ─────────────────────────────────────────────────────────────────────────────
// 9. JOB ROLE UPDATE
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[9] JOB ROLE UPDATE')

check('PATCH job empty body → 400',   await httpCode(`/jobs/${job1.jobRole.id}`, 'PATCH', tI, {}), 400)
check('PATCH job bad status → 400',   await httpCode(`/jobs/${job1.jobRole.id}`, 'PATCH', tI, { status: 'pending' }), 400)
check('PATCH salaryMax < min → 400',  await httpCode(`/jobs/${job1.jobRole.id}`, 'PATCH', tI, { salaryMax: 100 }), 400)

// Owner guard: tI2 cannot update job1 (owned by tI)
check('PATCH other owner job → 403',  await httpCode(`/jobs/${job1.jobRole.id}`, 'PATCH', tI2, { description: 'hack' }), 403)

const updJob = await api(`/jobs/${job1.jobRole.id}`, 'PATCH', tI, {
  status: 'paused', description: 'Updated description.', salaryMax: 1800000,
})
check('Update status',                updJob.jobRole.status,                    'paused')
check('Update description',           updJob.jobRole.description,               'Updated description.')
check('Update salaryMax',             updJob.jobRole.salaryMax,                 1800000)
check('Update salaryMin preserved',   updJob.jobRole.salaryMin,                 800000)
check('Update title preserved',       updJob.jobRole.title,                     job1.jobRole.title)
check('Update tags preserved',        updJob.jobRole.tags.length,               3)

// Government can update any job
const govJobUpd = await api(`/jobs/${job3.jobRole.id}`, 'PATCH', tG, { location: 'Pune' })
check('Govt update job location',     govJobUpd.jobRole.location,               'Pune')

// ─────────────────────────────────────────────────────────────────────────────
// 10. JOB DESCRIPTIONS
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[10] JOB DESCRIPTIONS')

check('Upload missing content → 400', await httpCode(`/jobs/${job1.jobRole.id}/descriptions`, 'POST', tI, { source: 'manual' }), 400)
check('Upload bad source → 400',      await httpCode(`/jobs/${job1.jobRole.id}/descriptions`, 'POST', tI, { content: 'x', source: 'magic' }), 400)

// Other owner cannot upload
check('Upload other owner → 403',     await httpCode(`/jobs/${job1.jobRole.id}/descriptions`, 'POST', tI2, { content: 'x' }), 403)

const desc1 = await api(`/jobs/${job1.jobRole.id}/descriptions`, 'POST', tI, {
  content: `We are looking for a Senior React Developer with ${ts} experience in hooks and Redux.
  The candidate must have strong TypeScript skills and experience with testing frameworks.`,
  source: 'manual', rawTitle: 'Senior React Dev JD', notes: 'Approved by HR',
})
check('desc1 id present',             !!desc1.description.id,                   true)
check('desc1 jobRoleId',              desc1.description.jobRoleId,              job1.jobRole.id)
check('desc1 source',                 desc1.description.source,                 'manual')
check('desc1 wordCount > 0',          desc1.description.wordCount > 0,          true)
check('desc1 rawTitle',               desc1.description.rawTitle,               'Senior React Dev JD')
check('desc1 uploadedBy',             !!desc1.description.uploadedBy,           true)

const desc2 = await api(`/jobs/${job1.jobRole.id}/descriptions`, 'POST', tI, {
  content: `Second version of the JD for React Developer role ${ts}.`, source: 'upload',
})
check('desc2 created',                !!desc2.description.id,                   true)

// GET descriptions list
const descList = await api(`/jobs/${job1.jobRole.id}/descriptions`)
check('Descriptions array',           Array.isArray(descList.descriptions),     true)
check('Descriptions count = 2',       descList.descriptions.length,             2)
check('Descriptions pagination',      !!descList.pagination,                    true)

// DELETE a description
const delDesc = await api(`/jobs/${job1.jobRole.id}/descriptions/${desc2.description.id}`, 'DELETE', tI)
check('Delete desc message',          delDesc.message,                          'Job description deleted')

const descAfterDel = await api(`/jobs/${job1.jobRole.id}/descriptions`)
check('After delete, count = 1',      descAfterDel.descriptions.length,         1)

// Delete non-existent description
check('Delete non-existent desc → 404',
  await httpCode(`/jobs/${job1.jobRole.id}/descriptions/00000000-0000-0000-0000-000000000000`, 'DELETE', tI), 404)

// ─────────────────────────────────────────────────────────────────────────────
// 11. REQUIRED SKILLS
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[11] REQUIRED SKILLS')

check('Skills not array → 400',       await httpCode(`/jobs/${job1.jobRole.id}/skills`, 'POST', tI, { skills: 'react' }), 400)
check('Skills empty array → 400',     await httpCode(`/jobs/${job1.jobRole.id}/skills`, 'POST', tI, { skills: [] }), 400)
check('Skills missing skillName → 400',
  await httpCode(`/jobs/${job1.jobRole.id}/skills`, 'POST', tI, { skills: [{ level: 'advanced' }] }), 400)
check('Skills bad level → 400',
  await httpCode(`/jobs/${job1.jobRole.id}/skills`, 'POST', tI, { skills: [{ skillName: 'X', level: 'god' }] }), 400)
check('Skills bad requirement → 400',
  await httpCode(`/jobs/${job1.jobRole.id}/skills`, 'POST', tI, { skills: [{ skillName: 'X', requirement: 'mandatory' }] }), 400)
check('Skills non-existent skillId → 400',
  await httpCode(`/jobs/${job1.jobRole.id}/skills`, 'POST', tI, {
    skills: [{ skillId: '00000000-0000-0000-0000-000000000000', skillName: 'X' }],
  }), 400)

// Add new skills (merges with existing)
const addedSkills = await api(`/jobs/${job1.jobRole.id}/skills`, 'POST', tI, {
  skills: [
    { skillName: 'GraphQL', level: 'intermediate', requirement: 'preferred' },
    { skillName: 'Jest', level: 'beginner', requirement: 'nice-to-have' },
  ],
})
check('After add, skills count = 4',  addedSkills.jobRole.requiredSkills.length, 4)

// Upsert: updating existing skill by skillName
const upserted = await api(`/jobs/${job1.jobRole.id}/skills`, 'POST', tI, {
  skills: [{ skillName: 'TypeScript', level: 'advanced', requirement: 'required' }],
})
check('Upsert: still 4 skills',       upserted.jobRole.requiredSkills.length,   4)
const tsSkill = upserted.jobRole.requiredSkills.find(s => s.skillName === 'TypeScript')
check('Upsert: TypeScript level → advanced', tsSkill?.level,                    'advanced')
check('Upsert: TypeScript req → required',   tsSkill?.requirement,              'required')

// GET skills (enriched)
const skillsRes = await api(`/jobs/${job1.jobRole.id}/skills`)
check('GET skills array',             Array.isArray(skillsRes.requiredSkills),   true)
check('GET skills count',             skillsRes.count,                           4)
const enriched = skillsRes.requiredSkills.find(s => s.skillId === skillId)
check('Enriched skill has skillDetails', !!enriched?.skillDetails,              true)
check('Enriched skill category',      enriched?.skillDetails?.category,         'Frontend')

// Remove skill by name
const afterRemove = await api(`/jobs/${job1.jobRole.id}/skills/GraphQL`, 'DELETE', tI)
check('After remove GraphQL, count = 3', afterRemove.jobRole.requiredSkills.length, 3)

// Remove non-existent skill
check('Remove non-existent skill → 404',
  await httpCode(`/jobs/${job1.jobRole.id}/skills/DoesNotExist`, 'DELETE', tI), 404)

// ─────────────────────────────────────────────────────────────────────────────
// 12. JOB SEARCH
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[12] JOB SEARCH')

check('Search missing q → 400',       await httpCode('/jobs/search'), 400)

// Search by title — job1 was paused in §9, search without status filter
const srchTitle = await api(`/jobs/search?q=React+Developer+${ts}&status=paused`)
check('Search by title finds job1',   srchTitle.jobRoles.map(j=>j.id).includes(job1.jobRole.id), true)

// Search by skill name
const srchSkill = await api(`/jobs/search?q=Node.js`)
check('Search by skill name finds job2', srchSkill.jobRoles.map(j=>j.id).includes(job2.jobRole.id), true)

// Search by tag
const srchTag = await api(`/jobs/search?q=nodejs`)
check('Search by tag finds job2',     srchTag.jobRoles.map(j=>j.id).includes(job2.jobRole.id), true)

// Search filtered by industryId — use paused status to find job1, active for job2
const srchJ1 = await api(`/jobs/search?q=${ts}&industryId=${ind1.industry.id}&status=paused`)
const srchJ2 = await api(`/jobs/search?q=${ts}&industryId=${ind1.industry.id}&status=active`)
const filtIds = [...srchJ1.jobRoles.map(j=>j.id), ...srchJ2.jobRoles.map(j=>j.id)]
check('Search+filter has job1',       filtIds.includes(job1.jobRole.id),        true)
check('Search+filter has job2',       filtIds.includes(job2.jobRole.id),        true)
check('Search+filter excl job3',      !filtIds.includes(job3.jobRole.id),       true)

// ─────────────────────────────────────────────────────────────────────────────
// 14. INDUSTRY → JOBS SUB-ROUTE
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[14] INDUSTRY JOBS SUB-ROUTE')

const indJobs = await api(`/industries/${ind1.industry.id}/jobs`)
check('Industry jobs array',          Array.isArray(indJobs.jobRoles),          true)
check('Industry jobs includes job1',  indJobs.jobRoles.map(j=>j.id).includes(job1.jobRole.id), true)
check('Industry jobs includes job2',  indJobs.jobRoles.map(j=>j.id).includes(job2.jobRole.id), true)
check('Industry jobs excl job3',      !indJobs.jobRoles.map(j=>j.id).includes(job3.jobRole.id), true)
check('Industry jobs pagination',     !!indJobs.pagination,                     true)

// Non-existent industry jobs
check('Jobs for non-existent ind → 404',
  await httpCode('/industries/00000000-0000-0000-0000-000000000000/jobs'), 404)

// ─────────────────────────────────────────────────────────────────────────────
// 13. JOB ROLE DELETE (soft + cascade)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[13] JOB ROLE DELETE')

// Other owner cannot delete
check('Delete other owner job → 403', await httpCode(`/jobs/${job2.jobRole.id}`, 'DELETE', tI2), 403)

// Owner can delete their own
const delJob2 = await api(`/jobs/${job2.jobRole.id}`, 'DELETE', tI)
check('Delete job2 message',          delJob2.message,                          'Job role deleted')

check('Deleted job2 → 404',           await httpCode(`/jobs/${job2.jobRole.id}`), 404)

// Add a description to job3, delete job3, verify cascade
await api(`/jobs/${job3.jobRole.id}/descriptions`, 'POST', tG, { content: 'Data Scientist JD content.', source: 'manual' })
const j3DescBefore = await api(`/jobs/${job3.jobRole.id}/descriptions`)
check('job3 has 1 description',       j3DescBefore.descriptions.length,         1)
const j3DescId = j3DescBefore.descriptions[0].id

await api(`/jobs/${job3.jobRole.id}`, 'DELETE', tG)
check('job3 deleted → 404',           await httpCode(`/jobs/${job3.jobRole.id}`), 404)

// Cascade: description should be soft-deleted (not findable via job descriptions endpoint — job role 404)
check('Cascade: job3 descriptions → job 404', await httpCode(`/jobs/${job3.jobRole.id}/descriptions`), 404)

// ─────────────────────────────────────────────────────────────────────────────
// 6. INDUSTRY DELETE (government only, cascade to jobs + descriptions)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[6] INDUSTRY DELETE')

// Industry user cannot delete
check('Industry user DELETE → 403',   await httpCode(`/industries/${ind2.industry.id}`, 'DELETE', tI2), 403)

// Create a job under ind2 to verify cascade
const jobUnderInd2 = await api('/jobs', 'POST', tI2, {
  industryId: ind2.industry.id, title: `Cascade Test Job ${ts}`,
  description: 'Test job for cascade delete.', status: 'active',
})
check('Cascade job created',          !!jobUnderInd2.jobRole.id,                true)

// Government deletes ind2
const delInd = await api(`/industries/${ind2.industry.id}`, 'DELETE', tG)
check('Delete ind2 message ok',       delInd.message.includes('deleted'),       true)
check('Delete returns id',            delInd.id,                                ind2.industry.id)

// Verify soft-delete
check('Deleted ind2 → 404',           await httpCode(`/industries/${ind2.industry.id}`), 404)

// Cascade: job under ind2 should be gone
check('Cascade job → 404',            await httpCode(`/jobs/${jobUnderInd2.jobRole.id}`), 404)

// Delete non-existent
check('Delete non-existent ind → 404',
  await httpCode('/industries/00000000-0000-0000-0000-000000000000', 'DELETE', tG), 404)

// Re-delete already deleted
check('Re-delete ind → 404',          await httpCode(`/industries/${ind2.industry.id}`, 'DELETE', tG), 404)

// ─────────────────────────────────────────────────────────────────────────────
// 15. DELETED VISIBILITY
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[15] DELETED VISIBILITY')

const listAfter = await api('/industries?limit=100')
check('Deleted ind2 absent from list',
  !listAfter.industries.map(i=>i.id).includes(ind2.industry.id), true)

const srchAfter = await api(`/industries/search?q=Infosys+${ts}`)
check('Deleted ind2 absent from search',
  !srchAfter.industries.map(i=>i.id).includes(ind2.industry.id), true)

const jobListAfter = await api('/jobs?limit=100')
const jobIds = jobListAfter.jobRoles.map(j => j.id)
check('Deleted job2 absent from jobs list',        !jobIds.includes(job2.jobRole.id), true)
check('Cascade jobUnderInd2 absent from jobs list',!jobIds.includes(jobUnderInd2.jobRole.id), true)

const jobSrchAfter = await api(`/jobs/search?q=Cascade+Test+Job+${ts}`)
check('Cascade job absent from job search', !jobSrchAfter.jobRoles.map(j=>j.id).includes(jobUnderInd2.jobRole.id), true)

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────
const total = pass + fail
console.log(`\n${'─'.repeat(52)}`)
console.log(`  TOTAL  ${total}   PASS  ${pass}   FAIL  ${fail}`)
console.log('─'.repeat(52))
if (fail > 0) process.exit(1)
