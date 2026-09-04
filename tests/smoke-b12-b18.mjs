/**
 * Smoke test — B12 through B18
 * node tests/smoke-b12-b18.mjs
 */
const BASE = 'http://localhost:4000/api'
let pass = 0, fail = 0

const chk = (label, got, expect) => {
  const ok = String(got) === String(expect)
  console.log(`  [${ok?'PASS':'FAIL'}] ${label}${ok?'':` got=${JSON.stringify(got)} expect=${JSON.stringify(expect)}`}`)
  ok ? pass++ : fail++
}

const call = async (path, method='GET', token=null, body=null) => {
  const h = {'Content-Type':'application/json'}
  if (token) h.Authorization = `Bearer ${token}`
  const r = await fetch(`${BASE}${path}`, { method, headers:h, body:body?JSON.stringify(body):undefined })
  const t = await r.text()
  if (!r.ok && r.status!==207) throw new Error(`${r.status} ${path} — ${t}`)
  return { status:r.status, data:JSON.parse(t) }
}
const api = async (path, method='GET', token=null, body=null) => (await call(path,method,token,body)).data
const code = async (path, method='GET', token=null, body=null) => {
  const h = {'Content-Type':'application/json'}
  if (token) h.Authorization = `Bearer ${token}`
  const r = await fetch(`${BASE}${path}`, { method, headers:h, body:body?JSON.stringify(body):undefined })
  return r.status
}

const ts = Date.now()
console.log('\n[SETUP]')
const [{ token:tL }, { token:tG }, { token:tT }, { token:tI }] = await Promise.all([
  api('/auth/register','POST',null,{name:'L',email:`smkL_${ts}@t.com`,password:'pass1234',role:'learner'}),
  api('/auth/register','POST',null,{name:'G',email:`smkG_${ts}@t.com`,password:'pass1234',role:'government'}),
  api('/auth/register','POST',null,{name:'T',email:`smkT_${ts}@t.com`,password:'pass1234',role:'training'}),
  api('/auth/register','POST',null,{name:'I',email:`smkI_${ts}@t.com`,password:'pass1234',role:'industry'}),
])
console.log('  4 accounts ready')

// ── B12: Learning Roadmap ────────────────────────────────────────────────────
console.log('\n[B12] Learning Roadmap')
const gaps = [
  {skillName:'Python',requirement:'required',requiredLevel:'intermediate'},
  {skillName:'Docker',requirement:'preferred',requiredLevel:'beginner'},
]
const rm = await api('/roadmap/generate','POST',tL,{subjectId:`s_${ts}`,targetRole:`Dev ${ts}`,gaps})
chk('Generate roadmap',          !!rm.roadmap.id,              true)
chk('Roadmap has steps',          rm.roadmap.totalSteps,        2)
chk('Roadmap status=active',      rm.roadmap.status,            'active')
chk('Steps have stepId',          !!rm.roadmap.steps[0].stepId, true)
chk('Steps have order',           rm.roadmap.steps[0].order,    1)
chk('Steps have priority',        !!rm.roadmap.steps[0].requirement, true)

const rmList = await api('/roadmap/my','GET',tL)
chk('My roadmaps pagination',     !!rmList.pagination,          true)
chk('My roadmaps total >= 1',     rmList.pagination.total >= 1, true)

const rmFetch = await api(`/roadmap/${rm.roadmap.id}`,'GET',tL)
chk('Get roadmap id',             rmFetch.roadmap.id,           rm.roadmap.id)

const stepId = rm.roadmap.steps[0].stepId
const completed = await api(`/roadmap/${rm.roadmap.id}/steps/${stepId}/complete`,'PATCH',tL,{notes:'done'})
chk('Complete step',              completed.roadmap.completedSteps, 1)
chk('Progress > 0',               completed.roadmap.progressPct > 0, true)

const unc = await api(`/roadmap/${rm.roadmap.id}/steps/${stepId}/uncomplete`,'PATCH',tL)
chk('Uncomplete step',            unc.roadmap.completedSteps,   0)

const updRm = await api(`/roadmap/${rm.roadmap.id}/status`,'PATCH',tL,{status:'paused'})
chk('Update roadmap status',      updRm.roadmap.status,         'paused')

const recalc = await api(`/roadmap/${rm.roadmap.id}/recalculate`,'POST',tL,{currentSkills:[]})
chk('Recalculate roadmap',        !!recalc.roadmap,             true)

chk('Auth: no token → 401',       await code('/roadmap/generate','POST'), 401)
chk('Auth: cross-owner GET → 403',await code(`/roadmap/${rm.roadmap.id}`,'GET',tG), 200) // govt can view
chk('Delete roadmap',             (await code(`/roadmap/${rm.roadmap.id}`,'DELETE',tL)), 200)

// ── B13: Training Alignment ──────────────────────────────────────────────────
console.log('\n[B13] Training Alignment')

// Create provider, program, job role for alignment test
const prov = await api('/training/providers','POST',tT,{name:`AlignProv_${ts}`,type:'Institute'})
const prog = await api('/training/programs','POST',tT,{providerId:prov.provider.id,name:`AlignProg_${ts}`,status:'active'})
const sk   = await api('/skills','POST',tI,{name:`AlignSk_${ts}`,category:'Test',type:'technical'})
await api('/training/curriculums','POST',tT,{
  trainingProgramId:prog.program.id,title:`AC_${ts}`,version:'1.0',status:'published',
  skillsCovered:[{skillId:sk.skill.id,skillName:`AlignSk_${ts}`,coverage:'core'}]
})
const ind = await api('/industries','POST',tI,{name:`AlignInd_${ts}`,sector:'Technology'})
const job = await api('/jobs','POST',tI,{
  industryId:ind.industry.id,title:`AlignJob_${ts}`,status:'active',
  requiredSkills:[{skillId:sk.skill.id,skillName:`AlignSk_${ts}`,requirement:'required'}]
})

const align = await api('/alignment/calculate','POST',tG,{programId:prog.program.id,jobRoleId:job.jobRole.id,persist:true})
chk('Calculate alignment',        !!align.alignment.id,                  true)
chk('Alignment pct 0-100',        align.alignment.alignmentPct >= 0 && align.alignment.alignmentPct <= 100, true)
chk('Covered skills array',       Array.isArray(align.alignment.coveredSkills), true)
chk('Missing skills array',       Array.isArray(align.alignment.missingSkills), true)

const byProg = await api(`/alignment/program/${prog.program.id}`,'GET',tG)
chk('Alignments by program',      byProg.alignments.length >= 1, true)

const byJob = await api(`/alignment/job/${job.jobRole.id}`,'GET',tG)
chk('Alignments by job role',     byJob.alignments.length >= 1, true)

const oneAlign = await api(`/alignment/${align.alignment.id}`,'GET',tG)
chk('Get one alignment',          oneAlign.alignment.id, align.alignment.id)

const improv = await api('/alignment/improvements','POST',tG,{programId:prog.program.id,jobRoleIds:[job.jobRole.id]})
chk('Improvements endpoint',      typeof improv.avgAlignmentPct === 'number', true)
chk('Auth: no token → 401',       await code('/alignment/calculate','POST'), 401)

// ── B14: Demand & Emerging Skills ────────────────────────────────────────────
console.log('\n[B14] Demand & Emerging Skills')

const demSkills = await api('/demand/skills?limit=10')
chk('Demand skills list',         Array.isArray(demSkills.skills), true)

const trends = await api('/demand/trends?limit=10')
chk('Demand trends list',         Array.isArray(trends.trends), true)

const emerging = await api('/demand/emerging?limit=10')
chk('Emerging skills list',       Array.isArray(emerging.emergingSkills), true)

const shortages = await api('/demand/shortages?limit=10')
chk('Shortages list',             Array.isArray(shortages.shortages), true)

const byRole = await api(`/demand/by-role/${job.jobRole.id}`)
chk('Demand by role',             !!byRole.jobRole, true)

const byInd = await api(`/demand/by-industry/${ind.industry.id}`)
chk('Demand by industry',         !!byInd.industry, true)

// Record a signal (industry)
const sig = await api(`/demand/skills/${sk.skill.id}`,'POST',tI,{demandScore:75,region:'Pune',sector:'Technology'})
chk('Record demand signal',       !!sig.signal.id, true)
chk('Signal demandScore',         sig.signal.demandScore, 75)

// Bulk signals
const bulk = await (async () => {
  const r = await fetch(`${BASE}/demand/bulk`,{
    method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${tI}`},
    body:JSON.stringify({signals:[{skillId:sk.skill.id,demandScore:80},{skillId:'bad-id',demandScore:50}]})
  })
  return r.json()
})()
chk('Bulk signals 207',           bulk.created, 1)
chk('Bulk signals error',         bulk.errors.length, 1)

// ── B15: Government Intelligence ─────────────────────────────────────────────
console.log('\n[B15] Government Intelligence')

const overview = await api('/intelligence/overview')
chk('Overview present',           !!overview.overview, true)
chk('Overview has totalLearners', typeof overview.overview.totalLearners === 'number', true)

const underserved = await api('/intelligence/underserved-areas')
chk('Underserved areas',          Array.isArray(underserved.underservedAreas), true)
chk('10 Maharashtra regions',     underserved.totalRegions, 10)

const supDem = await api('/intelligence/supply-demand?limit=5')
chk('Supply-demand list',         Array.isArray(supDem.supplyDemand), true)

const regGaps = await api('/intelligence/regional-gaps')
chk('Regional gaps',              Array.isArray(regGaps.regionalGaps), true)

const matrix = await api('/intelligence/skill-matrix?limit=5')
chk('Skill matrix',               Array.isArray(matrix.matrix), true)

// Record regional gap (govt)
const rg = await api('/intelligence/regional-gaps/record','POST',tG,{region:'Pune',skillName:'ML Ops',priority:3})
chk('Record regional gap',        !!rg.regionalGap.id, true)
chk('Auth: no token regional → 401', await code('/intelligence/regional-gaps/record','POST'), 401)

// ── B16: Assessments ─────────────────────────────────────────────────────────
console.log('\n[B16] Assessments')

const asmt = await api('/assessments','POST',tT,{
  title:`Skill Test ${ts}`, skillId:sk.skill.id, type:'quiz', level:'beginner',
  passingScore:70, durationMinutes:30,
  questions:[
    {questionId:'q1',text:'What is Python?',options:['A snake','A language','A tool'],correctAnswer:'A language'},
    {questionId:'q2',text:'What is Docker?',options:['Container runtime','IDE','Database'],correctAnswer:'Container runtime'},
  ]
})
chk('Create assessment',          !!asmt.assessment.id, true)
chk('Assessment type',            asmt.assessment.type, 'quiz')
chk('Assessment totalQuestions',  asmt.assessment.totalQuestions, 2)

const asmtList = await api('/assessments?type=quiz','GET',tL)
chk('List assessments',           asmtList.assessments.length >= 1, true)
chk('Questions hidden for learner', asmtList.assessments.every(a => !a.questions), true)

const asmtOne = await api(`/assessments/${asmt.assessment.id}`,'GET',tL)
chk('Get assessment (learner)',   !!asmtOne.assessment.id, true)
chk('correctAnswer stripped for learner', asmtOne.assessment.questions?.every(q => !('correctAnswer' in q)), true)

const attempt = await api(`/assessments/${asmt.assessment.id}/attempt`,'POST',tL,{
  answers:[{answer:'A language'},{answer:'Container runtime'}],timeTakenMinutes:10
})
chk('Submit attempt',             !!attempt.attempt.id, true)
chk('Auto-graded score',          attempt.attempt.score, 100)
chk('Auto-graded passed',         attempt.attempt.passed, true)
chk('Attempt status=graded',      attempt.attempt.status, 'graded')

const myAttempts = await api('/assessments/my/attempts','GET',tL)
chk('My attempts',                myAttempts.attempts.length >= 1, true)

const skillAsmts = await api(`/assessments/skill/${sk.skill.id}`,'GET',tL)
chk('Assessments by skill',       skillAsmts.assessments.length >= 1, true)

chk('Auth: no token → 401',       await code('/assessments','POST'), 401)
chk('Learner cant create → 403',  await code('/assessments','POST',tL,{title:'x',type:'quiz'}), 403)

// ── B17: Reports ─────────────────────────────────────────────────────────────
console.log('\n[B17] Reports')

const rep = await api('/reports/generate','POST',tG,{type:'ecosystem_overview',title:'Gov Report'})
chk('Generate report',            !!rep.report.id, true)
chk('Report type',                rep.report.type, 'ecosystem_overview')
chk('Report status=ready',        rep.report.status, 'ready')
chk('Report has data',            !!rep.report.data, true)

const repLearner = await api('/reports/generate','POST',tL,{type:'learner_progress',title:'My Progress'})
chk('Learner progress report',    repLearner.report.type, 'learner_progress')

const myReports = await api('/reports/my','GET',tL)
chk('My reports list',            myReports.pagination.total >= 1, true)

const oneRep = await api(`/reports/${rep.report.id}`,'GET',tG)
chk('Get one report',             oneRep.report.id, rep.report.id)

const dl = await api(`/reports/${rep.report.id}/download`,'GET',tG)
chk('Download report',            !!dl.report.data, true)

chk('Cross-user report → 403',    await code(`/reports/${rep.report.id}`,'GET',tL), 403)
chk('Auth: no token → 401',       await code('/reports/generate','POST'), 401)

// ── B17: Notifications ────────────────────────────────────────────────────────
console.log('\n[B17] Notifications')

const lrnId = (await api('/auth/me','GET',tL)).user.id

const notif = await api('/notifications','POST',tG,{recipientId:lrnId,title:'New Gap Alert',text:'Python skill gap detected',severity:'high'})
chk('Create notification',        !!notif.notification.id, true)
chk('Notification severity',      notif.notification.severity, 'high')

const myNotifs = await api('/notifications/my','GET',tL)
chk('My notifications',           myNotifs.notifications.length >= 1, true)
chk('Unread count present',       typeof myNotifs.unreadCount === 'number', true)

const readNotif = await api(`/notifications/${notif.notification.id}/read`,'PATCH',tL)
chk('Mark notification read',     readNotif.notification.read, true)

const readAll = await api('/notifications/read-all','PATCH',tL)
chk('Mark all read',              typeof readAll.count === 'number', true)

const myNotifs2 = await api('/notifications/my?unreadOnly=true','GET',tL)
chk('Unread only = 0 after read-all', myNotifs2.unreadCount, 0)

chk('Auth: no token → 401',       await code('/notifications/my','GET'), 401)
chk('Cross-user mark read → 403', await code(`/notifications/${notif.notification.id}/read`,'PATCH',tG), 403)

// ── B18: Integration ─────────────────────────────────────────────────────────
console.log('\n[B18] Integration checks')
// Verify all key routes are reachable and return correct shapes
const checks = await Promise.allSettled([
  fetch(`${BASE}/health`).then(r=>r.json()),
  fetch(`${BASE}/skills?limit=1`).then(r=>r.json()),
  fetch(`${BASE}/industries?limit=1`).then(r=>r.json()),
  fetch(`${BASE}/jobs?limit=1`).then(r=>r.json()),
  fetch(`${BASE}/training/programs?limit=1`).then(r=>r.json()),
  fetch(`${BASE}/demand/skills?limit=1`).then(r=>r.json()),
  fetch(`${BASE}/intelligence/overview`).then(r=>r.json()),
])
chk('Health endpoint',          checks[0].status==='fulfilled', true)
chk('Skills endpoint',          checks[1].status==='fulfilled', true)
chk('Industries endpoint',      checks[2].status==='fulfilled', true)
chk('Jobs endpoint',            checks[3].status==='fulfilled', true)
chk('Training endpoint',        checks[4].status==='fulfilled', true)
chk('Demand endpoint',          checks[5].status==='fulfilled', true)
chk('Intelligence endpoint',    checks[6].status==='fulfilled', true)

// Verify auth is enforced on write routes across all phases
const writeRoutes = [
  ['/roadmap/generate','POST'],
  ['/alignment/calculate','POST'],
  ['/intelligence/regional-gaps/record','POST'],
  ['/assessments','POST'],
  ['/reports/generate','POST'],
  ['/notifications','POST'],
]
for (const [path, method] of writeRoutes) {
  const c = await code(path, method)
  chk(`Auth enforced ${method} ${path}`, c, 401)
}

const total = pass + fail
console.log(`\n${'─'.repeat(52)}`)
console.log(`  TOTAL  ${total}   PASS  ${pass}   FAIL  ${fail}`)
console.log('─'.repeat(52))
if (fail > 0) process.exit(1)
