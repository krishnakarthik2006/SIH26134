/**
 * Phase B10 — Student Skill Gap & Readiness verification
 * Run: node tests/verify-b10.mjs  (server must be on :4000)
 */

const BASE = 'http://localhost:4000/api'
let pass = 0
let fail = 0

function check(label, got, expected) {
  const ok = String(got) === String(expected)
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${ok ? '' : ` got=${JSON.stringify(got)} expect=${JSON.stringify(expected)}`}`)
  if (ok) pass++
  else fail++
}

async function request(path, method = 'GET', token = null, body) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  return { status: response.status, data: text ? JSON.parse(text) : null }
}

async function api(path, method, token, body) {
  const response = await request(path, method, token, body)
  if (response.status >= 400) throw new Error(`${response.status} ${path}: ${JSON.stringify(response.data)}`)
  return response.data
}

const ts = Date.now()
console.log('\n[SETUP] Creating B10 users, canonical skills, and a Data Analyst role...')

const industryAuth = await api('/auth/register', 'POST', null, {
  name: 'B10 Industry', email: `industry_b10_${ts}@example.com`, password: 'password10', role: 'industry',
})
const learnerAuth = await api('/auth/register', 'POST', null, {
  name: 'B10 Learner', email: `learner_b10_${ts}@example.com`, password: 'password10', role: 'learner',
})
const otherLearnerAuth = await api('/auth/register', 'POST', null, {
  name: 'Other Learner', email: `other_b10_${ts}@example.com`, password: 'password10', role: 'learner',
})

const industryToken = industryAuth.token
const learnerToken = learnerAuth.token
const otherLearnerToken = otherLearnerAuth.token

const [sql, powerBI, tableau, statistics] = await Promise.all([
  api('/skills', 'POST', industryToken, { name: `SQL B10 ${ts}`, category: 'Data', type: 'technical' }),
  api('/skills', 'POST', industryToken, {
    name: `Power BI B10 ${ts}`, category: 'Data', type: 'tool', aliases: [`PowerBI B10 ${ts}`],
  }),
  api('/skills', 'POST', industryToken, { name: `Tableau B10 ${ts}`, category: 'Data', type: 'tool' }),
  api('/skills', 'POST', industryToken, { name: `Statistics B10 ${ts}`, category: 'Data', type: 'domain' }),
])

const industry = await api('/industries', 'POST', industryToken, {
  name: `B10 Analytics Co ${ts}`, sector: 'Technology',
})
const role = await api('/jobs', 'POST', industryToken, {
  industryId: industry.industry.id,
  title: `Data Analyst B10 ${ts}`,
  status: 'active',
  requiredSkills: [
    { skillId: sql.skill.id, skillName: sql.skill.name, level: 'advanced', requirement: 'required' },
    { skillId: powerBI.skill.id, skillName: powerBI.skill.name, level: 'advanced', requirement: 'required' },
    { skillId: tableau.skill.id, skillName: tableau.skill.name, level: 'intermediate', requirement: 'preferred' },
    { skillId: statistics.skill.id, skillName: statistics.skill.name, level: 'beginner', requirement: 'nice-to-have' },
  ],
})
const roleId = role.jobRole.id

console.log('\n[1] ACCESS AND TARGET JOB ROLE')
check('Readiness without a student profile → 404', (await request('/student/readiness', 'GET', learnerToken)).status, 404)
check('Student routes require authentication', (await request('/student/readiness')).status, 401)
check('Student routes reject industry role', (await request('/student/readiness', 'GET', industryToken)).status, 403)
check('Unknown target role → 404', (await request('/student/target-role', 'PATCH', learnerToken, { jobRoleId: 'missing-role' })).status, 404)

const target = await api('/student/target-role', 'PATCH', learnerToken, { jobRoleId: roleId })
check('Target role selected', target.targetJobRole.id, roleId)
check('Target role title returned', target.targetJobRole.title, role.jobRole.title)

const savedTarget = await api('/student/target-role', 'GET', learnerToken)
check('Target role can be retrieved', savedTarget.targetJobRole.id, roleId)
check('Other learner cannot read this learner target', (await request('/student/target-role', 'GET', otherLearnerToken)).status, 404)

console.log('\n[2] CURRENT AND REQUIRED SKILLS')
const current = await api('/student/current-skills', 'PATCH', learnerToken, {
  currentSkills: [
    { skillId: sql.skill.id, skillName: sql.skill.name, level: 'advanced' },
    { skillName: `PowerBI B10 ${ts}`, level: 'intermediate' },
  ],
})
check('Two current skills saved', current.count, 2)
check('Name-only alias canonicalized', current.currentSkills[1].skillId, powerBI.skill.id)
check('Current skill level retained', current.currentSkills[1].level, 'intermediate')

const savedCurrent = await api('/student/current-skills', 'GET', learnerToken)
check('Current skills can be retrieved', savedCurrent.count, 2)
check('Unknown skill ID rejected', (await request('/student/current-skills', 'PATCH', learnerToken, {
  currentSkills: [{ skillId: 'missing-skill', level: 'advanced' }],
})).status, 400)
check('Invalid skill level rejected', (await request('/student/current-skills', 'PATCH', learnerToken, {
  currentSkills: [{ skillName: 'Anything', level: 'master' }],
})).status, 400)

const required = await api('/student/required-skills', 'GET', learnerToken)
check('Required skills use target job role', required.targetJobRole.id, roleId)
check('All role requirements returned', required.count, 4)

console.log('\n[3] COMPLETE READINESS REPORT')
const { report } = await api('/student/readiness', 'GET', learnerToken)
check('Report includes target role', report.targetJobRole.id, roleId)
check('Report includes current skills', report.currentSkills.length, 2)
check('Report includes required skills', report.requiredSkills.length, 4)
check('One fully met skill is a strength', report.strengths.length, 1)
check('SQL is the strength', report.strengths[0].canonicalId, sql.skill.id)
check('One under-level skill is partial', report.partialSkills.length, 1)
check('Power BI is partial', report.partialSkills[0].canonicalId, powerBI.skill.id)
check('Partial skill records a level gap', report.partialSkills[0].levelGap, 1)
check('Two absent skills are missing', report.missingSkills.length, 2)
check('Preferred missing skill is high priority', report.missingSkills.find(skill => skill.canonicalId === tableau.skill.id).priority, 'high')
check('Nice-to-have missing skill is medium priority', report.missingSkills.find(skill => skill.canonicalId === statistics.skill.id).priority, 'medium')
check('Required skills are critical priority', report.partialSkills[0].priority, 'critical')
check('Readiness is a percentage', report.jobReadinessScore > 0 && report.jobReadinessScore < 100, true)
check('Skill gap complements readiness', report.skillGapScore + report.jobReadinessScore, 100)
check('Summary missing count is correct', report.summary.missingCount, 2)
check('Summary partial count is correct', report.summary.partialCount, 1)
check('Report includes timestamp', Boolean(report.calculatedAt), true)

console.log(`\nTOTAL ${pass + fail}  PASS ${pass}  FAIL ${fail}`)
if (fail) process.exit(1)
