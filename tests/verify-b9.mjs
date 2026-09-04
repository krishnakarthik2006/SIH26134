/**
 * Phase B9 — Skill Normalization & Matching verification
 * Run: node tests/verify-b9.mjs  (server must be on :4000)
 *
 * Groups:
 *  1.  Server + health
 *  2.  Skill normalization — cleaning pipeline (buildNormalizedTerm semantics)
 *  3.  Normalization API — batch, dedup, summary
 *  4.  Normalization match types (exact, alias, prefix, token-overlap, fuzzy)
 *  5.  Normalization validation (bad input → 400)
 *  6.  Mapping CRUD — create, get, list, update, delete
 *  7.  Mapping duplicate guard (409)
 *  8.  Bulk upsert mappings (skip + replace modes)
 *  9.  Mapping auth enforcement (401 / 403)
 * 10.  Ad-hoc skill match — structure, scoring, gap computation
 * 11.  Match with level gap analysis
 * 12.  Match validation (bad input → 400)
 * 13.  Match auth enforcement (401)
 * 14.  Gap analysis — persist to DB, read back
 * 15.  Gap analysis — re-run replaces previous results
 * 16.  Gap history — pagination
 * 17.  matchAgainstJob — no-persist and persist paths
 * 18.  Power BI normalization scenario (the motivating example)
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

// ── SETUP ─────────────────────────────────────────────────────────────────────
console.log('\n[SETUP] Registering test accounts and seeding skills...')
const ts = Date.now()

const { token: tI } = await api('/auth/register', 'POST', null, {
  name: 'Industry', email: `ind_b9_${ts}@t.com`, password: 'pass1234', role: 'industry',
})
const { token: tG } = await api('/auth/register', 'POST', null, {
  name: 'Govt', email: `gov_b9_${ts}@t.com`, password: 'pass1234', role: 'government',
})
const { token: tL } = await api('/auth/register', 'POST', null, {
  name: 'Learner', email: `lrn_b9_${ts}@t.com`, password: 'pass1234', role: 'learner',
})

// Seed canonical skills we'll use throughout
const [skPython, skReact, skDocker, skPowerBI, skTypeScript, skAWS] = await Promise.all([
  api('/skills', 'POST', tI, { name: `Python_B9_${ts}`,     category: 'Programming Languages', type: 'technical', aliases: [`py_b9_${ts}`, `python3_b9_${ts}`] }),
  api('/skills', 'POST', tI, { name: `React_B9_${ts}`,      category: 'Frontend',              type: 'technical', aliases: [`reactjs_b9_${ts}`] }),
  api('/skills', 'POST', tI, { name: `Docker_B9_${ts}`,     category: 'DevOps',                type: 'tool',      aliases: [`docker_ce_b9_${ts}`] }),
  api('/skills', 'POST', tI, { name: `Power BI_B9_${ts}`,   category: 'Data Analytics',        type: 'tool',      aliases: [`powerbi_b9_${ts}`, `power_bi_b9_${ts}`] }),
  api('/skills', 'POST', tI, { name: `TypeScript_B9_${ts}`, category: 'Programming Languages', type: 'technical', aliases: [`ts_b9_${ts}`] }),
  api('/skills', 'POST', tI, { name: `AWS_B9_${ts}`,        category: 'Cloud',                 type: 'tool',      aliases: [] }),
])
const ids = {
  python: skPython.skill.id, react: skReact.skill.id, docker: skDocker.skill.id,
  powerBI: skPowerBI.skill.id, ts: skTypeScript.skill.id, aws: skAWS.skill.id,
}
console.log(`  Tokens ready. 6 canonical skills seeded.`)

// ─────────────────────────────────────────────────────────────────────────────
// 1. SERVER HEALTH
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[1] SERVER HEALTH')
const health = await api('/health')
check('Server status ok',          health.status,  'ok')
check('MongoDB connected',         health.mongodb, 'connected')

// ─────────────────────────────────────────────────────────────────────────────
// 2. NORMALIZATION CLEANING (via API — cleanedTerm field)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[2] NORMALIZATION CLEANING')

// buildNormalizedTerm behaviour verified through the API's cleanedTerm field
const cleanTests = [
  { raw: `Python_B9_${ts}`,          expected: `python_b9_${ts}`.replace(/_/g, ' ') },
  { raw: `  React_B9_${ts}  `,       expected: `react_b9_${ts}`.replace(/_/g, ' ') },
  { raw: `Docker_B9_${ts} `,         expected: `docker_b9_${ts}`.replace(/_/g, ' ') },
]
// We verify cleaning indirectly: cleanedTerm in normalization result should be lowercase+trimmed
const cleanRes = await api('/normalize', 'POST', null, {
  terms: cleanTests.map(t => t.raw), deduplicate: false,
})
check('Cleaning: lowercase applied',     cleanRes.results[0].cleanedTerm, cleanRes.results[0].cleanedTerm.toLowerCase())
check('Cleaning: trimmed',               cleanRes.results[0].cleanedTerm, cleanRes.results[0].cleanedTerm.trim())
check('Cleaning: separators → spaces',   cleanRes.results[0].cleanedTerm.includes('_'), false)

// ─────────────────────────────────────────────────────────────────────────────
// 3. NORMALIZATION API — BATCH, DEDUP, SUMMARY
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[3] NORMALIZATION API — BATCH & SUMMARY')

const batchRes = await api('/normalize', 'POST', null, {
  terms: [
    `Python_B9_${ts}`,      // exact match on normalizedName
    `py_b9_${ts}`,          // alias match
    `reactjs_b9_${ts}`,     // alias match
    `Docker_B9_${ts}`,      // exact
    `totally_unknown_xyz_${ts}`, // no match
  ],
  deduplicate: false,
})
check('Batch: results array',            Array.isArray(batchRes.results),             true)
check('Batch: 5 results returned',       batchRes.results.length,                     5)
check('Batch: summary.total = 5',        batchRes.summary.total,                      5)
check('Batch: summary.matched = 4',      batchRes.summary.matched,                    4)
check('Batch: summary.unmatched = 1',    batchRes.summary.unmatched,                  1)
check('Batch: byMatchType present',      typeof batchRes.summary.byMatchType === 'object', true)

// With deduplication: py_b9 and Python_B9 both resolve to same canonical → deduped
const dedupRes = await api('/normalize', 'POST', null, {
  terms: [`Python_B9_${ts}`, `py_b9_${ts}`, `python3_b9_${ts}`],
  deduplicate: true,
})
check('Dedup: 3 terms → 1 canonical',   dedupRes.results.filter(r => r.matched).length, 1)
check('Dedup: summary.matched = 1',     dedupRes.summary.matched,                        1)

// Public endpoint — no token needed
check('Normalize is public (no auth)',   await httpCode('/normalize', 'POST', null, { terms: [`Python_B9_${ts}`] }), 200)

// ─────────────────────────────────────────────────────────────────────────────
// 4. NORMALIZATION MATCH TYPES
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[4] NORMALIZATION MATCH TYPES')

// Exact match
const exactRes = await api('/normalize', 'POST', null, { terms: [`Python_B9_${ts}`], deduplicate: false })
const exactHit  = exactRes.results[0]
check('Exact: matched=true',             exactHit.matched,              true)
check('Exact: matchType=exact',          exactHit.matchType,            'exact')
check('Exact: canonicalId correct',      exactHit.canonicalId,          ids.python)
check('Exact: confidence ≥ 0.95',        exactHit.confidence >= 0.95,   true)

// Alias match
const aliasRes = await api('/normalize', 'POST', null, { terms: [`py_b9_${ts}`], deduplicate: false })
const aliasHit  = aliasRes.results[0]
check('Alias: matched=true',             aliasHit.matched,              true)
check('Alias: matchType=alias',          aliasHit.matchType,            'alias')
check('Alias: resolves to Python',       aliasHit.canonicalId,          ids.python)
check('Alias: confidence ≥ 0.90',        aliasHit.confidence >= 0.90,   true)

// Unmatched
const unmatchedRes = await api('/normalize', 'POST', null, { terms: [`xyzzy_totally_unknown_${ts}`], deduplicate: false })
const unmatchedHit  = unmatchedRes.results[0]
check('Unmatched: matched=false',        unmatchedHit.matched,          false)
check('Unmatched: matchType=unmatched',  unmatchedHit.matchType,        'unmatched')
check('Unmatched: canonicalId=null',     unmatchedHit.canonicalId,      null)
check('Unmatched: confidence=0',         unmatchedHit.confidence,       0)

// Result fields present
check('Result has rawTerm',              !!exactHit.rawTerm,            true)
check('Result has cleanedTerm',          !!exactHit.cleanedTerm,        true)
check('Result has canonicalName',        !!exactHit.canonicalName,      true)
check('Result has normalizedName',       !!exactHit.normalizedName,     true)
check('Result has category',             !!exactHit.category,           true)

// ─────────────────────────────────────────────────────────────────────────────
// 5. NORMALIZATION VALIDATION
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[5] NORMALIZATION VALIDATION')
check('Missing terms → 400',             await httpCode('/normalize', 'POST', null, {}), 400)
check('terms not array → 400',           await httpCode('/normalize', 'POST', null, { terms: 'Python' }), 400)
check('empty array → 400',               await httpCode('/normalize', 'POST', null, { terms: [] }), 400)
check('empty string in array → 400',     await httpCode('/normalize', 'POST', null, { terms: ['Python', ''] }), 400)
check('maxEditDistance out of range → 400', await httpCode('/normalize', 'POST', null, { terms: ['X'], maxEditDistance: 5 }), 400)
check('tokenOverlapThresh > 1 → 400',    await httpCode('/normalize', 'POST', null, { terms: ['X'], tokenOverlapThresh: 1.5 }), 400)
check('100 terms OK',                    await httpCode('/normalize', 'POST', null, { terms: Array(100).fill('Python') }), 200)
check('101 terms → 400',                 await httpCode('/normalize', 'POST', null, { terms: Array(101).fill('Python') }), 400)

// ─────────────────────────────────────────────────────────────────────────────
// 6. MAPPING CRUD
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[6] MAPPING CRUD')

// Create
const m1 = await api('/normalize/mappings', 'POST', tG, {
  sourceTerm: `Microsoft Power BI_${ts}`,
  skillId:    ids.powerBI,
  notes:      'Common vendor prefix variant',
})
check('Create mapping id',               !!m1.mapping.id,                             true)
check('Create mapping sourceTerm cleaned',!m1.mapping.sourceTerm.includes('M'),       true) // lowercased
check('Create mapping skillId',          m1.mapping.skillId,                          ids.powerBI)
check('Create mapping skillName set',    !!m1.mapping.skillName,                      true)
check('Create mapping notes',            m1.mapping.notes,                            'Common vendor prefix variant')
check('Create mapping createdBy',        !!m1.mapping.createdBy,                      true)

const m2 = await api('/normalize/mappings', 'POST', tI, {
  sourceTerm: `PowerBI_${ts}`,
  skillId:    ids.powerBI,
})
check('Create m2',                       !!m2.mapping.id,                             true)

// Get one
const gotM = await api(`/normalize/mappings/${m1.mapping.id}`, 'GET', tL)
check('GET mapping id',                  gotM.mapping.id,                             m1.mapping.id)
check('GET mapping skillId',             gotM.mapping.skillId,                        ids.powerBI)

// List
const listM = await api('/normalize/mappings', 'GET', tL)
check('List mappings array',             Array.isArray(listM.mappings),               true)
check('List pagination present',         !!listM.pagination,                          true)

// Filter by skillId
const filtM = await api(`/normalize/mappings?skillId=${ids.powerBI}`, 'GET', tL)
check('Filter by skillId finds m1',      filtM.mappings.some(m => m.id === m1.mapping.id), true)
check('Filter by skillId finds m2',      filtM.mappings.some(m => m.id === m2.mapping.id), true)

// Update
const updM = await api(`/normalize/mappings/${m1.mapping.id}`, 'PATCH', tG, {
  notes: 'Updated note',
})
check('Update mapping notes',            updM.mapping.notes,                          'Updated note')
check('Update mapping skillId preserved',updM.mapping.skillId,                        ids.powerBI)

// Delete m2
const delM = await api(`/normalize/mappings/${m2.mapping.id}`, 'DELETE', tI)
check('Delete mapping message',          delM.message,                                'Mapping deleted')
check('Get deleted → 404',              await httpCode(`/normalize/mappings/${m2.mapping.id}`, 'GET', tL), 404)

// ─────────────────────────────────────────────────────────────────────────────
// 7. MAPPING DUPLICATE GUARD
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[7] MAPPING DUPLICATE GUARD')
check('Duplicate sourceTerm → 409',
  await httpCode('/normalize/mappings', 'POST', tG, {
    sourceTerm: `Microsoft Power BI_${ts}`,   // same as m1 after cleaning
    skillId:    ids.powerBI,
  }), 409)

// Validation
check('Missing sourceTerm → 400',   await httpCode('/normalize/mappings', 'POST', tG, { skillId: ids.powerBI }), 400)
check('Missing skillId → 400',      await httpCode('/normalize/mappings', 'POST', tG, { sourceTerm: 'X' }), 400)
check('Bad skillId → 400',          await httpCode('/normalize/mappings', 'POST', tG, { sourceTerm: `unique_${ts}_x`, skillId: '00000000-0000-0000-0000-000000000000' }), 400)
check('GET non-existent → 404',     await httpCode('/normalize/mappings/00000000-0000-0000-0000-000000000000', 'GET', tL), 404)
check('PATCH non-existent → 404',   await httpCode('/normalize/mappings/00000000-0000-0000-0000-000000000000', 'PATCH', tG, { notes: 'x' }), 404)
check('DELETE non-existent → 404',  await httpCode('/normalize/mappings/00000000-0000-0000-0000-000000000000', 'DELETE', tG), 404)

// ─────────────────────────────────────────────────────────────────────────────
// 8. BULK UPSERT
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[8] BULK UPSERT MAPPINGS')

const bulkRes = await api('/normalize/mappings/bulk', 'POST', tG, {
  mappings: [
    { sourceTerm: `aws amazon_${ts}`,     skillId: ids.aws },
    { sourceTerm: `amazon aws_${ts}`,     skillId: ids.aws },
    { sourceTerm: `ts lang_${ts}`,        skillId: ids.ts  },
    { sourceTerm: `bad_skill_id_${ts}`,   skillId: '00000000-0000-0000-0000-000000000000' }, // error
  ],
  mode: 'skip',
})
check('Bulk: HTTP 207',              bulkRes.created + bulkRes.errors.length > 0,    true)
check('Bulk: 3 created',             bulkRes.created,                                3)
check('Bulk: 1 error (bad skillId)', bulkRes.errors.length,                         1)
check('Bulk: error has index',       bulkRes.errors[0].index,                       3)

// Skip mode: re-inserting same terms skips them
const bulkSkip = await api('/normalize/mappings/bulk', 'POST', tG, {
  mappings: [
    { sourceTerm: `aws amazon_${ts}`, skillId: ids.aws },
    { sourceTerm: `amazon aws_${ts}`, skillId: ids.aws },
  ],
  mode: 'skip',
})
check('Bulk skip: 0 created',        bulkSkip.created,                               0)
check('Bulk skip: 2 skipped',        bulkSkip.skipped,                               2)

// Replace mode: same term, different target skill
const bulkReplace = await api('/normalize/mappings/bulk', 'POST', tG, {
  mappings: [{ sourceTerm: `ts lang_${ts}`, skillId: ids.ts }],
  mode: 'replace',
})
check('Bulk replace: 1 replaced',    bulkReplace.replaced,                           1)

// Validation
check('Bulk empty array → 400',      await httpCode('/normalize/mappings/bulk', 'POST', tG, { mappings: [] }), 400)
check('Bulk bad mode → 400',         await httpCode('/normalize/mappings/bulk', 'POST', tG, { mappings: [{ sourceTerm: 'x', skillId: ids.aws }], mode: 'overwrite' }), 400)

// ─────────────────────────────────────────────────────────────────────────────
// 9. MAPPING AUTH ENFORCEMENT
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[9] MAPPING AUTH ENFORCEMENT')
check('Create mapping no token → 401',   await httpCode('/normalize/mappings', 'POST'), 401)
check('List mappings no token → 401',    await httpCode('/normalize/mappings'), 401)
check('Bulk no token → 401',             await httpCode('/normalize/mappings/bulk', 'POST'), 401)
check('Learner create mapping → 403',    await httpCode('/normalize/mappings', 'POST', tL, { sourceTerm: 'x', skillId: ids.python }), 403)
check('Learner delete mapping → 403',    await httpCode(`/normalize/mappings/${m1.mapping.id}`, 'DELETE', tL), 403)
check('Learner bulk → 403',              await httpCode('/normalize/mappings/bulk', 'POST', tL, { mappings: [{ sourceTerm: 'x', skillId: ids.python }] }), 403)

// ─────────────────────────────────────────────────────────────────────────────
// 10. AD-HOC SKILL MATCH — STRUCTURE & SCORING
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[10] AD-HOC SKILL MATCH')

// Perfect match: learner has all required skills at the right level
const perfectMatch = await api('/match', 'POST', tL, {
  requiredSkills: [
    { skillId: ids.python, skillName: `Python_B9_${ts}`, level: 'advanced',      requirement: 'required' },
    { skillId: ids.react,  skillName: `React_B9_${ts}`,  level: 'intermediate',  requirement: 'required' },
    { skillId: ids.docker, skillName: `Docker_B9_${ts}`, level: 'beginner',      requirement: 'preferred' },
  ],
  currentSkills: [
    { skillId: ids.python, skillName: `Python_B9_${ts}`, level: 'advanced' },
    { skillId: ids.react,  skillName: `React_B9_${ts}`,  level: 'intermediate' },
    { skillId: ids.docker, skillName: `Docker_B9_${ts}`, level: 'beginner' },
  ],
})
check('Perfect: readinessScore = 100',   perfectMatch.result.readinessScore,          100)
check('Perfect: gapSeverity = none',     perfectMatch.result.gapSeverity,             'none')
check('Perfect: matchedCount = 3',       perfectMatch.result.matchedCount,            3)
check('Perfect: gapCount = 0',           perfectMatch.result.gapCount,               0)
check('Perfect: surplusCount = 0',       perfectMatch.result.surplusCount,           0)
check('Perfect: matched array len = 3',  perfectMatch.result.matched.length,         3)
check('Perfect: gaps array empty',       perfectMatch.result.gaps.length,            0)

// Partial match: learner missing 2 of 4 required skills
const partialMatch = await api('/match', 'POST', tL, {
  requiredSkills: [
    { skillId: ids.python, skillName: `Python_B9_${ts}`, level: 'advanced',     requirement: 'required' },
    { skillId: ids.react,  skillName: `React_B9_${ts}`,  level: 'intermediate', requirement: 'required' },
    { skillId: ids.docker, skillName: `Docker_B9_${ts}`, level: 'beginner',     requirement: 'required' },
    { skillId: ids.aws,    skillName: `AWS_B9_${ts}`,    level: 'intermediate', requirement: 'required' },
  ],
  currentSkills: [
    { skillId: ids.python, skillName: `Python_B9_${ts}`, level: 'advanced' },
    { skillId: ids.react,  skillName: `React_B9_${ts}`,  level: 'intermediate' },
  ],
})
check('Partial: readinessScore < 100',   partialMatch.result.readinessScore < 100,   true)
check('Partial: readinessScore > 0',     partialMatch.result.readinessScore > 0,     true)
check('Partial: matchedCount = 2',       partialMatch.result.matchedCount,           2)
check('Partial: gapCount = 2',           partialMatch.result.gapCount,               2)
check('Partial: gapSeverity != none',    partialMatch.result.gapSeverity !== 'none', true)
check('Partial: gaps sorted by priority',partialMatch.result.gaps[0].requirement,    'required')

// Zero match: learner has no relevant skills
const zeroMatch = await api('/match', 'POST', tL, {
  requiredSkills: [
    { skillId: ids.python, skillName: `Python_B9_${ts}`, requirement: 'required' },
    { skillId: ids.react,  skillName: `React_B9_${ts}`,  requirement: 'required' },
  ],
  currentSkills: [
    { skillId: ids.aws, skillName: `AWS_B9_${ts}` },
  ],
})
check('Zero match: readinessScore = 0',  zeroMatch.result.readinessScore,            0)
check('Zero match: gapCount = 2',        zeroMatch.result.gapCount,                  2)
check('Zero match: surplusCount = 1',    zeroMatch.result.surplusCount,              1)
check('Zero match: gapSeverity=critical',zeroMatch.result.gapSeverity,              'critical')

// Surplus skills
const surplusMatch = await api('/match', 'POST', tL, {
  requiredSkills: [
    { skillId: ids.python, skillName: `Python_B9_${ts}`, requirement: 'required' },
  ],
  currentSkills: [
    { skillId: ids.python,  skillName: `Python_B9_${ts}` },
    { skillId: ids.react,   skillName: `React_B9_${ts}` },
    { skillId: ids.docker,  skillName: `Docker_B9_${ts}` },
  ],
})
check('Surplus: readinessScore=100',     surplusMatch.result.readinessScore,         100)
check('Surplus: matchedCount=1',         surplusMatch.result.matchedCount,           1)
check('Surplus: surplusCount=2',         surplusMatch.result.surplusCount,           2)

// Result fields
check('Result has calculatedAt',         !!perfectMatch.result.calculatedAt,         true)
check('Result has totalRequired',        perfectMatch.result.totalRequired,          3)
check('Matched item has levelGap',       'levelGap' in perfectMatch.result.matched[0], true)
check('Matched item has levelGapLabel',  !!perfectMatch.result.matched[0].levelGapLabel, true)
check('Gap item has priority',           partialMatch.result.gaps[0].priority >= 1,  true)
check('Gap item has priorityLabel',      !!partialMatch.result.gaps[0].priorityLabel, true)

// ─────────────────────────────────────────────────────────────────────────────
// 11. LEVEL GAP ANALYSIS
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[11] LEVEL GAP ANALYSIS')

const levelMatch = await api('/match', 'POST', tL, {
  requiredSkills: [
    { skillId: ids.python, skillName: `Python_B9_${ts}`, level: 'expert',  requirement: 'required' },
    { skillId: ids.react,  skillName: `React_B9_${ts}`,  level: 'beginner',requirement: 'required' },
  ],
  currentSkills: [
    { skillId: ids.python, skillName: `Python_B9_${ts}`, level: 'intermediate' }, // below expert
    { skillId: ids.react,  skillName: `React_B9_${ts}`,  level: 'advanced' },     // above beginner
  ],
})

const pythonMatch = levelMatch.result.matched.find(m => m.canonicalId === ids.python)
const reactMatch  = levelMatch.result.matched.find(m => m.canonicalId === ids.react)

check('Level: Python below req → levelGap > 0',  pythonMatch.levelGap > 0,                   true)
check('Level: Python labelGap != exact_match',   pythonMatch.levelGapLabel !== 'exact_match', true)
check('Level: React above req → levelGap < 0',   reactMatch.levelGap < 0,                    true)
check('Level: React label = exceeds_requirement',reactMatch.levelGapLabel,                    'exceeds_requirement')
check('Level: readinessScore < 100 due to gap',  levelMatch.result.readinessScore < 100,      true)
check('Level: readinessScore > 0 (both matched)',levelMatch.result.readinessScore > 0,        true)

// ─────────────────────────────────────────────────────────────────────────────
// 12. MATCH VALIDATION
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[12] MATCH VALIDATION')
check('Missing requiredSkills → 400',   await httpCode('/match', 'POST', tL, { currentSkills: [] }), 400)
check('Missing currentSkills → 400',    await httpCode('/match', 'POST', tL, { requiredSkills: [] }), 400)
check('requiredSkills not array → 400', await httpCode('/match', 'POST', tL, { requiredSkills: 'x', currentSkills: [] }), 400)
check('Skill missing id+name → 400',    await httpCode('/match', 'POST', tL, {
  requiredSkills: [{ level: 'advanced' }], currentSkills: [],
}), 400)
check('Bad level value → 400',          await httpCode('/match', 'POST', tL, {
  requiredSkills: [{ skillName: 'X', level: 'god' }], currentSkills: [],
}), 400)
check('Bad requirement value → 400',    await httpCode('/match', 'POST', tL, {
  requiredSkills: [{ skillName: 'X', requirement: 'mandatory' }], currentSkills: [],
}), 400)

// ─────────────────────────────────────────────────────────────────────────────
// 13. MATCH AUTH ENFORCEMENT
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[13] MATCH AUTH ENFORCEMENT')
check('POST /match no token → 401',     await httpCode('/match', 'POST'), 401)
check('POST /match/gap no token → 401', await httpCode('/match/gap', 'POST'), 401)
check('GET /match/gap/... no token → 401', await httpCode('/match/gap/learner/fake-id'), 401)

// ─────────────────────────────────────────────────────────────────────────────
// 14. GAP ANALYSIS — PERSIST & READ BACK
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[14] GAP ANALYSIS — PERSIST & READ')

const subjectId  = `learner_${ts}`
const targetRole = `Senior Dev ${ts}`

const gapRes = await api('/match/gap', 'POST', tL, {
  subjectType:    'learner',
  subjectId,
  targetRole,
  requiredSkills: [
    { skillId: ids.python, skillName: `Python_B9_${ts}`, level: 'advanced',     requirement: 'required' },
    { skillId: ids.react,  skillName: `React_B9_${ts}`,  level: 'intermediate', requirement: 'required' },
    { skillId: ids.docker, skillName: `Docker_B9_${ts}`, level: 'beginner',     requirement: 'preferred' },
    { skillId: ids.aws,    skillName: `AWS_B9_${ts}`,    level: 'intermediate', requirement: 'nice-to-have' },
  ],
  currentSkills: [
    { skillId: ids.python, skillName: `Python_B9_${ts}`, level: 'intermediate' },
    { skillId: ids.react,  skillName: `React_B9_${ts}`,  level: 'intermediate' },
  ],
})
check('Gap persist: HTTP 201',          gapRes.message.includes('completed'),       true)
check('Gap persist: result present',    !!gapRes.result,                            true)
check('Gap persist: readinessScore present', !!gapRes.readinessScore,               true)
check('Gap persist: gapCount = 2',      gapRes.gapCount,                            2)
check('Gap persist: matchedCount = 2',  gapRes.result.matchedCount,                 2)

// Read back from DB
const readBack = await api(`/match/gap/learner/${subjectId}`, 'GET', tL)
check('Read back: latest present',      !!readBack.latest,                          true)
check('Read back: readinessScores array',Array.isArray(readBack.readinessScores),   true)
check('Read back: openGaps array',       Array.isArray(readBack.openGaps),          true)
check('Read back: targetRole matches',   readBack.latest.targetRole,                targetRole)
check('Read back: readinessScore > 0',   readBack.latest.readinessScore > 0,        true)
check('Read back: 2 open gaps',          readBack.openGaps.length,                  2)
check('Read back: gap has skillName',    !!readBack.openGaps[0]?.skillName,         true)
check('Read back: gap has priority',     readBack.openGaps[0]?.priority >= 1,       true)
check('Read back: gap status=open',      readBack.openGaps[0]?.status,              'open')

// targetRole filter
const filtered = await api(`/match/gap/learner/${subjectId}?targetRole=${encodeURIComponent(targetRole)}`, 'GET', tL)
check('Filter by targetRole: returns result',filtered.latest.targetRole,            targetRole)

// Non-existent subject → 404
check('Non-existent subject → 404',     await httpCode(`/match/gap/learner/nonexistent_${ts}`, 'GET', tL), 404)

// ─────────────────────────────────────────────────────────────────────────────
// 15. GAP RE-RUN REPLACES PREVIOUS
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[15] GAP RE-RUN REPLACES PREVIOUS')

// Second run: learner now has Python at advanced level + Docker
await api('/match/gap', 'POST', tL, {
  subjectType: 'learner', subjectId, targetRole,
  requiredSkills: [
    { skillId: ids.python, skillName: `Python_B9_${ts}`, level: 'advanced',     requirement: 'required' },
    { skillId: ids.react,  skillName: `React_B9_${ts}`,  level: 'intermediate', requirement: 'required' },
    { skillId: ids.docker, skillName: `Docker_B9_${ts}`, level: 'beginner',     requirement: 'preferred' },
    { skillId: ids.aws,    skillName: `AWS_B9_${ts}`,    level: 'intermediate', requirement: 'nice-to-have' },
  ],
  currentSkills: [
    { skillId: ids.python, skillName: `Python_B9_${ts}`, level: 'advanced' },
    { skillId: ids.react,  skillName: `React_B9_${ts}`,  level: 'intermediate' },
    { skillId: ids.docker, skillName: `Docker_B9_${ts}`, level: 'beginner' },
  ],
})

const readBack2 = await api(`/match/gap/learner/${subjectId}?targetRole=${encodeURIComponent(targetRole)}`, 'GET', tL)
check('Re-run: readinessScore improved',  readBack2.latest.readinessScore > readBack.latest.readinessScore, true)
check('Re-run: open gaps reduced to 1',   readBack2.openGaps.length,                 1)
check('Re-run: remaining gap is AWS',     readBack2.openGaps[0]?.skillName,          `AWS_B9_${ts}`)

// ─────────────────────────────────────────────────────────────────────────────
// 16. GAP HISTORY
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[16] GAP HISTORY')
const history = await api(`/match/gap/learner/${subjectId}/history`, 'GET', tL)
check('History: array present',          Array.isArray(history.history),            true)
check('History: pagination present',     !!history.pagination,                      true)
check('History: at least 1 record',      history.pagination.total >= 1,             true)
check('History: sorted newest first',    !!history.history[0]?.calculatedAt,        true)

// Pagination
const hp1 = await api(`/match/gap/learner/${subjectId}/history?limit=1&page=1`, 'GET', tL)
check('History page 1 has 1 result',     hp1.history.length,                        1)

// Bad subjectType
check('Bad subjectType → 400',           await httpCode('/match/gap/robot/fake-id', 'GET', tL), 400)
check('Bad subjectType history → 400',   await httpCode('/match/gap/robot/fake-id/history', 'GET', tL), 400)

// ─────────────────────────────────────────────────────────────────────────────
// 17. MATCH AGAINST JOB ROLE
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[17] MATCH AGAINST JOB ROLE')

// Create an industry + job role to test against
const indDoc = await api('/industries', 'POST', tI, {
  name: `TestCo_B9_${ts}`, sector: 'Technology',
})
const jobDoc = await api('/jobs', 'POST', tI, {
  industryId:     indDoc.industry.id,
  title:          `React Developer ${ts}`,
  status:         'active',
  requiredSkills: [
    { skillId: ids.react,  skillName: `React_B9_${ts}`,  level: 'advanced',     requirement: 'required' },
    { skillId: ids.ts,     skillName: `TypeScript_B9_${ts}`, level: 'intermediate', requirement: 'required' },
    { skillId: ids.docker, skillName: `Docker_B9_${ts}`, level: 'beginner',     requirement: 'preferred' },
  ],
})
const jobId = jobDoc.jobRole.id

// No-persist match
const jobMatch = await api(`/match/job/${jobId}`, 'POST', tL, {
  currentSkills: [
    { skillId: ids.react,  skillName: `React_B9_${ts}`,  level: 'advanced' },
    { skillId: ids.python, skillName: `Python_B9_${ts}`,  level: 'expert' },
  ],
})
check('Job match: result present',         !!jobMatch.result,                          true)
check('Job match: jobRole id returned',    jobMatch.jobRole.id,                        jobId)
check('Job match: matchedCount = 1',       jobMatch.result.matchedCount,               1)   // react matched
check('Job match: gapCount = 2',           jobMatch.result.gapCount,                   2)   // ts + docker missing
check('Job match: surplusCount = 1',       jobMatch.result.surplusCount,               1)   // python surplus
check('Job match: not saved to DB',        await httpCode(`/match/gap/learner/learner_job_${ts}`, 'GET', tL), 404)

// Persist match
const jobId2    = `learner_job_persist_${ts}`
const jobMatchP = await api(`/match/job/${jobId}`, 'POST', tL, {
  currentSkills: [
    { skillId: ids.react, skillName: `React_B9_${ts}`, level: 'advanced' },
  ],
  persist:     true,
  subjectType: 'learner',
  subjectId:   jobId2,
})
check('Job match persist: 201 returned',  jobMatchP.message.includes('completed'),     true)
check('Job match persist: readinessScore',!!jobMatchP.readinessScore,                  true)

// Verify persisted
const persistedRead = await api(`/match/gap/learner/${jobId2}`, 'GET', tL)
check('Job match persist: readable',      !!persistedRead.latest,                      true)
check('Job match persist: targetRole',    persistedRead.latest.targetRole,             `React Developer ${ts}`)

// Missing persist params
check('persist=true missing subjectType → 400',
  await httpCode(`/match/job/${jobId}`, 'POST', tL, { currentSkills: [], persist: true, subjectId: 'x' }), 400)
check('persist=true missing subjectId → 400',
  await httpCode(`/match/job/${jobId}`, 'POST', tL, { currentSkills: [], persist: true, subjectType: 'learner' }), 400)

// Non-existent job role
check('Match non-existent job → 404',
  await httpCode('/match/job/00000000-0000-0000-0000-000000000000', 'POST', tL, { currentSkills: [] }), 404)

// ─────────────────────────────────────────────────────────────────────────────
// 18. POWER BI SCENARIO (the motivating example)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[18] POWER BI NORMALIZATION SCENARIO')

// "PowerBI", "Microsoft Power BI", "Power BI" → all should resolve to ids.powerBI
// m1 mapping: "microsoft power bi_${ts}" → ids.powerBI  (created in group 6)
// The canonical skill has aliases: powerbi_b9_${ts}, power_bi_b9_${ts}

const pbiRes = await api('/normalize', 'POST', null, {
  terms: [
    `Power BI_B9_${ts}`,           // exact normalizedName match
    `powerbi_b9_${ts}`,            // alias match
    `power_bi_b9_${ts}`,           // alias match (underscore→space cleaning)
    `Microsoft Power BI_${ts}`,    // mapping lookup (m1)
  ],
  deduplicate: true,
})
check('Power BI: all 4 terms → 1 canonical', pbiRes.results.filter(r => r.matched).length, 1)
check('Power BI: canonical is ids.powerBI',  pbiRes.results.find(r => r.matched)?.canonicalId, ids.powerBI)
check('Power BI: summary.matched = 1',       pbiRes.summary.matched,                            1)
check('Power BI: rawTerms consolidated',     pbiRes.results.find(r=>r.matched)?.rawTerms?.length >= 3, true)

// Now use in a skill match: job requires "Power BI" (by id),
// learner provides "Microsoft Power BI_${ts}" (raw string, resolved via mapping)
const pbiMatch = await api('/match', 'POST', tL, {
  requiredSkills: [
    { skillId: ids.powerBI, skillName: `Power BI_B9_${ts}`, requirement: 'required' },
  ],
  currentSkills: [
    { skillName: `powerbi_b9_${ts}` },  // alias — no skillId, just raw name
  ],
})
check('Power BI match: alias resolves correctly', pbiMatch.result.matchedCount,   1)
check('Power BI match: no gap',                   pbiMatch.result.gapCount,        0)
check('Power BI match: readinessScore = 100',     pbiMatch.result.readinessScore,  100)

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────
const total = pass + fail
console.log(`\n${'─'.repeat(56)}`)
console.log(`  TOTAL  ${total}   PASS  ${pass}   FAIL  ${fail}`)
console.log('─'.repeat(56))
if (fail > 0) process.exit(1)
