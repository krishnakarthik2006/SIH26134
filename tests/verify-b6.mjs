/**
 * Phase B6 — Training Provider & Curriculum APIs verification
 * Run: node tests/verify-b6.mjs  (server must be on :4000)
 *
 * Groups:
 *  1.  Auth enforcement
 *  2.  Provider creation — validation + happy path
 *  3.  Provider duplicate guard
 *  4.  Provider get / list / search / filters
 *  5.  Provider update (partial PATCH, owner guard)
 *  6.  Program creation — validation + happy path
 *  7.  Program get / list / search / filters
 *  8.  Program update
 *  9.  Provider → programs sub-route
 * 10.  Curriculum creation — validation + upload
 * 11.  Curriculum get (full detail)
 * 12.  Curriculum update (metadata)
 * 13.  Curriculum modules — add, update, delete
 * 14.  Curriculum skills covered — set, upsert, remove
 * 15.  Program → curriculums sub-route
 * 16.  Program delete (soft + cascade curriculums)
 * 17.  Provider delete (government only, cascade programs + curriculums)
 * 18.  Deleted visibility
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
  if (!r.ok) throw new Error(`${r.status} ${path} — ${text}`)
  return JSON.parse(text)
}

// ── SETUP ────────────────────────────────────────────────────────────────────
console.log('\n[SETUP] Registering test accounts...')
const ts = Date.now()
const { token: tT }  = await api('/auth/register', 'POST', null, { name: 'Trainer',  email: `tr_b6_${ts}@t.com`, password: 'pass1234', role: 'training' })
const { token: tT2 } = await api('/auth/register', 'POST', null, { name: 'Trainer2', email: `tr2_b6_${ts}@t.com`, password: 'pass1234', role: 'training' })
const { token: tG }  = await api('/auth/register', 'POST', null, { name: 'Govt',     email: `gov_b6_${ts}@t.com`, password: 'pass1234', role: 'government' })
const { token: tL }  = await api('/auth/register', 'POST', null, { name: 'Learner',  email: `lrn_b6_${ts}@t.com`, password: 'pass1234', role: 'learner' })

// Create a canonical skill to use in skillsCovered tests
const sk = await api('/skills', 'POST', tG, {
  name: `Python B6 ${ts}`, category: 'Programming', type: 'technical',
  tags: ['python', 'backend'], demandScore: 85,
})
const skillId = sk.skill.id
console.log(`  Tokens ready. Canonical skill: ${sk.skill.name} (${skillId})`)

// ─────────────────────────────────────────────────────────────────────────────
// 1. AUTH ENFORCEMENT
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[1] AUTH ENFORCEMENT')
check('POST /training/providers no token → 401',            await httpCode('/training/providers', 'POST'), 401)
check('PATCH /training/providers/:id no token → 401',       await httpCode('/training/providers/fake', 'PATCH'), 401)
check('DELETE /training/providers/:id no token → 401',      await httpCode('/training/providers/fake', 'DELETE'), 401)
check('POST /training/programs no token → 401',             await httpCode('/training/programs', 'POST'), 401)
check('PATCH /training/programs/:id no token → 401',        await httpCode('/training/programs/fake', 'PATCH'), 401)
check('DELETE /training/programs/:id no token → 401',       await httpCode('/training/programs/fake', 'DELETE'), 401)
check('POST /training/curriculums no token → 401',          await httpCode('/training/curriculums', 'POST'), 401)
check('PATCH /training/curriculums/:id no token → 401',     await httpCode('/training/curriculums/fake', 'PATCH'), 401)
check('POST /training/curriculums/:id/modules no token → 401', await httpCode('/training/curriculums/fake/modules', 'POST'), 401)
check('POST /training/curriculums/:id/skills no token → 401',  await httpCode('/training/curriculums/fake/skills', 'POST'), 401)

// Learner cannot write
check('POST /training/providers learner → 403',   await httpCode('/training/providers', 'POST', tL, { name: 'x', type: 'College' }), 403)
check('POST /training/programs learner → 403',    await httpCode('/training/programs',  'POST', tL, { providerId: 'x', name: 'y' }), 403)
check('POST /training/curriculums learner → 403', await httpCode('/training/curriculums', 'POST', tL, { trainingProgramId: 'x', title: 'y' }), 403)

// Training cannot delete provider (government only)
check('DELETE /training/providers training → 403', await httpCode('/training/providers/fake', 'DELETE', tT), 403)

// Public GET routes work without auth
check('GET /training/providers public → 200',  await httpCode('/training/providers'), 200)
check('GET /training/programs public → 200',   await httpCode('/training/programs'), 200)

// ─────────────────────────────────────────────────────────────────────────────
// 2. PROVIDER CREATION — validation + happy path
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[2] PROVIDER CREATION')
check('Missing name → 400',        await httpCode('/training/providers', 'POST', tT, { type: 'College' }), 400)
check('Missing type → 400',        await httpCode('/training/providers', 'POST', tT, { name: 'X' }), 400)
check('Bad type → 400',            await httpCode('/training/providers', 'POST', tT, { name: 'X', type: 'Academy' }), 400)
check('Bad contactEmail → 400',    await httpCode('/training/providers', 'POST', tT, { name: 'X', type: 'College', contactEmail: 'bad' }), 400)
check('focusAreas not array → 400',await httpCode('/training/providers', 'POST', tT, { name: 'X', type: 'College', focusAreas: 'AI' }), 400)

const prov1 = await api('/training/providers', 'POST', tT, {
  name: `Pune Tech Academy ${ts}`, type: 'Institute',
  district: 'Pune', region: 'Western Maharashtra',
  accreditation: 'NAAC A+', affiliatedUniversity: 'SPPU',
  website: 'https://pta.edu', contactEmail: `info_${ts}@pta.edu`,
  contactPhone: '020-12345678', description: 'Premier tech training institute.',
  focusAreas: ['AI', 'Cloud Computing', 'Data Science'],
})
check('prov1 id',           !!prov1.provider.id,                       true)
check('prov1 name',         prov1.provider.name,                       `Pune Tech Academy ${ts}`)
check('prov1 type',         prov1.provider.type,                       'Institute')
check('prov1 district',     prov1.provider.district,                   'Pune')
check('prov1 accreditation',prov1.provider.accreditation,              'NAAC A+')
check('prov1 focusAreas',   prov1.provider.focusAreas.length,          3)
check('prov1 isDeleted',    prov1.provider.isDeleted,                  false)
check('prov1 createdBy',    !!prov1.provider.createdBy,                true)
check('prov1 createdAt',    !!prov1.provider.createdAt,                true)

const prov2 = await api('/training/providers', 'POST', tT2, {
  name: `Mumbai Skills Hub ${ts}`, type: 'Corporate',
  district: 'Mumbai', region: 'Konkan',
  focusAreas: ['FinTech', 'Cybersecurity'],
})
check('prov2 created',      !!prov2.provider.id,                       true)

const prov3 = await api('/training/providers', 'POST', tG, {
  name: `Nagpur Polytechnic ${ts}`, type: 'Polytechnic',
  district: 'Nagpur', region: 'Vidarbha',
  focusAreas: ['Electronics', 'Mechanical'],
})
check('prov3 created by govt', !!prov3.provider.id,                    true)

// ─────────────────────────────────────────────────────────────────────────────
// 3. PROVIDER DUPLICATE GUARD
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[3] PROVIDER DUPLICATE GUARD')
check('Duplicate name → 409',
  await httpCode('/training/providers', 'POST', tT, { name: `Pune Tech Academy ${ts}`, type: 'College' }), 409)

// ─────────────────────────────────────────────────────────────────────────────
// 4. PROVIDER GET / LIST / SEARCH / FILTERS
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[4] PROVIDER GET / LIST / SEARCH')

const fetchedProv = await api(`/training/providers/${prov1.provider.id}`)
check('GET provider id',          fetchedProv.provider.id,             prov1.provider.id)
check('GET provider name',        fetchedProv.provider.name,           prov1.provider.name)
check('GET non-existent → 404',   await httpCode('/training/providers/00000000-0000-0000-0000-000000000000'), 404)

const listAll = await api('/training/providers?limit=100')
check('List array',               Array.isArray(listAll.providers),    true)
check('List pagination',          !!listAll.pagination,                true)
check('List total >= 3',          listAll.pagination.total >= 3,       true)

// Filter by type
const listInst = await api('/training/providers?type=Institute&limit=50')
check('Filter type=Institute has prov1', listInst.providers.map(p=>p.id).includes(prov1.provider.id), true)
check('Filter type=Institute excl prov2',!listInst.providers.map(p=>p.id).includes(prov2.provider.id), true)

// Filter by district
const listPune = await api('/training/providers?district=Pune&limit=50')
check('Filter district=Pune has prov1', listPune.providers.map(p=>p.id).includes(prov1.provider.id), true)

// Filter by region
const listVid = await api('/training/providers?region=Vidarbha&limit=50')
check('Filter region=Vidarbha has prov3', listVid.providers.map(p=>p.id).includes(prov3.provider.id), true)

// Pagination
const pg1 = await api('/training/providers?limit=1&page=1')
const pg2 = await api('/training/providers?limit=1&page=2')
check('Page 1 has 1 result',      pg1.providers.length,                1)
check('Pages differ',             pg1.providers[0]?.id !== pg2.providers[0]?.id, true)

// Search — use a unique string that only these test records contain
check('Search missing q → 400',   await httpCode('/training/providers/search'), 400)
const srch = await api(`/training/providers/search?q=${encodeURIComponent(`Pune Tech Academy ${ts}`)}`)
check('Search finds prov1',       srch.providers.map(p=>p.id).includes(prov1.provider.id), true)
check('Search count >= 1',        srch.count >= 1,                     true)

// ─────────────────────────────────────────────────────────────────────────────
// 5. PROVIDER UPDATE
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[5] PROVIDER UPDATE')
check('PATCH empty body → 400',   await httpCode(`/training/providers/${prov1.provider.id}`, 'PATCH', tT, {}), 400)
check('PATCH bad type → 400',     await httpCode(`/training/providers/${prov1.provider.id}`, 'PATCH', tT, { type: 'Academy' }), 400)
check('PATCH bad email → 400',    await httpCode(`/training/providers/${prov1.provider.id}`, 'PATCH', tT, { contactEmail: 'bad' }), 400)

// Owner guard: tT2 cannot update prov1
check('Other owner → 403',        await httpCode(`/training/providers/${prov1.provider.id}`, 'PATCH', tT2, { description: 'hack' }), 403)

// Government can update any
const govUpd = await api(`/training/providers/${prov1.provider.id}`, 'PATCH', tG, { description: 'Updated by govt', accreditation: 'NAAC A' })
check('Govt update description',  govUpd.provider.description,        'Updated by govt')
check('Govt update accreditation',govUpd.provider.accreditation,      'NAAC A')
check('Govt name preserved',      govUpd.provider.name,               prov1.provider.name)

// Owner update
const ownUpd = await api(`/training/providers/${prov1.provider.id}`, 'PATCH', tT, {
  focusAreas: ['AI', 'Cloud', 'DevOps', 'Data Science'],
})
check('Owner update focusAreas',  ownUpd.provider.focusAreas.length,  4)
check('Owner updatedAt set',      !!ownUpd.provider.updatedAt,        true)

check('PATCH non-existent → 404', await httpCode('/training/providers/00000000-0000-0000-0000-000000000000', 'PATCH', tT, { description: 'x' }), 404)

// ─────────────────────────────────────────────────────────────────────────────
// 6. PROGRAM CREATION — validation + happy path
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[6] PROGRAM CREATION')
check('Missing providerId → 400',  await httpCode('/training/programs', 'POST', tT, { name: 'P' }), 400)
check('Missing name → 400',        await httpCode('/training/programs', 'POST', tT, { providerId: prov1.provider.id }), 400)
check('Bad status → 400',          await httpCode('/training/programs', 'POST', tT, { providerId: prov1.provider.id, name: 'P', status: 'pending' }), 400)
check('Bad deliveryMode → 400',    await httpCode('/training/programs', 'POST', tT, { providerId: prov1.provider.id, name: 'P', deliveryMode: 'space' }), 400)
check('durationWeeks < 0 → 400',   await httpCode('/training/programs', 'POST', tT, { providerId: prov1.provider.id, name: 'P', durationWeeks: -1 }), 400)
check('fees < 0 → 400',            await httpCode('/training/programs', 'POST', tT, { providerId: prov1.provider.id, name: 'P', fees: -100 }), 400)
check('tags not array → 400',      await httpCode('/training/programs', 'POST', tT, { providerId: prov1.provider.id, name: 'P', tags: 'ai' }), 400)
check('certificationOffered not bool → 400', await httpCode('/training/programs', 'POST', tT, { providerId: prov1.provider.id, name: 'P', certificationOffered: 'yes' }), 400)
check('Non-existent providerId → 404', await httpCode('/training/programs', 'POST', tT, { providerId: '00000000-0000-0000-0000-000000000000', name: 'P' }), 404)

const prog1 = await api('/training/programs', 'POST', tT, {
  providerId: prov1.provider.id,
  name: `Full Stack Development ${ts}`,
  description: 'Comprehensive full-stack web development program.',
  status: 'active', deliveryMode: 'hybrid',
  durationWeeks: 24, fees: 45000,
  targetRoles: ['Full Stack Developer', 'Web Developer'],
  tags: ['javascript', 'react', 'nodejs', 'fullstack'],
  certificationOffered: true, language: 'English',
})
check('prog1 id',                  !!prog1.program.id,                 true)
check('prog1 name',                prog1.program.name,                 `Full Stack Development ${ts}`)
check('prog1 status',              prog1.program.status,               'active')
check('prog1 deliveryMode',        prog1.program.deliveryMode,         'hybrid')
check('prog1 durationWeeks',       prog1.program.durationWeeks,        24)
check('prog1 fees',                prog1.program.fees,                 45000)
check('prog1 tags count',          prog1.program.tags.length,          4)
check('prog1 targetRoles count',   prog1.program.targetRoles.length,   2)
check('prog1 certificationOffered',prog1.program.certificationOffered, true)
check('prog1 isDeleted',           prog1.program.isDeleted,            false)
check('prog1 providerId',          prog1.program.providerId,           prov1.provider.id)

const prog2 = await api('/training/programs', 'POST', tT, {
  providerId: prov1.provider.id,
  name: `Data Science Bootcamp ${ts}`,
  description: 'Intensive data science training.',
  status: 'active', deliveryMode: 'online',
  durationWeeks: 16, fees: 35000,
  tags: ['python', 'ml', 'data'], certificationOffered: true,
})
check('prog2 created',             !!prog2.program.id,                 true)

const prog3 = await api('/training/programs', 'POST', tT2, {
  providerId: prov2.provider.id,
  name: `Cybersecurity Fundamentals ${ts}`,
  status: 'active', deliveryMode: 'offline',
  durationWeeks: 12, fees: 30000,
  tags: ['security', 'networking'],
})
check('prog3 created by tT2',      !!prog3.program.id,                 true)

// ─────────────────────────────────────────────────────────────────────────────
// 7. PROGRAM GET / LIST / SEARCH / FILTERS
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[7] PROGRAM GET / LIST / SEARCH')

const fetchedProg = await api(`/training/programs/${prog1.program.id}`)
check('GET program id',            fetchedProg.program.id,             prog1.program.id)
check('GET program name',          fetchedProg.program.name,           prog1.program.name)
check('GET non-existent → 404',    await httpCode('/training/programs/00000000-0000-0000-0000-000000000000'), 404)

const listProgs = await api('/training/programs?limit=100')
check('List programs array',       Array.isArray(listProgs.programs),  true)
check('List total >= 3',           listProgs.pagination.total >= 3,    true)

// Filter by providerId
const listByProv = await api(`/training/programs?providerId=${prov1.provider.id}&limit=50`)
const byProvIds  = listByProv.programs.map(p=>p.id)
check('Filter providerId has prog1', byProvIds.includes(prog1.program.id), true)
check('Filter providerId has prog2', byProvIds.includes(prog2.program.id), true)
check('Filter providerId excl prog3',!byProvIds.includes(prog3.program.id), true)

// Filter by status
const listActive = await api('/training/programs?status=active&limit=50')
check('Filter active has prog1',   listActive.programs.map(p=>p.id).includes(prog1.program.id), true)

// Filter by mode
const listOnline = await api('/training/programs?mode=online&limit=50')
check('Filter online has prog2',   listOnline.programs.map(p=>p.id).includes(prog2.program.id), true)
check('Filter online excl prog3',  !listOnline.programs.map(p=>p.id).includes(prog3.program.id), true)

// Filter by tag
const listML = await api('/training/programs?tag=ml&limit=50')
check('Filter tag=ml has prog2',   listML.programs.map(p=>p.id).includes(prog2.program.id), true)

// Search
check('Search programs missing q → 400', await httpCode('/training/programs/search'), 400)
const srchProg = await api(`/training/programs/search?q=${encodeURIComponent(`Full Stack Development ${ts}`)}`)
check('Search finds prog1',        srchProg.programs.map(p=>p.id).includes(prog1.program.id), true)

// ─────────────────────────────────────────────────────────────────────────────
// 8. PROGRAM UPDATE
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[8] PROGRAM UPDATE')
check('PATCH empty body → 400',    await httpCode(`/training/programs/${prog1.program.id}`, 'PATCH', tT, {}), 400)
check('PATCH bad status → 400',    await httpCode(`/training/programs/${prog1.program.id}`, 'PATCH', tT, { status: 'closed' }), 400)
check('PATCH bad mode → 400',      await httpCode(`/training/programs/${prog1.program.id}`, 'PATCH', tT, { deliveryMode: 'space' }), 400)
check('PATCH other owner → 403',   await httpCode(`/training/programs/${prog1.program.id}`, 'PATCH', tT2, { description: 'hack' }), 403)

const updProg = await api(`/training/programs/${prog1.program.id}`, 'PATCH', tT, {
  status: 'inactive', fees: 50000, durationWeeks: 28,
  tags: ['javascript', 'react', 'nodejs', 'fullstack', 'typescript'],
})
check('Update status',             updProg.program.status,             'inactive')
check('Update fees',               updProg.program.fees,               50000)
check('Update durationWeeks',      updProg.program.durationWeeks,      28)
check('Update tags count',         updProg.program.tags.length,        5)
check('Update name preserved',     updProg.program.name,               prog1.program.name)

check('PATCH non-existent → 404',  await httpCode('/training/programs/00000000-0000-0000-0000-000000000000', 'PATCH', tT, { description: 'x' }), 404)

// ─────────────────────────────────────────────────────────────────────────────
// 9. PROVIDER → PROGRAMS SUB-ROUTE
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[9] PROVIDER PROGRAMS SUB-ROUTE')
const provProgs = await api(`/training/providers/${prov1.provider.id}/programs`)
check('Sub-route array',           Array.isArray(provProgs.programs),  true)
check('Sub-route has prog1',       provProgs.programs.map(p=>p.id).includes(prog1.program.id), true)
check('Sub-route has prog2',       provProgs.programs.map(p=>p.id).includes(prog2.program.id), true)
check('Sub-route excl prog3',      !provProgs.programs.map(p=>p.id).includes(prog3.program.id), true)
check('Sub-route pagination',      !!provProgs.pagination,             true)
check('Non-existent prov → 404',   await httpCode('/training/providers/00000000-0000-0000-0000-000000000000/programs'), 404)

// ─────────────────────────────────────────────────────────────────────────────
// 10. CURRICULUM CREATION — validation + upload
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[10] CURRICULUM CREATION')
check('Missing programId → 400',   await httpCode('/training/curriculums', 'POST', tT, { title: 'C' }), 400)
check('Missing title → 400',       await httpCode('/training/curriculums', 'POST', tT, { trainingProgramId: prog1.program.id }), 400)
check('Bad status → 400',          await httpCode('/training/curriculums', 'POST', tT, { trainingProgramId: prog1.program.id, title: 'C', status: 'active' }), 400)
check('totalHours < 0 → 400',      await httpCode('/training/curriculums', 'POST', tT, { trainingProgramId: prog1.program.id, title: 'C', totalHours: -1 }), 400)
check('modules not array → 400',   await httpCode('/training/curriculums', 'POST', tT, { trainingProgramId: prog1.program.id, title: 'C', modules: 'x' }), 400)
check('skillsCovered not array → 400', await httpCode('/training/curriculums', 'POST', tT, { trainingProgramId: prog1.program.id, title: 'C', skillsCovered: 'x' }), 400)
check('Non-existent programId → 404', await httpCode('/training/curriculums', 'POST', tT, { trainingProgramId: '00000000-0000-0000-0000-000000000000', title: 'C' }), 404)
check('Bad module (no title) → 400', await httpCode('/training/curriculums', 'POST', tT, {
  trainingProgramId: prog1.program.id, title: 'C',
  modules: [{ description: 'no title here' }],
}), 400)
check('Bad skillsCovered (no name) → 400', await httpCode('/training/curriculums', 'POST', tT, {
  trainingProgramId: prog1.program.id, title: 'C',
  skillsCovered: [{ coverage: 'core' }],
}), 400)
check('Bad skillId in covered → 400', await httpCode('/training/curriculums', 'POST', tT, {
  trainingProgramId: prog1.program.id, title: 'C',
  skillsCovered: [{ skillId: '00000000-0000-0000-0000-000000000000', skillName: 'X' }],
}), 400)

const cur1 = await api('/training/curriculums', 'POST', tT, {
  trainingProgramId: prog1.program.id,
  title: `Full Stack v1.0 Curriculum ${ts}`,
  version: '1.0', status: 'published',
  description: 'Complete full stack curriculum covering frontend and backend.',
  content: `Module 1: HTML/CSS basics. Module 2: JavaScript fundamentals.
  Module 3: React framework. Module 4: Node.js and Express. Module 5: Databases.
  This curriculum is designed for beginners with ${ts} identifier.`,
  learningObjectives: ['Build web apps', 'Understand REST APIs', 'Deploy to cloud'],
  totalHours: 480,
  modules: [
    { title: 'HTML & CSS', description: 'Web fundamentals', durationHours: 40, order: 1, topics: ['HTML5', 'CSS3', 'Flexbox'] },
    { title: 'JavaScript', description: 'Core JS concepts', durationHours: 80, order: 2, topics: ['ES6', 'Async/Await', 'DOM'] },
    { title: 'React', description: 'Frontend framework',   durationHours: 100, order: 3, topics: ['Hooks', 'Redux', 'Testing'] },
  ],
  skillsCovered: [
    { skillId: skillId, skillName: `Python B6 ${ts}`, coverage: 'supplementary', proficiencyLevel: 'beginner' },
    { skillName: 'JavaScript', coverage: 'core', proficiencyLevel: 'intermediate' },
    { skillName: 'React',      coverage: 'core', proficiencyLevel: 'intermediate' },
  ],
})
check('cur1 id',                   !!cur1.curriculum.id,               true)
check('cur1 title',                cur1.curriculum.title,              `Full Stack v1.0 Curriculum ${ts}`)
check('cur1 version',              cur1.curriculum.version,            '1.0')
check('cur1 status',               cur1.curriculum.status,             'published')
check('cur1 totalHours',           cur1.curriculum.totalHours,         480)
check('cur1 modules count',        cur1.curriculum.modules.length,     3)
check('cur1 module titles ok',     cur1.curriculum.modules[0].title,   'HTML & CSS')
check('cur1 module has moduleId',  !!cur1.curriculum.modules[0].moduleId, true)
check('cur1 module topics',        cur1.curriculum.modules[0].topics.length, 3)
check('cur1 skillsCovered count',  cur1.curriculum.skillsCovered.length, 3)
check('cur1 skillId linked',       cur1.curriculum.skillsCovered[0].skillId, skillId)
check('cur1 wordCount > 0',        cur1.curriculum.wordCount > 0,      true)
check('cur1 objectives count',     cur1.curriculum.learningObjectives.length, 3)
check('cur1 isDeleted',            cur1.curriculum.isDeleted,          false)
check('cur1 programId',            cur1.curriculum.trainingProgramId,  prog1.program.id)

// Second curriculum for the same program (version 2)
const cur2 = await api('/training/curriculums', 'POST', tT, {
  trainingProgramId: prog1.program.id,
  title: `Full Stack v2.0 Curriculum ${ts}`,
  version: '2.0', status: 'draft',
  totalHours: 520,
  modules: [{ title: 'TypeScript', durationHours: 40, order: 1 }],
  skillsCovered: [{ skillName: 'TypeScript', coverage: 'core' }],
})
check('cur2 created',              !!cur2.curriculum.id,               true)

// ─────────────────────────────────────────────────────────────────────────────
// 11. CURRICULUM GET
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[11] CURRICULUM GET')
const gotCur = await api(`/training/curriculums/${cur1.curriculum.id}`)
check('GET curriculum id',         gotCur.curriculum.id,               cur1.curriculum.id)
check('GET curriculum title',      gotCur.curriculum.title,            cur1.curriculum.title)
check('GET curriculum modules',    gotCur.curriculum.modules.length,   3)
check('GET curriculum skills',     gotCur.curriculum.skillsCovered.length, 3)
check('GET non-existent → 404',    await httpCode('/training/curriculums/00000000-0000-0000-0000-000000000000'), 404)

// ─────────────────────────────────────────────────────────────────────────────
// 12. CURRICULUM METADATA UPDATE
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[12] CURRICULUM UPDATE')
check('PATCH empty body → 400',    await httpCode(`/training/curriculums/${cur1.curriculum.id}`, 'PATCH', tT, {}), 400)
check('PATCH bad status → 400',    await httpCode(`/training/curriculums/${cur1.curriculum.id}`, 'PATCH', tT, { status: 'active' }), 400)
check('PATCH other owner → 403',   await httpCode(`/training/curriculums/${cur1.curriculum.id}`, 'PATCH', tT2, { description: 'hack' }), 403)

const updCur = await api(`/training/curriculums/${cur1.curriculum.id}`, 'PATCH', tT, {
  status: 'archived', description: 'Updated curriculum description.', totalHours: 500,
  content: 'Updated content for the curriculum with new material.',
})
check('Update status',             updCur.curriculum.status,           'archived')
check('Update description',        updCur.curriculum.description,      'Updated curriculum description.')
check('Update totalHours',         updCur.curriculum.totalHours,       500)
check('Update wordCount updated',  updCur.curriculum.wordCount > 0,    true)
check('Update title preserved',    updCur.curriculum.title,            cur1.curriculum.title)
check('Update modules preserved',  updCur.curriculum.modules.length,   3)

// Govt can update any
const govCurUpd = await api(`/training/curriculums/${cur1.curriculum.id}`, 'PATCH', tG, { version: '1.1' })
check('Govt update version',       govCurUpd.curriculum.version,       '1.1')

// ─────────────────────────────────────────────────────────────────────────────
// 13. CURRICULUM MODULES
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[13] CURRICULUM MODULES')

check('Add modules not array → 400',    await httpCode(`/training/curriculums/${cur1.curriculum.id}/modules`, 'POST', tT, { modules: 'x' }), 400)
check('Add modules empty array → 400',  await httpCode(`/training/curriculums/${cur1.curriculum.id}/modules`, 'POST', tT, { modules: [] }), 400)
check('Add module no title → 400',      await httpCode(`/training/curriculums/${cur1.curriculum.id}/modules`, 'POST', tT, { modules: [{ description: 'x' }] }), 400)
check('Add modules other owner → 403',  await httpCode(`/training/curriculums/${cur1.curriculum.id}/modules`, 'POST', tT2, { modules: [{ title: 'X' }] }), 403)

// Add new modules (appends)
const afterAdd = await api(`/training/curriculums/${cur1.curriculum.id}/modules`, 'POST', tT, {
  modules: [
    { title: 'Node.js',    description: 'Backend with Node', durationHours: 80, order: 4, topics: ['Express', 'REST', 'Auth'] },
    { title: 'Databases',  description: 'SQL and MongoDB',   durationHours: 60, order: 5, topics: ['SQL', 'MongoDB', 'Redis'] },
  ],
})
check('After add modules count',   afterAdd.curriculum.modules.length, 5)
check('New module Node.js present',afterAdd.curriculum.modules.some(m=>m.title==='Node.js'), true)

// Upsert by title (same title replaces existing)
const afterUpsert = await api(`/training/curriculums/${cur1.curriculum.id}/modules`, 'POST', tT, {
  modules: [{ title: 'JavaScript', description: 'Updated JS module', durationHours: 90, order: 2, topics: ['ES2022', 'TypeScript'] }],
})
check('Upsert: still 5 modules',   afterUpsert.curriculum.modules.length, 5)
const jsModule = afterUpsert.curriculum.modules.find(m=>m.title==='JavaScript')
check('Upsert: JS durationHours',  jsModule?.durationHours,             90)
check('Upsert: JS topics updated', jsModule?.topics.length,             2)

// Get moduleId for update/delete tests
const moduleId = afterUpsert.curriculum.modules.find(m=>m.title==='Node.js')?.moduleId

// PATCH a module
check('PATCH module bad durationHours → 400',
  await httpCode(`/training/curriculums/${cur1.curriculum.id}/modules/${moduleId}`, 'PATCH', tT, { durationHours: -5 }), 400)

const afterModUpd = await api(`/training/curriculums/${cur1.curriculum.id}/modules/${moduleId}`, 'PATCH', tT, {
  description: 'Advanced Node.js with microservices', durationHours: 100,
  topics: ['Express', 'Microservices', 'Docker', 'Auth'],
})
check('Module update description', afterModUpd.curriculum.modules.find(m=>m.moduleId===moduleId)?.description, 'Advanced Node.js with microservices')
check('Module update durationHours', afterModUpd.curriculum.modules.find(m=>m.moduleId===moduleId)?.durationHours, 100)
check('Module update topics count',  afterModUpd.curriculum.modules.find(m=>m.moduleId===moduleId)?.topics.length, 4)
check('Module total still 5',        afterModUpd.curriculum.modules.length, 5)

check('PATCH non-existent module → 404',
  await httpCode(`/training/curriculums/${cur1.curriculum.id}/modules/00000000-0000-0000-0000-000000000000`, 'PATCH', tT, { description: 'x' }), 404)

// DELETE a module
const dbModuleId = afterUpsert.curriculum.modules.find(m=>m.title==='Databases')?.moduleId
const afterModDel = await api(`/training/curriculums/${cur1.curriculum.id}/modules/${dbModuleId}`, 'DELETE', tT)
check('After delete, 4 modules',   afterModDel.curriculum.modules.length, 4)
check('Deleted module absent',     !afterModDel.curriculum.modules.some(m=>m.title==='Databases'), true)

check('DELETE non-existent module → 404',
  await httpCode(`/training/curriculums/${cur1.curriculum.id}/modules/00000000-0000-0000-0000-000000000000`, 'DELETE', tT), 404)

// ─────────────────────────────────────────────────────────────────────────────
// 14. CURRICULUM SKILLS COVERED
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[14] CURRICULUM SKILLS COVERED')

check('Skills not array → 400',    await httpCode(`/training/curriculums/${cur1.curriculum.id}/skills`, 'POST', tT, { skillsCovered: 'x' }), 400)
check('Skills empty array → 400',  await httpCode(`/training/curriculums/${cur1.curriculum.id}/skills`, 'POST', tT, { skillsCovered: [] }), 400)
check('Skill no name → 400',       await httpCode(`/training/curriculums/${cur1.curriculum.id}/skills`, 'POST', tT, { skillsCovered: [{ coverage: 'core' }] }), 400)
check('Bad coverage → 400',        await httpCode(`/training/curriculums/${cur1.curriculum.id}/skills`, 'POST', tT, { skillsCovered: [{ skillName: 'X', coverage: 'main' }] }), 400)
check('Bad proficiencyLevel → 400',await httpCode(`/training/curriculums/${cur1.curriculum.id}/skills`, 'POST', tT, { skillsCovered: [{ skillName: 'X', proficiencyLevel: 'god' }] }), 400)
check('Bad skillId → 400',         await httpCode(`/training/curriculums/${cur1.curriculum.id}/skills`, 'POST', tT, {
  skillsCovered: [{ skillId: '00000000-0000-0000-0000-000000000000', skillName: 'X' }],
}), 400)
check('Skills other owner → 403',  await httpCode(`/training/curriculums/${cur1.curriculum.id}/skills`, 'POST', tT2, {
  skillsCovered: [{ skillName: 'X' }],
}), 403)

// Add new skills
const afterAddSk = await api(`/training/curriculums/${cur1.curriculum.id}/skills`, 'POST', tT, {
  skillsCovered: [
    { skillName: 'Node.js', coverage: 'core', proficiencyLevel: 'intermediate' },
    { skillName: 'MongoDB', coverage: 'supplementary', proficiencyLevel: 'beginner' },
  ],
})
check('After add skills count',    afterAddSk.curriculum.skillsCovered.length, 5)

// Upsert: update existing by skillName
const afterUpsertSk = await api(`/training/curriculums/${cur1.curriculum.id}/skills`, 'POST', tT, {
  skillsCovered: [{ skillName: 'JavaScript', coverage: 'core', proficiencyLevel: 'advanced' }],
})
check('Upsert: still 5 skills',    afterUpsertSk.curriculum.skillsCovered.length, 5)
const jsSk = afterUpsertSk.curriculum.skillsCovered.find(s=>s.skillName==='JavaScript')
check('Upsert: JS proficiency',    jsSk?.proficiencyLevel,             'advanced')

// Upsert by skillId (canonical skill)
const afterUpsertById = await api(`/training/curriculums/${cur1.curriculum.id}/skills`, 'POST', tT, {
  skillsCovered: [{ skillId: skillId, skillName: `Python B6 ${ts}`, coverage: 'core', proficiencyLevel: 'intermediate' }],
})
check('Upsert by skillId: still 5', afterUpsertById.curriculum.skillsCovered.length, 5)
const pySk = afterUpsertById.curriculum.skillsCovered.find(s=>s.skillId===skillId)
check('Upsert by skillId: coverage updated', pySk?.coverage, 'core')

// Remove skill by name
const afterRemoveSk = await api(`/training/curriculums/${cur1.curriculum.id}/skills/MongoDB`, 'DELETE', tT)
check('After remove, 4 skills',    afterRemoveSk.curriculum.skillsCovered.length, 4)
check('MongoDB removed',           !afterRemoveSk.curriculum.skillsCovered.some(s=>s.skillName==='MongoDB'), true)

check('Remove non-existent skill → 404',
  await httpCode(`/training/curriculums/${cur1.curriculum.id}/skills/DoesNotExist`, 'DELETE', tT), 404)

// ─────────────────────────────────────────────────────────────────────────────
// 15. PROGRAM → CURRICULUMS SUB-ROUTE
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[15] PROGRAM CURRICULUMS SUB-ROUTE')
const progCurs = await api(`/training/programs/${prog1.program.id}/curriculums`)
check('Sub-route array',           Array.isArray(progCurs.curriculums), true)
const progCurIds = progCurs.curriculums.map(c=>c.id)
check('Sub-route has cur1',        progCurIds.includes(cur1.curriculum.id), true)
check('Sub-route has cur2',        progCurIds.includes(cur2.curriculum.id), true)
check('Sub-route pagination',      !!progCurs.pagination,              true)
check('Non-existent prog → 404',   await httpCode('/training/programs/00000000-0000-0000-0000-000000000000/curriculums'), 404)

// Filter by status on sub-route
const draftCurs = await api(`/training/programs/${prog1.program.id}/curriculums?status=draft`)
check('Sub-route filter status=draft has cur2', draftCurs.curriculums.map(c=>c.id).includes(cur2.curriculum.id), true)

// ─────────────────────────────────────────────────────────────────────────────
// 16. PROGRAM DELETE (soft + cascade curriculums)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[16] PROGRAM DELETE')

// Other owner cannot delete
check('Delete other owner prog → 403', await httpCode(`/training/programs/${prog1.program.id}`, 'DELETE', tT2), 403)

// Create a temp curriculum under prog2 to verify cascade
const tempCur = await api('/training/curriculums', 'POST', tT, {
  trainingProgramId: prog2.program.id,
  title: `Cascade Test Curriculum ${ts}`, version: '1.0',
})
check('Cascade curriculum created', !!tempCur.curriculum.id, true)

// Delete prog2 (owner = tT)
const delProg = await api(`/training/programs/${prog2.program.id}`, 'DELETE', tT)
check('Delete prog2 message',      delProg.message.includes('deleted'), true)
check('prog2 deleted → 404',       await httpCode(`/training/programs/${prog2.program.id}`), 404)

// Cascade: tempCur should be gone
check('Cascade curriculum → 404',  await httpCode(`/training/curriculums/${tempCur.curriculum.id}`), 404)

check('Delete non-existent → 404', await httpCode('/training/programs/00000000-0000-0000-0000-000000000000', 'DELETE', tT), 404)

// Government can delete any program
const delProg3 = await api(`/training/programs/${prog3.program.id}`, 'DELETE', tG)
check('Govt delete prog3',         delProg3.message.includes('deleted'), true)

// ─────────────────────────────────────────────────────────────────────────────
// 17. PROVIDER DELETE (government only, cascade programs + curriculums)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[17] PROVIDER DELETE')

// Training user cannot delete
check('Training DELETE provider → 403', await httpCode(`/training/providers/${prov2.provider.id}`, 'DELETE', tT2), 403)

// Create a program + curriculum under prov3 for cascade test
const cascadeProg = await api('/training/programs', 'POST', tG, {
  providerId: prov3.provider.id,
  name: `Cascade Program ${ts}`, status: 'active',
})
const cascadeCur = await api('/training/curriculums', 'POST', tG, {
  trainingProgramId: cascadeProg.program.id,
  title: `Cascade Curriculum ${ts}`, version: '1.0',
})
check('Cascade program created',   !!cascadeProg.program.id, true)
check('Cascade curriculum created',!!cascadeCur.curriculum.id, true)

// Government deletes prov3
const delProv = await api(`/training/providers/${prov3.provider.id}`, 'DELETE', tG)
check('Delete prov3 message',      delProv.message.includes('deleted'), true)
check('prov3 deleted → 404',       await httpCode(`/training/providers/${prov3.provider.id}`), 404)
check('Cascade program → 404',     await httpCode(`/training/programs/${cascadeProg.program.id}`), 404)
check('Cascade curriculum → 404',  await httpCode(`/training/curriculums/${cascadeCur.curriculum.id}`), 404)

check('Delete non-existent prov → 404',
  await httpCode('/training/providers/00000000-0000-0000-0000-000000000000', 'DELETE', tG), 404)
check('Re-delete → 404',           await httpCode(`/training/providers/${prov3.provider.id}`, 'DELETE', tG), 404)

// ─────────────────────────────────────────────────────────────────────────────
// 18. DELETED VISIBILITY
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[18] DELETED VISIBILITY')

const listProvAfter = await api('/training/providers?limit=100')
check('Deleted prov3 absent from list',
  !listProvAfter.providers.map(p=>p.id).includes(prov3.provider.id), true)

const srchProvAfter = await api(`/training/providers/search?q=Nagpur+Polytechnic+${ts}`)
check('Deleted prov3 absent from search',
  !srchProvAfter.providers.map(p=>p.id).includes(prov3.provider.id), true)

const listProgAfter = await api('/training/programs?limit=100')
const progIdsAfter  = listProgAfter.programs.map(p=>p.id)
check('Deleted prog2 absent from list',      !progIdsAfter.includes(prog2.program.id), true)
check('Cascade prog absent from list',       !progIdsAfter.includes(cascadeProg.program.id), true)

const srchProgAfter = await api(`/training/programs/search?q=Data+Science+${ts}`)
check('Deleted prog2 absent from search',    !srchProgAfter.programs.map(p=>p.id).includes(prog2.program.id), true)

// ─────────────────────────────────────────────────────────────────────────────
// CURRICULUM DELETE (direct)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[BONUS] CURRICULUM DIRECT DELETE')
check('Delete curriculum other owner → 403',
  await httpCode(`/training/curriculums/${cur2.curriculum.id}`, 'DELETE', tT2), 403)

const delCur2 = await api(`/training/curriculums/${cur2.curriculum.id}`, 'DELETE', tT)
check('cur2 deleted message',      delCur2.message,                    'Curriculum deleted')
check('cur2 deleted → 404',        await httpCode(`/training/curriculums/${cur2.curriculum.id}`), 404)

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────
const total = pass + fail
console.log(`\n${'─'.repeat(52)}`)
console.log(`  TOTAL  ${total}   PASS  ${pass}   FAIL  ${fail}`)
console.log('─'.repeat(52))
if (fail > 0) process.exit(1)
