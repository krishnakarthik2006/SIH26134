/**
 * Full integration check — Backend + AI Service
 * Tests every major API group end-to-end.
 * Run: node tests/integration-check.mjs
 */

const API  = 'http://localhost:4000/api'
const AI   = 'http://localhost:8000'
let pass = 0, fail = 0

function check(label, got, expect) {
  const ok = String(got) === String(expect)
  const icon = ok ? '✓' : '✗'
  console.log(`  ${icon} ${label}${ok ? '' : `  (got=${JSON.stringify(got)} expect=${JSON.stringify(expect)})`}`)
  ok ? pass++ : fail++
}

async function get(url, token) {
  const h = { 'Content-Type': 'application/json' }
  if (token) h.Authorization = `Bearer ${token}`
  const r = await fetch(url, { headers: h })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}

async function post(url, body, token) {
  const h = { 'Content-Type': 'application/json' }
  if (token) h.Authorization = `Bearer ${token}`
  const r = await fetch(url, { method: 'POST', headers: h, body: JSON.stringify(body) })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}

const ts = Date.now()
console.log('\n╔══════════════════════════════════════════════════╗')
console.log('║   SkillSync Full Integration Check               ║')
console.log('╚══════════════════════════════════════════════════╝\n')

// ── 1. BACKEND HEALTH ────────────────────────────────────────────────────────
console.log('① Backend Health')
const health = await get(`${API}/health`)
check('Status ok',             health.data.status,  'ok')
check('MongoDB connected',     health.data.mongodb, 'connected')
check('25 collections',        health.data.collections?.length >= 25, true)

// ── 2. AI SERVICE HEALTH ─────────────────────────────────────────────────────
console.log('\n② AI Service Health')
try {
  const aiH = await get(`${AI}/health`)
  check('AI service up',         aiH.data.status,  'ok')
  check('AI version 2.0.0',      aiH.data.version, '2.0.0')
  check('Ollama model set',      !!aiH.data.ollamaModel, true)
  check('Engine reported',       !!aiH.data.engine,      true)
  console.log(`  ℹ  Ollama: ${aiH.data.ollamaStatus}`)
} catch { check('AI service reachable', false, true) }

// ── 3. AUTH ──────────────────────────────────────────────────────────────────
console.log('\n③ Authentication')
const { data: reg } = await post(`${API}/auth/register`, { name: 'IntegTest', email: `int_${ts}@t.com`, password: 'pass1234', role: 'learner' })
const { data: regI } = await post(`${API}/auth/register`, { name: 'IntegInd', email: `indi_${ts}@t.com`, password: 'pass1234', role: 'industry' })
const { data: regT } = await post(`${API}/auth/register`, { name: 'IntegTrn', email: `trn_${ts}@t.com`, password: 'pass1234', role: 'training' })
const { data: regG } = await post(`${API}/auth/register`, { name: 'IntegGov', email: `gov_${ts}@t.com`, password: 'pass1234', role: 'government' })
const tL = reg.token, tI = regI.token, tT = regT.token, tG = regG.token
check('Learner token issued',    !!tL, true)
check('Industry token issued',   !!tI, true)
check('Training token issued',   !!tT, true)
check('Government token issued', !!tG, true)
const { data: loginRes } = await post(`${API}/auth/login`, { email: `int_${ts}@t.com`, password: 'pass1234' })
check('Login works',             !!loginRes.token, true)
check('GET /auth/me works',      (await get(`${API}/auth/me`, tL)).status, 200)

// ── 4. OVERVIEW (live DB) ────────────────────────────────────────────────────
console.log('\n④ Overview (live DB queries)')
const { data: ov } = await get(`${API}/overview`)
check('Overview returns data',   typeof ov.activeDemandSignals === 'number', true)
check('skillsTracked is number', typeof ov.skillsTracked === 'number', true)
check('demandPulse is array',    Array.isArray(ov.demandPulse), true)

// ── 5. SKILLS ────────────────────────────────────────────────────────────────
console.log('\n⑤ Skill Knowledge Base')
const sk = await post(`${API}/skills`, { name: `IntSk_${ts}`, category: 'Integration', type: 'technical', demandScore: 80, aliases: [`intsk_${ts}`] }, tI)
check('Create skill 201',        sk.status, 201)
const skId = sk.data.skill?.id
check('Skill has id',            !!skId, true)
const { data: skGet } = await get(`${API}/skills/${skId}`)
check('GET skill by id',         skGet.skill?.id, skId)
const norm = await post(`${API}/normalize`, { terms: [`IntSk_${ts}`, `intsk_${ts}`], deduplicate: true })
check('Normalize resolves skill',norm.data.summary?.matched >= 1, true)

// ── 6. INDUSTRIES & JOBS ─────────────────────────────────────────────────────
console.log('\n⑥ Industries & Jobs')
const ind = await post(`${API}/industries`, { name: `IntInd_${ts}`, sector: 'Technology' }, tI)
check('Create industry 201',     ind.status, 201)
const indId = ind.data.industry?.id
const job = await post(`${API}/jobs`, {
  industryId: indId, title: `IntJob_${ts}`, status: 'active',
  requiredSkills: [{ skillId: skId, skillName: `IntSk_${ts}`, requirement: 'required', level: 'intermediate' }],
}, tI)
check('Create job role 201',     job.status, 201)
const jobId = job.data.jobRole?.id
check('Job links to industry',   job.data.jobRole?.industryId, indId)
const { data: jobGet } = await get(`${API}/jobs/${jobId}`)
check('GET job role',            jobGet.jobRole?.id, jobId)

// ── 7. TRAINING ──────────────────────────────────────────────────────────────
console.log('\n⑦ Training Providers & Curriculum')
const prov = await post(`${API}/training/providers`, { name: `IntProv_${ts}`, type: 'Institute', district: 'Pune' }, tT)
check('Create provider 201',     prov.status, 201)
const provId = prov.data.provider?.id
const prog = await post(`${API}/training/programs`, { providerId: provId, name: `IntProg_${ts}`, status: 'active', deliveryMode: 'online' }, tT)
check('Create program 201',      prog.status, 201)
const progId = prog.data.program?.id
const cur = await post(`${API}/training/curriculums`, {
  trainingProgramId: progId, title: `IntCur_${ts}`, version: '1.0', status: 'published',
  skillsCovered: [{ skillId: skId, skillName: `IntSk_${ts}`, coverage: 'core' }],
}, tT)
check('Create curriculum 201',   cur.status, 201)

// ── 8. PROFILES ──────────────────────────────────────────────────────────────
console.log('\n⑧ User Profiles')
const studentProf = await fetch(`${API}/profiles/student`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tL}` }, body: JSON.stringify({ targetRole: 'Data Engineer', location: 'Pune', currentSkills: [] }) })
check('Upsert student profile',  studentProf.status, 200)
const { data: myProf } = await get(`${API}/profiles/me`, tL)
check('GET /profiles/me',        myProf.role, 'learner')

// ── 9. SKILL MATCHING & GAP ──────────────────────────────────────────────────
console.log('\n⑨ Skill Matching & Gap Analysis')
const match = await post(`${API}/match`, {
  requiredSkills: [{ skillId: skId, skillName: `IntSk_${ts}`, requirement: 'required', level: 'advanced' }],
  currentSkills:  [],
}, tL)
check('Ad-hoc match 200',        match.status, 200)
check('Match has gapCount',      match.data.result?.gapCount >= 1, true)
check('readinessScore = 0',      match.data.result?.readinessScore, 0)

const gap = await post(`${API}/match/gap`, {
  subjectType: 'learner', subjectId: `intl_${ts}`, targetRole: `IntRole_${ts}`,
  jobRoleId: jobId,
  requiredSkills: [{ skillId: skId, skillName: `IntSk_${ts}`, requirement: 'required' }],
  currentSkills:  [],
}, tL)
check('Persist gap analysis 201', gap.status, 201)
check('Gap result saved',         !!gap.data.readinessScore?.id, true)

// ── 10. RECOMMENDATIONS ──────────────────────────────────────────────────────
console.log('\n⑩ Recommendations')
const prev = await post(`${API}/recommendations/preview`, {
  gaps: [{ skillId: skId, skillName: `IntSk_${ts}`, requirement: 'required' }], limit: 5,
}, tL)
check('Preview recs 200',        prev.status, 200)
check('Recommendations array',   Array.isArray(prev.data.recommendations), true)

// ── 11. ROADMAP ───────────────────────────────────────────────────────────────
console.log('\n⑪ Learning Roadmap')
const rm = await post(`${API}/roadmap/generate`, {
  subjectId: `intl_${ts}`, targetRole: `IntRole_${ts}`,
  gaps: [{ skillId: skId, skillName: `IntSk_${ts}`, requirement: 'required', requiredLevel: 'intermediate' }],
}, tL)
check('Generate roadmap 201',    rm.status, 201)
const rmId = rm.data.roadmap?.id
check('Roadmap has steps',       rm.data.roadmap?.steps?.length >= 1, true)
const step = rm.data.roadmap?.steps?.[0]
if (step) {
  const complete = await fetch(`${API}/roadmap/${rmId}/steps/${step.stepId}/complete`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tL}` }, body: '{}' })
  check('Complete step 200',     complete.status, 200)
}

// ── 12. ALIGNMENT ─────────────────────────────────────────────────────────────
console.log('\n⑫ Training Alignment')
const align = await post(`${API}/alignment/calculate`, { programId: progId, jobRoleId: jobId, persist: true }, tG)
check('Calculate alignment 201', align.status, 201)
check('alignmentPct 0-100',      align.data.alignment?.alignmentPct >= 0, true)

// ── 13. DEMAND & INTELLIGENCE ─────────────────────────────────────────────────
console.log('\n⑬ Demand & Government Intelligence')
const demSig = await post(`${API}/demand/skills/${skId}`, { demandScore: 85, region: 'Pune', sector: 'Technology' }, tI)
check('Record demand signal 201', demSig.status, 201)
const { data: demSkills } = await get(`${API}/demand/skills?limit=5`)
check('Demand skills list',      Array.isArray(demSkills.skills), true)
const { data: intel } = await get(`${API}/intelligence/overview`)
check('Gov intelligence overview', !!intel.overview, true)
check('totalLearners >= 4',      intel.overview?.totalLearners >= 4, true)

// ── 14. ASSESSMENTS ──────────────────────────────────────────────────────────
console.log('\n⑭ Assessments')
const asmt = await post(`${API}/assessments`, {
  title: `IntTest_${ts}`, skillId: skId, type: 'quiz', level: 'beginner', passingScore: 70,
  questions: [{ text: 'What is integration testing?', options: ['A test', 'B test', 'C test'], correctAnswer: 'A test' }],
}, tT)
check('Create assessment 201',   asmt.status, 201)
const asmtId = asmt.data.assessment?.id
const attempt = await post(`${API}/assessments/${asmtId}/attempt`, { answers: [{ answer: 'A test' }] }, tL)
check('Submit attempt 201',      attempt.status, 201)
check('Auto-graded passed',      attempt.data.attempt?.passed, true)
check('Score = 100',             attempt.data.attempt?.score, 100)

// ── 15. REPORTS & NOTIFICATIONS ──────────────────────────────────────────────
console.log('\n⑮ Reports & Notifications')
const rep = await post(`${API}/reports/generate`, { type: 'ecosystem_overview', title: 'Integration Report' }, tG)
check('Generate report 201',     rep.status, 201)
check('Report has data',         !!rep.data.report?.data, true)
const lrnId = reg.user?.id || 'test-learner'
const notif = await post(`${API}/notifications`, { recipientId: lrnId, title: 'Integration test', text: 'All systems go', severity: 'success' }, tG)
check('Create notification 201', notif.status, 201)
const { data: myNotifs } = await get(`${API}/notifications/my`, tL)
check('My notifications list',   Array.isArray(myNotifs.notifications), true)

// ── 16. AI SERVICE EXTRACTION ────────────────────────────────────────────────
console.log('\n⑯ AI Service (Ollama / Rule-based)')
try {
  const aiRes = await fetch(`${AI}/extract/resume`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: 'Senior Python developer with experience in FastAPI, PostgreSQL, Docker, Kubernetes, and AWS. Strong background in machine learning using PyTorch and scikit-learn. B.Tech Computer Science from Pune University.',
      metadata: { sourceType: 'resume' },
    }),
  })
  const aiData = await aiRes.json()
  check('AI extraction 200',       aiRes.status, 200)
  check('Skills extracted > 0',    aiData.extractedSkills?.length > 0, true)
  check('Engine reported',         !!aiData.engine, true)
  check('Python in skills',        aiData.extractedSkills?.some(s => s.normalizedName === 'python'), true)
  console.log(`  ℹ  Engine: ${aiData.engine} | Skills: ${aiData.extractedSkills?.length} | Time: ${aiData.processingMs}ms`)
} catch (e) { check('AI service reachable', false, true) }

// ── SUMMARY ──────────────────────────────────────────────────────────────────
const total = pass + fail
console.log(`\n${'═'.repeat(52)}`)
console.log(`  TOTAL  ${total}   PASS  ${pass}   FAIL  ${fail}`)
console.log('═'.repeat(52))
if (fail > 0) {
  console.log('\n  ⚠  Some checks failed — review the output above.')
  process.exit(1)
} else {
  console.log('\n  ✅  Full stack integration verified successfully.')
}
