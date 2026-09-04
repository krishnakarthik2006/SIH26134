// Phase B3 verification — User & Profile APIs
// Run: node tests/verify-b3.mjs  (server must be on :4000)

const BASE = 'http://localhost:4000/api'
let pass = 0, fail = 0

function check(label, got, expect) {
  const ok = String(got) === String(expect)
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${ok ? '' : `  got=${got}  expect=${expect}`}`)
  ok ? pass++ : fail++
}

async function httpCode(path, method = 'GET', token = null, body = null) {
  const h = { 'Content-Type': 'application/json' }
  if (token) h.Authorization = `Bearer ${token}`
  try {
    const r = await fetch(`${BASE}${path}`, {
      method, headers: h,
      body: body ? JSON.stringify(body) : undefined,
    })
    return r.status
  } catch { return 0 }
}

async function api(path, method = 'GET', token = null, body = null) {
  const h = { 'Content-Type': 'application/json' }
  if (token) h.Authorization = `Bearer ${token}`
  const r = await fetch(`${BASE}${path}`, {
    method, headers: h,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`${r.status} ${text}`)
  return JSON.parse(text)
}

// ── Setup: register one account per role ─────────────────────────────────────
const ts = Date.now()
console.log('\n[SETUP] Registering test accounts ...')
const { token: tL } = await api('/auth/register', 'POST', null, { name: 'Learner', email: `l_${ts}@t.com`, password: 'pass1234', role: 'learner' })
const { token: tT } = await api('/auth/register', 'POST', null, { name: 'Trainer', email: `t_${ts}@t.com`, password: 'pass1234', role: 'training' })
const { token: tI } = await api('/auth/register', 'POST', null, { name: 'Industry', email: `i_${ts}@t.com`, password: 'pass1234', role: 'industry' })
const { token: tG } = await api('/auth/register', 'POST', null, { name: 'Govt', email: `g_${ts}@t.com`, password: 'pass1234', role: 'government' })
console.log('  Tokens issued: learner, training, industry, government ✓')

// ── 1. NO TOKEN → 401 ────────────────────────────────────────────────────────
console.log('\n[1] AUTH ENFORCEMENT — no token must return 401')
check('GET  /profiles/student     no-token', await httpCode('/profiles/student'), 401)
check('GET  /profiles/training    no-token', await httpCode('/profiles/training'), 401)
check('GET  /profiles/industry    no-token', await httpCode('/profiles/industry'), 401)
check('GET  /profiles/government  no-token', await httpCode('/profiles/government'), 401)
check('GET  /profiles/me          no-token', await httpCode('/profiles/me'), 401)
check('PATCH /profiles/student    no-token', await httpCode('/profiles/student', 'PATCH', null, { targetRole: 'x' }), 401)

// ── 2. PROFILE NOT YET CREATED → 404 ─────────────────────────────────────────
console.log('\n[2] GET BEFORE PROFILE EXISTS — must return 404')
check('GET /profiles/student    fresh', await httpCode('/profiles/student',    'GET', tL), 404)
check('GET /profiles/training   fresh', await httpCode('/profiles/training',   'GET', tT), 404)
check('GET /profiles/industry   fresh', await httpCode('/profiles/industry',   'GET', tI), 404)
check('GET /profiles/government fresh', await httpCode('/profiles/government', 'GET', tG), 404)
check('GET /profiles/me         fresh', await httpCode('/profiles/me',         'GET', tL), 404)

// ── 3. CREATE PROFILES via PATCH upsert ───────────────────────────────────────
console.log('\n[3] CREATE PROFILES via PATCH upsert')

const sC = await api('/profiles/student', 'PATCH', tL, {
  targetRole: 'ML Engineer', currentSkills: ['Python', 'SQL', 'Spark'],
  location: 'Pune', educationLevel: 'Bachelor',
  bio: 'Keen learner', preferredLearningMode: 'online',
})
check('Student  id present',              !!sC.profile.id,                             true)
check('Student  targetRole',              sC.profile.targetRole,                       'ML Engineer')
check('Student  location',                sC.profile.location,                         'Pune')
check('Student  skills count',            sC.profile.currentSkills.length,             3)
check('Student  learningMode',            sC.profile.preferredLearningMode,            'online')
check('Student  userId present',          !!sC.profile.userId,                         true)
check('Student  createdAt present',       !!sC.profile.createdAt,                      true)

const tC = await api('/profiles/training', 'PATCH', tT, {
  organizationName: 'Pune Tech Academy', type: 'Private',
  focusAreas: ['AI', 'Cloud', 'DevOps'], location: 'Pune',
  contactEmail: 'info@pta.edu',
})
check('Training id present',              !!tC.profile.id,                             true)
check('Training organizationName',        tC.profile.organizationName,                 'Pune Tech Academy')
check('Training focusAreas count',        tC.profile.focusAreas.length,               3)
check('Training contactEmail',            tC.profile.contactEmail,                     'info@pta.edu')

const iC = await api('/profiles/industry', 'PATCH', tI, {
  companyName: 'Infosys', sector: 'Technology', companySize: '1000+',
  headquarters: 'Pune', operatingRegions: ['Pune', 'Mumbai', 'Nagpur'],
})
check('Industry id present',              !!iC.profile.id,                             true)
check('Industry companyName',             iC.profile.companyName,                      'Infosys')
check('Industry companySize',             iC.profile.companySize,                      '1000+')
check('Industry operatingRegions count',  iC.profile.operatingRegions.length,          3)

const gC = await api('/profiles/government', 'PATCH', tG, {
  designation: 'District Collector', department: 'Skill Development',
  region: 'Vidarbha', district: 'Nagpur',
  contactEmail: 'dc@maharashtra.gov.in',
})
check('Govt     id present',              !!gC.profile.id,                             true)
check('Govt     designation',             gC.profile.designation,                      'District Collector')
check('Govt     region',                  gC.profile.region,                           'Vidarbha')
check('Govt     department',              gC.profile.department,                        'Skill Development')

// ── 4. GET PROFILE (after creation) ──────────────────────────────────────────
console.log('\n[4] GET PROFILE — after creation')

const sGet = await api('/profiles/student',    'GET', tL)
check('Student  GET targetRole',  sGet.profile.targetRole,                 'ML Engineer')
check('Student  GET location',    sGet.profile.location,                   'Pune')
check('Student  GET skills[0]',   sGet.profile.currentSkills[0],           'Python')

const tGet = await api('/profiles/training',   'GET', tT)
check('Training GET orgName',     tGet.profile.organizationName,           'Pune Tech Academy')
check('Training GET email',       tGet.profile.contactEmail,               'info@pta.edu')

const iGet = await api('/profiles/industry',   'GET', tI)
check('Industry GET company',     iGet.profile.companyName,                'Infosys')
check('Industry GET sector',      iGet.profile.sector,                     'Technology')

const gGet = await api('/profiles/government', 'GET', tG)
check('Govt     GET designation', gGet.profile.designation,                'District Collector')
check('Govt     GET district',    gGet.profile.district,                   'Nagpur')

// ── 5. /me SHORTCUT ───────────────────────────────────────────────────────────
console.log('\n[5] /me SHORTCUT — resolves profile by session role')

const mL = await api('/profiles/me', 'GET', tL)
check('/me learner  role',       mL.role,                   'learner')
check('/me learner  targetRole', mL.profile.targetRole,     'ML Engineer')

const mT = await api('/profiles/me', 'GET', tT)
check('/me training role',       mT.role,                   'training')
check('/me training orgName',    mT.profile.organizationName, 'Pune Tech Academy')

const mI = await api('/profiles/me', 'GET', tI)
check('/me industry role',       mI.role,                   'industry')
check('/me industry company',    mI.profile.companyName,    'Infosys')

const mG = await api('/profiles/me', 'GET', tG)
check('/me govt    role',        mG.role,                   'government')
check('/me govt    designation', mG.profile.designation,    'District Collector')

// ── 6. PARTIAL UPDATE ─────────────────────────────────────────────────────────
console.log('\n[6] PARTIAL UPDATE — untouched fields must be preserved')

const sU = await api('/profiles/student', 'PATCH', tL, { bio: 'Updated bio', location: 'Nashik' })
check('Student  location updated',      sU.profile.location,     'Nashik')
check('Student  bio updated',           sU.profile.bio,          'Updated bio')
check('Student  targetRole preserved',  sU.profile.targetRole,   'ML Engineer')
check('Student  skills preserved',      sU.profile.currentSkills.includes('Python'), true)
check('Student  updatedAt present',     !!sU.profile.updatedAt,  true)

const iU = await api('/profiles/industry', 'PATCH', tI, { hiringVolume: 300, operatingRegions: ['Pune', 'Chennai'] })
check('Industry hiringVolume updated',  iU.profile.hiringVolume,                 300)
check('Industry regions count updated', iU.profile.operatingRegions.length,      2)
check('Industry companyName preserved', iU.profile.companyName,                  'Infosys')

const gU = await api('/profiles/government', 'PATCH', tG, { ministry: 'Labour' })
check('Govt     ministry updated',      gU.profile.ministry,       'Labour')
check('Govt     designation preserved', gU.profile.designation,    'District Collector')
check('Govt     region preserved',      gU.profile.region,         'Vidarbha')

// ── 7. ROLE ENFORCEMENT → 403 ─────────────────────────────────────────────────
console.log('\n[7] ROLE ENFORCEMENT — cross-role access must return 403')
check('Learner  GET  /industry',    await httpCode('/profiles/industry',    'GET',   tL), 403)
check('Learner  GET  /training',    await httpCode('/profiles/training',    'GET',   tL), 403)
check('Learner  GET  /government',  await httpCode('/profiles/government',  'GET',   tL), 403)
check('Learner  PATCH /industry',   await httpCode('/profiles/industry',    'PATCH', tL), 403)
check('Industry GET  /student',     await httpCode('/profiles/student',     'GET',   tI), 403)
check('Industry PATCH /government', await httpCode('/profiles/government',  'PATCH', tI), 403)
check('Training GET  /government',  await httpCode('/profiles/government',  'GET',   tT), 403)
check('Training PATCH /student',    await httpCode('/profiles/student',     'PATCH', tT), 403)
check('Govt     GET  /student',     await httpCode('/profiles/student',     'GET',   tG), 403)
check('Govt     PATCH /industry',   await httpCode('/profiles/industry',    'PATCH', tG), 403)

// ── 8. INPUT VALIDATION → 400 ─────────────────────────────────────────────────
console.log('\n[8] INPUT VALIDATION — bad input must return 400')
check('Student  empty body',             await httpCode('/profiles/student',    'PATCH', tL, {}), 400)
check('Training empty body',             await httpCode('/profiles/training',   'PATCH', tT, {}), 400)
check('Industry empty body',             await httpCode('/profiles/industry',   'PATCH', tI, {}), 400)
check('Govt     empty body',             await httpCode('/profiles/government', 'PATCH', tG, {}), 400)
check('Student  skills not array',       await httpCode('/profiles/student',    'PATCH', tL, { currentSkills: 'Python' }), 400)
check('Training focusAreas not array',   await httpCode('/profiles/training',   'PATCH', tT, { focusAreas: 'AI' }), 400)
check('Industry regions not array',      await httpCode('/profiles/industry',   'PATCH', tI, { operatingRegions: 'Pune' }), 400)
check('Student  bad learningMode',       await httpCode('/profiles/student',    'PATCH', tL, { preferredLearningMode: 'blended' }), 400)
check('Industry bad companySize',        await httpCode('/profiles/industry',   'PATCH', tI, { companySize: 'huge' }), 400)
check('Training bad contactEmail',       await httpCode('/profiles/training',   'PATCH', tT, { contactEmail: 'notanemail' }), 400)
check('Industry bad contactEmail',       await httpCode('/profiles/industry',   'PATCH', tI, { contactEmail: 'notanemail' }), 400)
check('Govt     bad contactEmail',       await httpCode('/profiles/government', 'PATCH', tG, { contactEmail: 'notanemail' }), 400)

// ── 9. INVALID TOKEN → 401 ────────────────────────────────────────────────────
console.log('\n[9] INVALID TOKEN — must return 401')
check('Garbage JWT',      await httpCode('/profiles/student', 'GET', 'not.a.real.token'), 401)
check('Empty token str',  await httpCode('/profiles/me',      'GET', ''), 401)

// ── Summary ───────────────────────────────────────────────────────────────────
const total = pass + fail
console.log(`\n${'─'.repeat(46)}`)
console.log(`  TOTAL  ${total}   PASS  ${pass}   FAIL  ${fail}`)
console.log('─'.repeat(46))
if (fail > 0) process.exit(1)
