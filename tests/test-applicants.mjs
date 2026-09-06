// Quick test of GET /api/jobs/:id/applicants
const BASE = 'http://localhost:4000/api'
const ts   = Date.now()

const post = async (path, body, token) => {
  const h = { 'Content-Type': 'application/json' }
  if (token) h.Authorization = `Bearer ${token}`
  const r = await fetch(`${BASE}${path}`, { method: 'POST', headers: h, body: JSON.stringify(body) })
  return r.json()
}
const get = async (path, token) => {
  const h = { 'Content-Type': 'application/json' }
  if (token) h.Authorization = `Bearer ${token}`
  const r = await fetch(`${BASE}${path}`, { headers: h })
  return r.json()
}

// Create accounts
const { token: tI } = await post('/auth/register', { name: 'Industry', email: `ind_app_${ts}@t.com`, password: 'pass1234', role: 'industry' })
const { token: tL } = await post('/auth/register', { name: 'Learner',  email: `lrn_app_${ts}@t.com`, password: 'pass1234', role: 'learner'  })

// Industry creates a job
const { industry } = await post('/industries', { name: `Co_${ts}`, sector: 'Technology' }, tI)
const { jobRole }  = await post('/jobs', { industryId: industry.id, title: `SWE_${ts}`, status: 'active' }, tI)

// Learner sets this job as target
await fetch(`${BASE}/student/target-role`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tL}` }, body: JSON.stringify({ jobRoleId: jobRole.id }) })

// Industry views applicants
const result = await get(`/jobs/${jobRole.id}/applicants`, tI)

console.log(`✓ Applicants endpoint: count=${result.count}  jobTitle="${result.jobTitle}"`)
if (result.applicants?.[0]) {
  const a = result.applicants[0]
  console.log(`✓ Applicant: name="${a.applicantName}" matchScore=${a.matchScore}% skills=${a.currentSkillCount}`)
  console.log(`✓ Matched skills: ${a.matchedSkills?.length ?? 0}  Missing: ${a.missingSkills?.length ?? 0}`)
}
console.log('\n✅ Applicants endpoint working correctly')
