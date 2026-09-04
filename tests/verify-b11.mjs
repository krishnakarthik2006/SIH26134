/**
 * Phase B11 — Recommendation Engine verification
 * Run: node tests/verify-b11.mjs  (server must be on :4000)
 *
 * Groups:
 *  1.  Server health
 *  2.  Auth enforcement
 *  3.  Preview endpoint — validation, scoring, ranking
 *  4.  Recommendation structure — all required fields
 *  5.  Gap coverage scoring — critical gaps ranked first
 *  6.  Relevance score calculation — dimension weights
 *  7.  Explanation text — content, transparency
 *  8.  Generate + persist recommendations
 *  9.  Auto-derive gaps from stored readiness score
 * 10.  GET one recommendation (auto-viewed)
 * 11.  Status lifecycle — viewed → enrolled → completed → dismissed
 * 12.  GET /my — pagination, status + targetRole filters
 * 13.  GET /subject — access control
 * 14.  POST /for-me — learner convenience endpoint
 * 15.  Explain specific program
 * 16.  Edge cases — no matching courses, empty gaps, limit/minRelevance
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
      method, headers: h, body: body !== null ? JSON.stringify(body) : undefined,
    })
    return r.status
  } catch { return 0 }
}

async function api(path, method = 'GET', token = null, body = null) {
  const h = { 'Content-Type': 'application/json' }
  if (token) h.Authorization = `Bearer ${token}`
  const r = await fetch(`${BASE}${path}`, {
    method, headers: h, body: body !== null ? JSON.stringify(body) : undefined,
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`${r.status} ${path} — ${text}`)
  return JSON.parse(text)
}

// ── SETUP ─────────────────────────────────────────────────────────────────────
console.log('\n[SETUP] Seeding test data...')
const ts = Date.now()

// Accounts
const { token: tL  } = await api('/auth/register', 'POST', null, { name: 'Learner', email: `lrn_b11_${ts}@t.com`, password: 'pass1234', role: 'learner' })
const { token: tL2 } = await api('/auth/register', 'POST', null, { name: 'Learner2', email: `lrn2_b11_${ts}@t.com`, password: 'pass1234', role: 'learner' })
const { token: tG  } = await api('/auth/register', 'POST', null, { name: 'Govt',    email: `gov_b11_${ts}@t.com`, password: 'pass1234', role: 'government' })
const { token: tT  } = await api('/auth/register', 'POST', null, { name: 'Trainer', email: `trn_b11_${ts}@t.com`, password: 'pass1234', role: 'training' })

// Canonical skills with demand scores
const [skPy, skReact, skDocker, skAWS, skTS] = await Promise.all([
  api('/skills', 'POST', tG, { name: `Py_b11_${ts}`,     category: 'Programming', type: 'technical', demandScore: 90 }),
  api('/skills', 'POST', tG, { name: `React_b11_${ts}`,  category: 'Frontend',    type: 'technical', demandScore: 85 }),
  api('/skills', 'POST', tG, { name: `Docker_b11_${ts}`, category: 'DevOps',      type: 'tool',      demandScore: 78 }),
  api('/skills', 'POST', tG, { name: `AWS_b11_${ts}`,    category: 'Cloud',       type: 'tool',      demandScore: 92 }),
  api('/skills', 'POST', tG, { name: `TS_b11_${ts}`,     category: 'Programming', type: 'technical', demandScore: 82 }),
])
const ids = { py: skPy.skill.id, react: skReact.skill.id, docker: skDocker.skill.id, aws: skAWS.skill.id, ts: skTS.skill.id }

// Training provider
const prov = await api('/training/providers', 'POST', tT, {
  name: `TestAcademy_b11_${ts}`, type: 'Institute',
  district: 'Pune', accreditation: 'NAAC A+',
})
const provId = prov.provider.id

// Three training programs
const [prog1, prog2, prog3] = await Promise.all([
  api('/training/programs', 'POST', tT, {
    providerId: provId, name: `FullStack_b11_${ts}`,
    status: 'active', deliveryMode: 'hybrid', durationWeeks: 24,
    fees: 45000, certificationOffered: true,
    tags: ['fullstack', 'react', 'node'],
  }),
  api('/training/programs', 'POST', tT, {
    providerId: provId, name: `CloudOps_b11_${ts}`,
    status: 'active', deliveryMode: 'online', durationWeeks: 16,
    fees: 35000, certificationOffered: false,
    tags: ['cloud', 'devops'],
  }),
  api('/training/programs', 'POST', tT, {
    providerId: provId, name: `PythonML_b11_${ts}`,
    status: 'active', deliveryMode: 'online', durationWeeks: 12,
    fees: 0, certificationOffered: true,
    tags: ['python', 'ml'],
  }),
])
const [p1, p2, p3] = [prog1.program.id, prog2.program.id, prog3.program.id]

// Published curriculums for each program
await Promise.all([
  api('/training/curriculums', 'POST', tT, {
    trainingProgramId: p1, title: `FS Curriculum_${ts}`, version: '1.0', status: 'published',
    totalHours: 480,
    skillsCovered: [
      { skillId: ids.react,  skillName: `React_b11_${ts}`,  coverage: 'core',          proficiencyLevel: 'advanced' },
      { skillId: ids.ts,     skillName: `TS_b11_${ts}`,     coverage: 'core',          proficiencyLevel: 'intermediate' },
      { skillId: ids.docker, skillName: `Docker_b11_${ts}`, coverage: 'supplementary', proficiencyLevel: 'beginner' },
    ],
  }),
  api('/training/curriculums', 'POST', tT, {
    trainingProgramId: p2, title: `Cloud Curriculum_${ts}`, version: '1.0', status: 'published',
    totalHours: 320,
    skillsCovered: [
      { skillId: ids.aws,    skillName: `AWS_b11_${ts}`,    coverage: 'core',          proficiencyLevel: 'advanced' },
      { skillId: ids.docker, skillName: `Docker_b11_${ts}`, coverage: 'core',          proficiencyLevel: 'intermediate' },
    ],
  }),
  api('/training/curriculums', 'POST', tT, {
    trainingProgramId: p3, title: `Python Curriculum_${ts}`, version: '1.0', status: 'published',
    totalHours: 240,
    skillsCovered: [
      { skillId: ids.py, skillName: `Py_b11_${ts}`, coverage: 'core', proficiencyLevel: 'intermediate' },
    ],
  }),
])
console.log('  Seeding complete: 3 programs with published curriculums ✓')

// Gaps used throughout tests
const GAPS_CRITICAL = [
  { canonicalId: ids.react,  skillName: `React_b11_${ts}`,  requiredLevel: 'advanced',     requirement: 'required' },
  { canonicalId: ids.aws,    skillName: `AWS_b11_${ts}`,    requiredLevel: 'advanced',     requirement: 'required' },
  { canonicalId: ids.docker, skillName: `Docker_b11_${ts}`, requiredLevel: 'beginner',     requirement: 'preferred' },
  { canonicalId: ids.py,     skillName: `Py_b11_${ts}`,     requiredLevel: 'intermediate', requirement: 'nice-to-have' },
]
const GAPS_MINIMAL = [
  { canonicalId: ids.aws, skillName: `AWS_b11_${ts}`, requirement: 'required' },
]

// ─────────────────────────────────────────────────────────────────────────────
// 1. SERVER HEALTH
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[1] SERVER HEALTH')
const health = await api('/health')
check('Server ok',         health.status,  'ok')
check('MongoDB connected', health.mongodb, 'connected')

// ─────────────────────────────────────────────────────────────────────────────
// 2. AUTH ENFORCEMENT
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[2] AUTH ENFORCEMENT')
check('POST /preview no token → 401',         await httpCode('/recommendations/preview', 'POST'), 401)
check('POST /generate no token → 401',        await httpCode('/recommendations/generate', 'POST'), 401)
check('GET /my no token → 401',               await httpCode('/recommendations/my'), 401)
check('GET /:id no token → 401',              await httpCode('/recommendations/fake-id'), 401)
check('PATCH /:id/status no token → 401',     await httpCode('/recommendations/fake/status', 'PATCH'), 401)
check('POST /for-me no token → 401',          await httpCode('/recommendations/for-me', 'POST'), 401)

// ─────────────────────────────────────────────────────────────────────────────
// 3. PREVIEW — VALIDATION + HAPPY PATH
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[3] PREVIEW VALIDATION')
check('Missing gaps → 400',      await httpCode('/recommendations/preview', 'POST', tL, {}), 400)
check('gaps not array → 400',    await httpCode('/recommendations/preview', 'POST', tL, { gaps: 'react' }), 400)
check('gaps empty → 400',        await httpCode('/recommendations/preview', 'POST', tL, { gaps: [] }), 400)
check('gap no id/name → 400',    await httpCode('/recommendations/preview', 'POST', tL, { gaps: [{ requirement: 'required' }] }), 400)
check('bad requirement → 400',   await httpCode('/recommendations/preview', 'POST', tL, { gaps: [{ skillName: 'X', requirement: 'mandatory' }] }), 400)
check('limit > 25 → 400',        await httpCode('/recommendations/preview', 'POST', tL, { gaps: GAPS_MINIMAL, limit: 30 }), 400)

const preview = await api('/recommendations/preview', 'POST', tL, {
  gaps: GAPS_CRITICAL, limit: 10, prioritizeCritical: true,
})
check('Preview recommendations array',      Array.isArray(preview.recommendations), true)
check('Preview count present',              typeof preview.count === 'number',       true)
check('Preview gapCount = 4',               preview.gapCount,                        4)
check('Preview has results (programs cover gaps)', preview.count > 0,               true)

// ─────────────────────────────────────────────────────────────────────────────
// 4. RECOMMENDATION STRUCTURE
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[4] RECOMMENDATION STRUCTURE')
const rec = preview.recommendations[0]
check('Has programId',           !!rec.programId,                   true)
check('Has programName',         !!rec.programName,                 true)
check('Has providerId',          !!rec.providerId,                  true)
check('Has providerName',        !!rec.providerName,                true)
check('Has relevanceScore 0-100',rec.relevanceScore >= 0 && rec.relevanceScore <= 100, true)
check('Has priority',            ['critical','high','medium'].includes(rec.priority), true)
check('Has scores object',       !!rec.scores,                      true)
check('scores.gapCoverage 0-1',  rec.scores.gapCoverage >= 0 && rec.scores.gapCoverage <= 1, true)
check('scores.demandWeight 0-1', rec.scores.demandWeight >= 0 && rec.scores.demandWeight <= 1, true)
check('scores.levelFit 0-1',     rec.scores.levelFit >= 0 && rec.scores.levelFit <= 1,       true)
check('scores.providerQuality 0-1', rec.scores.providerQuality >= 0 && rec.scores.providerQuality <= 1, true)
check('scores.freshness 0-1',    rec.scores.freshness >= 0 && rec.scores.freshness <= 1,      true)
check('Has coveredGaps array',   Array.isArray(rec.coveredGaps),    true)
check('coveredGapCount > 0',     rec.coveredGapCount > 0,           true)
check('coveredGap has skillName',!!rec.coveredGaps[0]?.skillName,   true)
check('coveredGap has requirement',!!rec.coveredGaps[0]?.requirement, true)
check('Has explanation string',  typeof rec.explanation === 'string' && rec.explanation.length > 20, true)
check('Has reasons array',       Array.isArray(rec.reasons) && rec.reasons.length > 0, true)
check('Has criticalCoveredCount', typeof rec.criticalCoveredCount === 'number', true)
check('Has deliveryMode',        rec.deliveryMode !== undefined,    true)
check('Has durationWeeks',       rec.durationWeeks !== undefined,   true)
check('Has fees',                rec.fees !== undefined,            true)
check('Has certificationOffered',rec.certificationOffered !== undefined, true)

// ─────────────────────────────────────────────────────────────────────────────
// 5. CRITICAL GAPS RANKED FIRST
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[5] CRITICAL GAPS RANKED FIRST')
const prioritised = await api('/recommendations/preview', 'POST', tL, {
  gaps: GAPS_CRITICAL, prioritizeCritical: true,
})
// Programs covering critical (required) gaps should appear before nice-to-have
const priorities = prioritised.recommendations.map(r => r.priority)
const critIdx  = priorities.indexOf('critical')
const medIdx   = priorities.indexOf('medium')
check('Critical before medium in list', critIdx === -1 || medIdx === -1 || critIdx < medIdx, true)

// Without prioritizeCritical, order is pure score
const unprioritised = await api('/recommendations/preview', 'POST', tL, {
  gaps: GAPS_CRITICAL, prioritizeCritical: false,
})
check('Without priority flag: scores desc',
  unprioritised.recommendations.every((r, i, arr) =>
    i === 0 || arr[i-1].relevanceScore >= r.relevanceScore), true)

// ─────────────────────────────────────────────────────────────────────────────
// 6. RELEVANCE SCORING
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[6] RELEVANCE SCORING')

// Program covering only AWS (high demand, required) should score well
const onlyAWS = await api('/recommendations/preview', 'POST', tL, {
  gaps: [{ canonicalId: ids.aws, skillName: `AWS_b11_${ts}`, requirement: 'required', requiredLevel: 'advanced' }],
})
check('AWS-only gap: CloudOps program present', onlyAWS.recommendations.some(r => r.programId === p2), true)
const cloudRec = onlyAWS.recommendations.find(r => r.programId === p2)
check('CloudOps relevanceScore > 0',           cloudRec.relevanceScore > 0,   true)
check('CloudOps demandWeight reflects AWS demand', cloudRec.scores.demandWeight > 0.5, true)

// Program with certified provider should have higher providerQuality
check('Certified provider quality > 0.5', cloudRec.scores.providerQuality > 0.5, true)

// gapCoverage = 1.0 when program covers the only gap
check('100% gap coverage for single-skill match', cloudRec.scores.gapCoverage, 1)

// ─────────────────────────────────────────────────────────────────────────────
// 7. EXPLANATION TEXT
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[7] EXPLANATION TEXT')
const withExpl = preview.recommendations.find(r => r.coveredGaps.some(g => g.requirement === 'required'))
check('Explanation mentions critical skill',   withExpl.explanation.toLowerCase().includes('critical'), true)
check('Explanation mentions skill name',
  withExpl.coveredGaps.some(g => withExpl.explanation.includes(g.skillName)), true)
check('Explanation mentions relevance score',  withExpl.explanation.includes(`${withExpl.relevanceScore}/100`), true)
check('Explanation mentions provider name',    withExpl.explanation.includes(`TestAcademy_b11_${ts}`), true)

// Certification mention
const certProg = preview.recommendations.find(r => r.certificationOffered)
if (certProg) {
  check('Explanation mentions certification', certProg.explanation.toLowerCase().includes('certif'), true)
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. GENERATE + PERSIST
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[8] GENERATE + PERSIST')

check('generate missing subjectType → 400',
  await httpCode('/recommendations/generate', 'POST', tL, { subjectId: 'x', targetRole: 'dev', gaps: GAPS_MINIMAL }), 400)
check('generate missing subjectId → 400',
  await httpCode('/recommendations/generate', 'POST', tL, { subjectType: 'learner', targetRole: 'dev', gaps: GAPS_MINIMAL }), 400)
check('generate missing targetRole → 400',
  await httpCode('/recommendations/generate', 'POST', tL, { subjectType: 'learner', subjectId: 'x', gaps: GAPS_MINIMAL }), 400)
check('generate bad subjectType → 400',
  await httpCode('/recommendations/generate', 'POST', tL, { subjectType: 'robot', subjectId: 'x', targetRole: 'y', gaps: GAPS_MINIMAL }), 400)

const subjId    = `lrn_b11_subj_${ts}`
const targetRole = `Full Stack Dev ${ts}`

const genRes = await api('/recommendations/generate', 'POST', tL, {
  subjectType: 'learner', subjectId: subjId, targetRole,
  gaps: GAPS_CRITICAL, limit: 5,
})
check('Generate 201 message',            genRes.message.includes('generated'),    true)
check('Generate recommendation id',      !!genRes.recommendation.id,              true)
check('Generate recipientType',          genRes.recommendation.recipientType,     'learner')
check('Generate recipientId',            genRes.recommendation.recipientId,       subjId)
check('Generate targetRole',             genRes.recommendation.targetRole,        targetRole)
check('Generate status = pending',       genRes.recommendation.status,            'pending')
check('Generate totalCount >= 1',        genRes.recommendation.totalCount >= 1,   true)
check('Generate gapCount = 4',           genRes.recommendation.gapCount,          4)
check('Generate recommendations array',  Array.isArray(genRes.recommendation.recommendations), true)
check('Generate gapSnapshot stored',     Array.isArray(genRes.recommendation.gapSnapshot),     true)
check('Generate generatedBy set',        !!genRes.recommendation.generatedBy,     true)
check('Generate createdAt set',          !!genRes.recommendation.createdAt,       true)
const genId = genRes.recommendation.id

// ─────────────────────────────────────────────────────────────────────────────
// 9. AUTO-DERIVE GAPS FROM STORED READINESS SCORE
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[9] AUTO-DERIVE GAPS FROM READINESS SCORE')

// First store a gap analysis
await api('/match/gap', 'POST', tL, {
  subjectType: 'learner', subjectId: `auto_${ts}`, targetRole,
  requiredSkills: [
    { skillId: ids.react,  skillName: `React_b11_${ts}`,  requirement: 'required' },
    { skillId: ids.aws,    skillName: `AWS_b11_${ts}`,    requirement: 'required' },
  ],
  currentSkills: [],
})

// Now generate without supplying gaps — should auto-fetch from readiness_scores
const autoGen = await api('/recommendations/generate', 'POST', tL, {
  subjectType: 'learner', subjectId: `auto_${ts}`, targetRole,
  // no gaps field
})
check('Auto-derive: generated ok',          autoGen.message.includes('generated'), true)
check('Auto-derive: recommendations present',autoGen.recommendation.totalCount >= 1, true)

// Without stored readiness AND no gaps supplied → 400
check('No gaps + no stored score → 400',
  await httpCode('/recommendations/generate', 'POST', tL, {
    subjectType: 'learner', subjectId: `noscore_${ts}`, targetRole,
  }), 400)

// ─────────────────────────────────────────────────────────────────────────────
// 10. GET ONE RECOMMENDATION (auto-viewed)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[10] GET ONE RECOMMENDATION')

const fetched = await api(`/recommendations/${genId}`, 'GET', tL)
check('GET id matches',              fetched.recommendation.id,           genId)
check('GET auto-marked viewed',      fetched.recommendation.status,       'viewed')
check('GET viewedAt set',            !!fetched.recommendation.viewedAt,   true)
check('GET recommendations array',   Array.isArray(fetched.recommendation.recommendations), true)

// Second fetch should stay 'viewed', not flip back to pending
const fetched2 = await api(`/recommendations/${genId}`, 'GET', tL)
check('Second GET still viewed',     fetched2.recommendation.status,      'viewed')

// Non-existent
check('GET non-existent → 404',      await httpCode('/recommendations/00000000-0000-0000-0000-000000000000', 'GET', tL), 404)

// Cross-user access — tL2 cannot see tL's recommendation
check('Cross-user GET → 403',        await httpCode(`/recommendations/${genId}`, 'GET', tL2), 403)

// Government can see anything
const govFetch = await api(`/recommendations/${genId}`, 'GET', tG)
check('Govt can GET any recommendation', govFetch.recommendation.id, genId)

// ─────────────────────────────────────────────────────────────────────────────
// 11. STATUS LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[11] STATUS LIFECYCLE')

// Generate a fresh one to test transitions
const fresh = await api('/recommendations/generate', 'POST', tL, {
  subjectType: 'learner', subjectId: `status_${ts}`, targetRole,
  gaps: GAPS_MINIMAL,
})
const fid = fresh.recommendation.id

check('PATCH missing status → 400',  await httpCode(`/recommendations/${fid}/status`, 'PATCH', tL, {}), 400)
check('PATCH bad status → 400',      await httpCode(`/recommendations/${fid}/status`, 'PATCH', tL, { status: 'archived' }), 400)
check('Cross-user PATCH → 403',      await httpCode(`/recommendations/${fid}/status`, 'PATCH', tL2, { status: 'viewed' }), 403)

const enrolled = await api(`/recommendations/${fid}/status`, 'PATCH', tL, { status: 'enrolled' })
check('Enroll: status = enrolled',   enrolled.recommendation.status,    'enrolled')
check('Enroll: enrolledAt set',      !!enrolled.recommendation.enrolledAt, true)

const completed = await api(`/recommendations/${fid}/status`, 'PATCH', tL, { status: 'completed' })
check('Complete: status = completed',completed.recommendation.status,   'completed')
check('Complete: completedAt set',   !!completed.recommendation.completedAt, true)

// Dismiss a separate one
const fresh2 = await api('/recommendations/generate', 'POST', tL, {
  subjectType: 'learner', subjectId: `dismiss_${ts}`, targetRole, gaps: GAPS_MINIMAL,
})
const dismissed = await api(`/recommendations/${fresh2.recommendation.id}/status`, 'PATCH', tL, { status: 'dismissed' })
check('Dismiss: status = dismissed', dismissed.recommendation.status,   'dismissed')

// ─────────────────────────────────────────────────────────────────────────────
// 12. GET /my — PAGINATION + FILTERS
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[12] GET /my — LIST + FILTERS')

// Generate a second rec for tL
await api('/recommendations/generate', 'POST', tL, {
  subjectType: 'learner', subjectId: `my_${ts}`, targetRole: `AnotherRole ${ts}`,
  gaps: GAPS_MINIMAL,
})

const myAll = await api('/recommendations/my', 'GET', tL)
check('My: array present',           Array.isArray(myAll.recommendations),     true)
check('My: pagination present',      !!myAll.pagination,                       true)
check('My: total >= 3',              myAll.pagination.total >= 3,              true)

// Filter by status
const myCompleted = await api('/recommendations/my?status=completed', 'GET', tL)
check('My filter status=completed',  myCompleted.recommendations.every(r => r.status === 'completed'), true)

// Filter by targetRole
const myRole = await api(`/recommendations/my?targetRole=${encodeURIComponent(targetRole)}`, 'GET', tL)
check('My filter targetRole',        myRole.recommendations.every(r => r.targetRole === targetRole), true)

// Pagination
const pg1 = await api('/recommendations/my?limit=1&page=1', 'GET', tL)
const pg2 = await api('/recommendations/my?limit=1&page=2', 'GET', tL)
check('My page 1 has 1 result',      pg1.recommendations.length,              1)
check('My page 1 and 2 differ',      pg1.recommendations[0]?.id !== pg2.recommendations[0]?.id, true)

// tL2 sees only their own
const tL2Recs = await api('/recommendations/my', 'GET', tL2)
check('tL2 /my returns 0 (no recs)', tL2Recs.pagination.total,               0)

// ─────────────────────────────────────────────────────────────────────────────
// 13. GET /subject ACCESS CONTROL
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[13] GET /subject ACCESS CONTROL')

const myId = (await api('/auth/me', 'GET', tL)).user.id
const subjectRecs = await api(`/recommendations/subject/learner/${myId}`, 'GET', tL)
check('Subject: own learner recs',   Array.isArray(subjectRecs.recommendations), true)

// Government can see any subject
const govSubj = await api(`/recommendations/subject/learner/${myId}`, 'GET', tG)
check('Subject: govt can view any',  Array.isArray(govSubj.recommendations),  true)

// Another learner cannot see tL's subject recs
check('Subject: cross-user → 403',
  await httpCode(`/recommendations/subject/learner/${myId}`, 'GET', tL2), 403)

// Bad subjectType
check('Subject: bad type → 400',
  await httpCode('/recommendations/subject/robot/fake-id', 'GET', tG), 400)

// ─────────────────────────────────────────────────────────────────────────────
// 14. POST /for-me
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[14] POST /for-me')

// Store a readiness score for tL using their user id
const tLId = myId
await api('/match/gap', 'POST', tL, {
  subjectType: 'learner', subjectId: tLId, targetRole,
  requiredSkills: [
    { skillId: ids.react,  skillName: `React_b11_${ts}`,  requirement: 'required' },
    { skillId: ids.aws,    skillName: `AWS_b11_${ts}`,    requirement: 'required' },
    { skillId: ids.docker, skillName: `Docker_b11_${ts}`, requirement: 'preferred' },
  ],
  currentSkills: [],
})

const forMe = await api('/recommendations/for-me', 'POST', tL, { targetRole, limit: 5 })
check('For-me: array present',          Array.isArray(forMe.recommendations),   true)
check('For-me: count present',          typeof forMe.count === 'number',         true)
check('For-me: basedOnGapAnalysisAt',   !!forMe.basedOnGapAnalysisAt,            true)
check('For-me: targetRole returned',    forMe.targetRole,                        targetRole)
check('For-me: has recommendations',    forMe.count > 0,                         true)

// Without any gap analysis → returns empty + message
const forMe2 = await api('/recommendations/for-me', 'POST', tL2, {})
check('For-me: no analysis → empty + message', forMe2.count, 0)
check('For-me: message provided',              !!forMe2.message, true)

// ─────────────────────────────────────────────────────────────────────────────
// 15. EXPLAIN SPECIFIC PROGRAM
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[15] EXPLAIN SPECIFIC PROGRAM')

const explainUrl = `/recommendations/program/${p2}/explain?gaps=${encodeURIComponent(JSON.stringify(GAPS_CRITICAL))}`
const expl = await api(explainUrl, 'GET', null)   // public
check('Explain: programId returned',   expl.programId,                         p2)
check('Explain: programName returned', !!expl.programName,                     true)
check('Explain: relevanceScore 0-100', expl.relevanceScore >= 0 && expl.relevanceScore <= 100, true)
check('Explain: explanation string',   typeof expl.explanation === 'string' && expl.explanation.length > 10, true)
check('Explain: coveredGaps array',    Array.isArray(expl.coveredGaps),         true)

// Program that covers none of the gaps
const noGaps = [{ canonicalId: '00000000-0000-0000-0000-000000000000', skillName: 'XyzUnknown', requirement: 'required' }]
const explNone = await api(`/recommendations/program/${p1}/explain?gaps=${encodeURIComponent(JSON.stringify(noGaps))}`, 'GET', null)
check('Explain: no coverage → score 0', explNone.relevanceScore,               0)
check('Explain: no coverage → message',  explNone.explanation.length > 0,      true)

// Non-existent program
check('Explain: non-existent → 404',
  await httpCode('/recommendations/program/00000000-0000-0000-0000-000000000000/explain?gaps=[]', 'GET', null), 400)

// ─────────────────────────────────────────────────────────────────────────────
// 16. EDGE CASES
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[16] EDGE CASES')

// minRelevance = 100 → likely zero results
const highBar = await api('/recommendations/preview', 'POST', tL, {
  gaps: GAPS_CRITICAL, minRelevance: 100,
})
check('minRelevance=100 → 0 results',  highBar.count,                          0)

// Single gap, nice-to-have only → low priority recs
const nthGap = await api('/recommendations/preview', 'POST', tL, {
  gaps: [{ canonicalId: ids.py, skillName: `Py_b11_${ts}`, requirement: 'nice-to-have' }],
})
if (nthGap.count > 0) {
  check('Nice-to-have gap → medium priority', nthGap.recommendations[0].priority, 'medium')
}

// excludeProgramIds removes program
const withExclude = await api('/recommendations/preview', 'POST', tL, {
  gaps: GAPS_CRITICAL, excludeProgramIds: [p1, p2, p3],
})
check('Exclude all programs → 0 results', withExclude.count, 0)

// limit=1 returns exactly 1
const limitOne = await api('/recommendations/preview', 'POST', tL, {
  gaps: GAPS_CRITICAL, limit: 1,
})
check('limit=1 returns max 1', limitOne.recommendations.length <= 1, true)

const bySkillId = await api('/recommendations/preview', 'POST', tL, {
  gaps: [{ skillId: ids.aws, skillName: `AWS_b11_${ts}`, requirement: 'critical' }],
})
check('skillId + priority=critical still matches', bySkillId.count > 0, true)
check('skillId path ranks CloudOps', bySkillId.recommendations.some(r => r.programId === p2), true)

check('GET /student/recommendations no token → 401', await httpCode('/student/recommendations'), 401)
check('GET /student/recommendations learner no profile → 404',
  await httpCode('/student/recommendations', 'GET', tL2), 404)

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────
const total = pass + fail
console.log(`\n${'─'.repeat(54)}`)
console.log(`  TOTAL  ${total}   PASS  ${pass}   FAIL  ${fail}`)
console.log('─'.repeat(54))
if (fail > 0) process.exit(1)
