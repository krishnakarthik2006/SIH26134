/**
 * Seed demo accounts and data for live demonstration.
 * Fully idempotent — safe to run multiple times.
 * Run: node tests/seed-demo-data.mjs
 *
 * Creates:
 *   Industry  → abc@company.com / Company@123
 *               Company: TechCorp Solutions
 *               Job: Software Development Engineer (SDE)
 *               Required: Java (advanced, required), C++ (intermediate, required)
 *               Full job story / description
 *
 *   Learner   → arjun@learner.com / Learner@123
 *               Name: Arjun Kulkarni, Pune
 *               Skills: Python, JavaScript, DSA (beginner), Git, Problem Solving
 *               Target: SDE → gaps are Java, C++, Algorithms, System Design
 *               Readiness pre-computed
 */

const BASE = 'http://localhost:4000/api'

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function req(path, method, body, token) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const r = await fetch(`${BASE}${path}`, {
    method: method || 'GET',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await r.json()
  if (!r.ok) {
    const e = new Error(`${r.status} ${path}: ${data?.error || JSON.stringify(data)}`)
    e.status = r.status
    throw e
  }
  return data
}

async function getRequest(path, token) { return req(path, 'GET', null, token) }
async function postRequest(path, body, token) { return req(path, 'POST', body, token) }
async function patchRequest(path, body, token) { return req(path, 'PATCH', body, token) }

async function tryPost(path, body, token) {
  try { return await postRequest(path, body, token) }
  catch (e) { if (e.status === 409) return null; throw e }
}

async function getOrCreateAccount(name, email, password, role) {
  // Try login first (idempotent)
  try {
    const r = await postRequest('/auth/login', { email, password })
    return r
  } catch {
    // Not registered — register now
    const r = await postRequest('/auth/register', { name, email, password, role })
    return r
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

console.log('\n🌱  Seeding SkillSync demo data...\n')

// ① Industry account
console.log('① Industry account — abc@company.com')
const iSess   = await getOrCreateAccount('ABC Company', 'abc@company.com', 'Company@123', 'industry')
const iToken  = iSess.token
const iUserId = iSess.user?.id
console.log(`   ✓ ${iSess.user?.name} | role: ${iSess.user?.role}`)

// ② Industry profile
console.log('② Industry profile — TechCorp Solutions')
await patchRequest('/profiles/industry', {
  companyName:       'TechCorp Solutions',
  sector:            'Technology',
  companySize:       '201-500',
  headquarters:      'Pune, Maharashtra',
  operatingRegions:  ['Pune', 'Mumbai', 'Nagpur'],
  website:           'https://techcorp-solutions.in',
  contactEmail:      'hr@techcorp-solutions.in',
  description:       'TechCorp Solutions is a Pune-based product engineering company building scalable cloud-native software for enterprises across India and Southeast Asia.',
  focusAreas:        ['Enterprise Software', 'Cloud Computing', 'AI/ML', 'Fintech'],
}, iToken).catch(() => {})
console.log('   ✓ Profile updated')

// ③ Industry record
console.log('③ Industry record in DB')
let industryId
const indList = await getRequest('/industries?limit=50', iToken)
const existingInd = indList.industries?.find(i => i.createdBy === iUserId)
if (existingInd) {
  industryId = existingInd.id
  console.log(`   ✓ Found existing (${industryId.slice(0,8)}…)`)
} else {
  const created = await tryPost('/industries', {
    name:              'TechCorp Solutions',
    sector:            'Technology',
    companySize:       '201-500',
    headquarters:      'Pune, Maharashtra',
    operatingRegions:  ['Pune', 'Mumbai', 'Nagpur'],
    contactEmail:      'hr@techcorp-solutions.in',
    description:       'Building scalable cloud-native software for enterprises.',
    employeeCount:     350,
  }, iToken)
  if (created) {
    industryId = created.industry.id
    console.log(`   ✓ Created (${industryId.slice(0,8)}…)`)
  } else {
    // 409 — fetch the existing one
    const refetch = await getRequest('/industries?limit=50', iToken)
    industryId = refetch.industries?.[0]?.id
    console.log(`   ✓ Conflict resolved (${industryId?.slice(0,8)}…)`)
  }
}

// ④ Canonical skills — Java, C++
console.log('④ Canonical skills — Java, C++')

async function ensureSkill(name, aliases, category, demandScore) {
  const search = await getRequest(`/skills/search?q=${encodeURIComponent(name)}&limit=5`)
  const found  = search.skills?.find(s => s.name.toLowerCase() === name.toLowerCase())
  if (found) { console.log(`   ✓ ${name} already in KB`); return found.id }
  const created = await postRequest('/skills', { name, category, type: 'technical', demandScore, aliases }, iToken)
  console.log(`   ✓ ${name} created`)
  return created.skill.id
}

const javaId = await ensureSkill('Java',  ['java se', 'java ee', 'core java', 'java 8', 'java 11'], 'Programming Languages', 88)
const cppId  = await ensureSkill('C++',   ['cpp', 'c plus plus', 'cplusplus', 'c++17', 'c++20'],    'Programming Languages', 74)

// ⑤ Job role — SDE
console.log('⑤ Job role — Software Development Engineer (SDE)')
const jobList = await getRequest(`/jobs?industryId=${industryId}&limit=20`, iToken)
let jobId = jobList.jobRoles?.find(j => j.title.toLowerCase().includes('software development engineer') || j.title.toUpperCase().includes('SDE'))?.id

if (jobId) {
  console.log(`   ✓ SDE already exists (${jobId.slice(0,8)}…)`)
} else {
  const jobRes = await postRequest('/jobs', {
    industryId,
    title:           'Software Development Engineer (SDE)',
    description: `About the Role
==============
TechCorp Solutions is seeking a talented and passionate Software Development Engineer (SDE) to join our core platform team in Pune. You will work on high-scale backend systems that power our enterprise product suite, serving millions of transactions daily across India.

As an SDE at TechCorp, you will be part of a collaborative engineering team that values clean code, performance, and innovation. We build systems that matter — from real-time data pipelines to intelligent APIs that drive business decisions for our clients across fintech, healthcare, and logistics sectors.

What You'll Do
--------------
• Design, develop, and maintain high-performance backend services using Java (Spring Boot) and C++
• Write clean, testable, and well-documented code adhering to SOLID principles
• Collaborate with product managers and designers to translate business requirements into elegant technical solutions
• Participate in code reviews and contribute to engineering best practices
• Debug and resolve performance bottlenecks in production systems handling 10M+ daily transactions
• Contribute to architectural decisions for scalable, distributed, fault-tolerant systems

What We're Looking For
-----------------------
• Strong proficiency in Java (Spring Boot preferred) and C++ (STL, modern C++17/20)
• Solid understanding of Data Structures, Algorithms, and System Design principles
• Ability to solve complex problems efficiently — we assess problem-solving, not memorisation
• Experience with version control using Git and collaborative workflows (pull requests, code reviews)
• Good communication skills and ability to thrive in an agile team environment

Nice to Have
------------
• Experience with microservices architecture and containerisation (Docker, Kubernetes)
• Familiarity with cloud platforms (AWS/Azure/GCP) — we run on AWS
• Prior internship or project experience in product engineering
• Contribution to open-source projects (a huge plus!)

Why TechCorp Solutions?
------------------------
• Competitive salary: ₹8L–18L depending on experience
• Flexible hybrid work model — 3 days Pune HQ, 2 days remote
• Learning & development budget: ₹50,000/year for courses, conferences, certifications
• Health insurance for you and your family
• Stock Appreciation Rights (SARs) for senior hires
• A genuinely collaborative, inclusive engineering culture — no bureaucracy, ship fast, learn faster`,
    status:          'active',
    employmentType:  'full-time',
    workMode:        'hybrid',
    location:        'Pune, Maharashtra',
    salaryMin:       800000,
    salaryMax:       1800000,
    salaryCurrency:  'INR',
    experienceYears: 1,
    tags:            ['java', 'c++', 'backend', 'sde', 'software-engineering', 'pune', 'product-engineering'],
    requiredSkills: [
      { skillId: javaId, skillName: 'Java',            level: 'advanced',     requirement: 'required'     },
      { skillId: cppId,  skillName: 'C++',             level: 'intermediate', requirement: 'required'     },
      { skillName: 'Data Structures',                   level: 'advanced',     requirement: 'required'     },
      { skillName: 'Algorithms',                        level: 'advanced',     requirement: 'required'     },
      { skillName: 'System Design',                     level: 'intermediate', requirement: 'preferred'    },
      { skillName: 'Git',                               level: 'intermediate', requirement: 'preferred'    },
      { skillName: 'Problem Solving',                   level: 'advanced',     requirement: 'required'     },
    ],
  }, iToken)
  jobId = jobRes.jobRole.id
  console.log(`   ✓ SDE created (${jobId.slice(0,8)}…)`)
}

// ⑥ Attach job description document
console.log('⑥ Job description document')
await tryPost(`/jobs/${jobId}/descriptions`, {
  content:  `Software Development Engineer — TechCorp Solutions, Pune. Required: Java (advanced), C++ (intermediate), Data Structures, Algorithms, Problem Solving. Salary: ₹8L–18L. Hybrid, Pune.`,
  source:   'manual',
  rawTitle: 'SDE at TechCorp Solutions 2026',
  notes:    'Primary engineering hire for platform team',
}, iToken)
console.log('   ✓ Done')

// ⑦ Demand signals
console.log('⑦ Demand signals')
await postRequest(`/demand/skills/${javaId}`, { demandScore: 88, region: 'Pune', sector: 'Technology', notes: 'High demand across product companies in Maharashtra' }, iToken).catch(() => {})
await postRequest(`/demand/skills/${cppId}`,  { demandScore: 74, region: 'Pune', sector: 'Technology', notes: 'Systems and embedded engineering demand' }, iToken).catch(() => {})
console.log('   ✓ Done')

// ⑧ Learner account
console.log('\n⑧ Learner account — arjun@learner.com')
const lSess   = await getOrCreateAccount('Arjun Kulkarni', 'arjun@learner.com', 'Learner@123', 'learner')
const lToken  = lSess.token
const lUserId = lSess.user?.id
console.log(`   ✓ ${lSess.user?.name} | role: ${lSess.user?.role}`)

// ⑨ Learner profile
console.log('⑨ Learner profile')
await patchRequest('/profiles/student', {
  targetRole:            'Software Development Engineer',
  location:              'Pune, Maharashtra',
  educationLevel:        'Bachelor',
  bio:                   'Final year B.Tech (Computer Science) student passionate about software engineering. Strong in Python and JavaScript, currently learning Java. Looking for my first SDE role at a product company.',
  preferredLearningMode: 'hybrid',
}, lToken).catch(() => {})
console.log('   ✓ Profile set')

// ⑩ Current skills (clean — no stale skillIds)
console.log('⑩ Learner current skills')
await patchRequest('/student/current-skills', {
  currentSkills: [
    { skillName: 'Python',          level: 'intermediate' },
    { skillName: 'JavaScript',      level: 'intermediate' },
    { skillName: 'Data Structures', level: 'beginner'     },
    { skillName: 'Git',             level: 'intermediate' },
    { skillName: 'Problem Solving', level: 'intermediate' },
  ],
}, lToken)
console.log('   ✓ Skills saved (Java + C++ intentionally absent → visible gaps)')

// ⑪ Set target role
console.log('⑪ Setting SDE as target role')
await patchRequest('/student/target-role', { jobRoleId: jobId }, lToken)
console.log('   ✓ Target role set')

// ⑫ Pre-compute gap analysis
console.log('⑫ Running gap analysis')
const gapResult = await postRequest('/match/gap', {
  subjectType:    'learner',
  subjectId:      lUserId,
  targetRole:     'Software Development Engineer (SDE)',
  jobRoleId:      jobId,
  requiredSkills: [
    { skillId: javaId, skillName: 'Java',            level: 'advanced',     requirement: 'required'  },
    { skillId: cppId,  skillName: 'C++',             level: 'intermediate', requirement: 'required'  },
    { skillName: 'Data Structures',                   level: 'advanced',     requirement: 'required'  },
    { skillName: 'Algorithms',                        level: 'advanced',     requirement: 'required'  },
    { skillName: 'System Design',                     level: 'intermediate', requirement: 'preferred' },
    { skillName: 'Git',                               level: 'intermediate', requirement: 'preferred' },
    { skillName: 'Problem Solving',                   level: 'advanced',     requirement: 'required'  },
  ],
  currentSkills: [
    { skillName: 'Python',          level: 'intermediate' },
    { skillName: 'JavaScript',      level: 'intermediate' },
    { skillName: 'Data Structures', level: 'beginner'     },
    { skillName: 'Git',             level: 'intermediate' },
    { skillName: 'Problem Solving', level: 'intermediate' },
  ],
}, lToken)
const score = gapResult.result?.readinessScore
const gaps  = gapResult.result?.gaps?.map(g => g.skillName).join(', ')
console.log(`   ✓ Readiness: ${score}%  |  Missing: ${gaps}`)

// ─── SUMMARY ─────────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(58))
console.log('  ✅  Demo data seeded!\n')
console.log('  INDUSTRY LOGIN')
console.log('  ──────────────────────────────────────────────────────')
console.log('  Email    : abc@company.com')
console.log('  Password : Company@123')
console.log('  Dashboard: http://localhost:5173/industry')
console.log('  What you see:')
console.log('    • TechCorp Solutions company profile')
console.log('    • SDE job role with Java & C++ requirements')
console.log('    • Full job description / story')
console.log('    • Demand signals for Java and C++')
console.log('    • View applicants → Arjun shows as a candidate with match score\n')
console.log('  LEARNER LOGIN')
console.log('  ──────────────────────────────────────────────────────')
console.log('  Email    : arjun@learner.com')
console.log('  Password : Learner@123')
console.log('  Dashboard: http://localhost:5173/student')
console.log('  What you see:')
console.log('    • Arjun Kulkarni — B.Tech CS, Pune')
console.log('    • Current skills: Python, JavaScript, DSA (beginner), Git, Problem Solving')
console.log(`    • Target role: SDE at TechCorp Solutions`)
console.log(`    • Readiness score: ${score}%`)
console.log(`    • Missing skills: ${gaps}`)
console.log('    • Upload resume → AI (Ollama) extracts more skills')
console.log('    • Recommendations tab → courses to close Java & C++ gaps')
console.log('    • Roadmap tab → ordered learning path')
console.log('═'.repeat(58))
