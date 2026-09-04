/**
 * Phase B4 — Skill Knowledge Base verification
 * Run: node tests/verify-b4.mjs  (server must be on :4000)
 *
 * Groups:
 *  1.  Auth enforcement  (write routes → 401/403 without correct role)
 *  2.  Create skill       (validation + happy path)
 *  3.  Duplicate guard    (conflict on same normalizedName)
 *  4.  Get one skill
 *  5.  List skills        (pagination + filters)
 *  6.  Skill categories   (aggregation)
 *  7.  Search skills      (text + regex fallback)
 *  8.  Update skill       (partial PATCH, field preservation)
 *  9.  Aliases            (add, conflict, remove)
 * 10.  Related skills     (add bidirectional, get, remove bidirectional)
 * 11.  Delete skill       (government only, soft-delete, cascades)
 * 12.  Deleted skill visibility (excluded from list/search/get)
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
  if (!r.ok) throw new Error(`${r.status} ${text}`)
  return JSON.parse(text)
}

// ── SETUP ────────────────────────────────────────────────────────────────────
console.log('\n[SETUP] Registering test accounts...')
const ts = Date.now()
const { token: tI } = await api('/auth/register', 'POST', null, { name: 'Industry', email: `ind_b4_${ts}@t.com`, password: 'pass1234', role: 'industry' })
const { token: tG } = await api('/auth/register', 'POST', null, { name: 'Govt',     email: `gov_b4_${ts}@t.com`, password: 'pass1234', role: 'government' })
const { token: tL } = await api('/auth/register', 'POST', null, { name: 'Learner',  email: `lrn_b4_${ts}@t.com`, password: 'pass1234', role: 'learner' })
console.log('  industry, government, learner tokens ready ✓')

// ─────────────────────────────────────────────────────────────────────────────
// 1. AUTH ENFORCEMENT
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[1] AUTH ENFORCEMENT')

// No token → 401 on write routes
check('POST /skills no token → 401',              await httpCode('/skills', 'POST'),                  401)
check('PATCH /skills/:id no token → 401',         await httpCode('/skills/fake-id', 'PATCH'),         401)
check('DELETE /skills/:id no token → 401',        await httpCode('/skills/fake-id', 'DELETE'),        401)
check('POST /skills/:id/aliases no token → 401',  await httpCode('/skills/fake-id/aliases', 'POST'),  401)
check('POST /skills/:id/related no token → 401',  await httpCode('/skills/fake-id/related', 'POST'),  401)

// Learner token → 403 on all write routes
check('POST /skills learner → 403',               await httpCode('/skills', 'POST', tL, { name: 'x', category: 'y' }), 403)
check('PATCH /skills/:id learner → 403',          await httpCode('/skills/fake-id', 'PATCH', tL, { name: 'x' }), 403)
check('DELETE /skills/:id learner → 403',         await httpCode('/skills/fake-id', 'DELETE', tL),   403)

// Industry token → 403 on delete (government only)
check('DELETE /skills/:id industry → 403',        await httpCode('/skills/fake-id', 'DELETE', tI),   403)

// ─────────────────────────────────────────────────────────────────────────────
// 2. CREATE SKILL — validation
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[2] CREATE SKILL — validation')

check('Missing name → 400',      await httpCode('/skills', 'POST', tI, { category: 'Cloud' }), 400)
check('Missing category → 400',  await httpCode('/skills', 'POST', tI, { name: 'Docker' }), 400)
check('Bad type → 400',          await httpCode('/skills', 'POST', tI, { name: 'X', category: 'Y', type: 'magic' }), 400)
check('Bad demandLevel → 400',   await httpCode('/skills', 'POST', tI, { name: 'X', category: 'Y', demandLevel: 'god' }), 400)
check('Bad demandScore → 400',   await httpCode('/skills', 'POST', tI, { name: 'X', category: 'Y', demandScore: 150 }), 400)
check('aliases not array → 400', await httpCode('/skills', 'POST', tI, { name: 'X', category: 'Y', aliases: 'python' }), 400)
check('tags not array → 400',    await httpCode('/skills', 'POST', tI, { name: 'X', category: 'Y', tags: 'ai' }), 400)

// ─────────────────────────────────────────────────────────────────────────────
// 2b. CREATE SKILL — happy paths
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[2b] CREATE SKILL — happy path')

const s1 = await api('/skills', 'POST', tI, {
  name: `Python ${ts}`, category: 'Programming Languages', type: 'technical',
  description: 'General-purpose programming language.',
  aliases: [`py-${ts}`, `python3-${ts}`],
  tags: ['backend', 'data-science', 'ai'],
  demandLevel: 'advanced', demandScore: 88,
})
check('s1 created — id present',       !!s1.skill.id,                        true)
check('s1 name correct',               s1.skill.name,                        `Python ${ts}`)
check('s1 normalizedName lowercase',   s1.skill.normalizedName,              `python ${ts}`)
check('s1 category',                   s1.skill.category,                    'Programming Languages')
check('s1 type',                       s1.skill.type,                        'technical')
check('s1 aliases count',              s1.skill.aliases.length,              2)
check('s1 tags count',                 s1.skill.tags.length,                 3)
check('s1 demandScore',                s1.skill.demandScore,                 88)
check('s1 demandLevel',                s1.skill.demandLevel,                 'advanced')
check('s1 isDeleted false',            s1.skill.isDeleted,                   false)
check('s1 createdAt present',          !!s1.skill.createdAt,                 true)

const s2 = await api('/skills', 'POST', tI, {
  name: `Docker ${ts}`, category: 'DevOps', type: 'tool',
  aliases: [`docker-ce-${ts}`], tags: ['containers', 'devops'], demandScore: 76,
})
check('s2 created',                    !!s2.skill.id,                        true)

const s3 = await api('/skills', 'POST', tG, {
  name: `Kubernetes ${ts}`, category: 'DevOps', type: 'tool',
  aliases: [`k8s-${ts}`], tags: ['orchestration', 'devops'], demandScore: 82,
})
check('s3 created by govt',            !!s3.skill.id,                        true)

const s4 = await api('/skills', 'POST', tI, {
  name: `TensorFlow ${ts}`, category: 'AI / ML', type: 'tool',
  tags: ['deep-learning', 'ai'], demandScore: 79,
})
check('s4 created',                    !!s4.skill.id,                        true)

const s5 = await api('/skills', 'POST', tI, {
  name: `Cloud Security ${ts}`, category: 'Cybersecurity', type: 'domain',
  tags: ['cloud', 'security'], demandLevel: 'expert', demandScore: 91,
})
check('s5 created',                    !!s5.skill.id,                        true)

// ─────────────────────────────────────────────────────────────────────────────
// 3. DUPLICATE GUARD
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[3] DUPLICATE GUARD')
check('Same name → 409', await httpCode('/skills', 'POST', tI, { name: `Python ${ts}`, category: 'Programming Languages' }), 409)
// Mixed case should also be caught (normalizedName)
check('Same name different case → 409', await httpCode('/skills', 'POST', tI, { name: `PYTHON ${ts}`, category: 'X' }), 409)

// ─────────────────────────────────────────────────────────────────────────────
// 4. GET ONE SKILL
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[4] GET ONE SKILL')
const got1 = await api(`/skills/${s1.skill.id}`)
check('GET skill id matches',     got1.skill.id,            s1.skill.id)
check('GET skill name',           got1.skill.name,          s1.skill.name)
check('GET skill description',    got1.skill.description,   'General-purpose programming language.')
check('GET skill aliases[0]',     got1.skill.aliases[0],    `py-${ts}`)
check('GET non-existent → 404',   await httpCode('/skills/00000000-0000-0000-0000-000000000000'), 404)

// ─────────────────────────────────────────────────────────────────────────────
// 5. LIST SKILLS
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[5] LIST SKILLS — pagination + filters')

const listAll = await api('/skills?limit=100')
check('List returns skills array',        Array.isArray(listAll.skills),          true)
check('List pagination object present',   !!listAll.pagination,                   true)
check('List total >= 5',                  listAll.pagination.total >= 5,          true)

// Filter by category
const listDevOps = await api('/skills?category=DevOps&limit=50')
const devOpsNames = listDevOps.skills.map(s => s.name)
check('Filter DevOps includes s2',        devOpsNames.includes(s2.skill.name),    true)
check('Filter DevOps includes s3',        devOpsNames.includes(s3.skill.name),    true)
check('Filter DevOps excludes s1',        !devOpsNames.includes(s1.skill.name),   true)

// Filter by type
const listTools = await api('/skills?type=tool&limit=50')
const toolNames  = listTools.skills.map(s => s.name)
check('Filter type=tool includes s2',     toolNames.includes(s2.skill.name),      true)
check('Filter type=tool excludes s1',     !toolNames.includes(s1.skill.name),     true)

// Filter by demandLevel
const listAdv = await api('/skills?level=advanced&limit=50')
check('Filter level=advanced includes s1', listAdv.skills.map(s=>s.id).includes(s1.skill.id), true)

// Filter by tag
const listAI = await api(`/skills?tag=ai&limit=50`)
check('Filter tag=ai includes s1',        listAI.skills.map(s=>s.id).includes(s1.skill.id), true)

// Pagination
const page1 = await api('/skills?limit=2&page=1')
const page2 = await api('/skills?limit=2&page=2')
check('Page 1 has 2 results',             page1.skills.length,                    2)
check('Page 1 and 2 differ',              page1.skills[0]?.id !== page2.skills[0]?.id, true)
check('Pagination.pages >= 1',            page1.pagination.pages >= 1,            true)

// Sort
const asc  = await api('/skills?sort=demandScore&order=asc&limit=10')
const desc = await api('/skills?sort=demandScore&order=desc&limit=10')
check('Sort asc first score <= last',
  (asc.skills[0]?.demandScore ?? 0) <= (asc.skills[asc.skills.length-1]?.demandScore ?? 0), true)
check('Sort desc first score >= last',
  (desc.skills[0]?.demandScore ?? 0) >= (desc.skills[desc.skills.length-1]?.demandScore ?? 0), true)

// ─────────────────────────────────────────────────────────────────────────────
// 6. SKILL CATEGORIES
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[6] SKILL CATEGORIES')
const cats = await api('/skills/categories')
check('Categories array present',         Array.isArray(cats.categories),          true)
check('At least 3 categories',            cats.categories.length >= 3,             true)
const catNames = cats.categories.map(c => c.category)
check('DevOps in categories',             catNames.includes('DevOps'),             true)
check('Programming Languages in cats',    catNames.includes('Programming Languages'), true)
check('Each category has count',          cats.categories.every(c => typeof c.count === 'number'), true)

// ─────────────────────────────────────────────────────────────────────────────
// 7. SEARCH SKILLS
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[7] SEARCH SKILLS')
check('Search missing q → 400',           await httpCode('/skills/search'), 400)

// Text/regex search on name
const srchPy = await api(`/skills/search?q=Python+${ts}`)
check('Search "Python ts" returns results', srchPy.count >= 1,                     true)
check('Search result contains s1',         srchPy.skills.map(s=>s.id).includes(s1.skill.id), true)

// Search on alias
const srchAlias = await api(`/skills/search?q=py-${ts}`)
check('Search by alias finds s1',          srchAlias.skills.map(s=>s.id).includes(s1.skill.id), true)

// Search with category filter
const srchFiltered = await api(`/skills/search?q=${ts}&category=DevOps`)
const filteredIds   = srchFiltered.skills.map(s => s.id)
check('Search+category filter includes s2',  filteredIds.includes(s2.skill.id),    true)
check('Search+category filter excludes s1',  !filteredIds.includes(s1.skill.id),   true)

// ─────────────────────────────────────────────────────────────────────────────
// 8. UPDATE SKILL
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[8] UPDATE SKILL')

check('PATCH empty body → 400',           await httpCode(`/skills/${s1.skill.id}`, 'PATCH', tI, {}), 400)
check('PATCH bad type → 400',             await httpCode(`/skills/${s1.skill.id}`, 'PATCH', tI, { type: 'magic' }), 400)
check('PATCH bad demandLevel → 400',      await httpCode(`/skills/${s1.skill.id}`, 'PATCH', tI, { demandLevel: 'god' }), 400)
check('PATCH self-conflicting name → 409 or 200',  // rename to existing other skill name
  await httpCode(`/skills/${s2.skill.id}`, 'PATCH', tI, { name: `Python ${ts}` }), 409)

const updated = await api(`/skills/${s1.skill.id}`, 'PATCH', tI, {
  description: 'Updated description.',
  demandScore: 95,
  tags: ['backend', 'data-science', 'ai', 'ml'],
})
check('Update description',              updated.skill.description,              'Updated description.')
check('Update demandScore',              updated.skill.demandScore,              95)
check('Update tags count',               updated.skill.tags.length,              4)
check('Update name preserved',           updated.skill.name,                     s1.skill.name)
check('Update aliases preserved',        updated.skill.aliases.length,           2)
check('Update updatedAt changed',        updated.skill.updatedAt !== s1.skill.createdAt, true)

// Non-existent skill
check('PATCH non-existent → 404',        await httpCode('/skills/00000000-0000-0000-0000-000000000000', 'PATCH', tI, { description: 'x' }), 404)

// ─────────────────────────────────────────────────────────────────────────────
// 9. ALIASES
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[9] ALIASES')

// Add aliases
check('Add aliases not array → 400',
  await httpCode(`/skills/${s1.skill.id}/aliases`, 'POST', tI, { aliases: 'cpython' }), 400)
check('Add empty aliases array → 400',
  await httpCode(`/skills/${s1.skill.id}/aliases`, 'POST', tI, { aliases: [] }), 400)

const afterAdd = await api(`/skills/${s1.skill.id}/aliases`, 'POST', tI, {
  aliases: [`cpython-${ts}`, `snakescript-${ts}`],
})
check('After add aliases count',         afterAdd.skill.aliases.length,          4)
check('New alias present',               afterAdd.skill.aliases.includes(`cpython-${ts}`), true)

// Add duplicate alias → 409
check('Add existing alias → 409',
  await httpCode(`/skills/${s1.skill.id}/aliases`, 'POST', tI, { aliases: [`cpython-${ts}`] }), 409)

// Remove alias
check('Remove missing alias body → 400',
  await httpCode(`/skills/${s1.skill.id}/aliases`, 'DELETE', tI, {}), 400)

const afterRemove = await api(`/skills/${s1.skill.id}/aliases`, 'DELETE', tI, { alias: `cpython-${ts}` })
check('After remove aliases count',      afterRemove.skill.aliases.length,       3)
check('Removed alias gone',              !afterRemove.skill.aliases.includes(`cpython-${ts}`), true)

// Remove alias that doesn't exist → 404
check('Remove non-existent alias → 404',
  await httpCode(`/skills/${s1.skill.id}/aliases`, 'DELETE', tI, { alias: 'doesnotexist' }), 404)

// ─────────────────────────────────────────────────────────────────────────────
// 10. RELATED SKILLS
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[10] RELATED SKILLS')

// Validation
check('Add related not array → 400',
  await httpCode(`/skills/${s1.skill.id}/related`, 'POST', tI, { relatedSkillIds: 'bad' }), 400)
check('Add related empty array → 400',
  await httpCode(`/skills/${s1.skill.id}/related`, 'POST', tI, { relatedSkillIds: [] }), 400)
check('Add self as related → 400',
  await httpCode(`/skills/${s1.skill.id}/related`, 'POST', tI, { relatedSkillIds: [s1.skill.id] }), 400)
check('Add non-existent related → 400',
  await httpCode(`/skills/${s1.skill.id}/related`, 'POST', tI, { relatedSkillIds: ['00000000-0000-0000-0000-000000000000'] }), 400)

// Add related skills (s1 ↔ s2, s1 ↔ s4)
const rel1 = await api(`/skills/${s1.skill.id}/related`, 'POST', tI, {
  relatedSkillIds: [s2.skill.id, s4.skill.id],
})
check('After add related count on s1',   rel1.skill.relatedSkillIds.length,      2)
check('s2 in s1 relatedSkillIds',        rel1.skill.relatedSkillIds.includes(s2.skill.id), true)
check('s4 in s1 relatedSkillIds',        rel1.skill.relatedSkillIds.includes(s4.skill.id), true)

// Verify bidirectionality — s2 should now list s1 as related
const s2After = await api(`/skills/${s2.skill.id}`)
check('Bidirectional: s2 has s1 in relatedSkillIds', s2After.skill.relatedSkillIds.includes(s1.skill.id), true)

// Add duplicate related → 409
check('Add already-related → 409',
  await httpCode(`/skills/${s1.skill.id}/related`, 'POST', tI, { relatedSkillIds: [s2.skill.id] }), 409)

// GET related skills endpoint
const related = await api(`/skills/${s1.skill.id}/related`)
check('GET related returns array',        Array.isArray(related.relatedSkills),   true)
check('GET related count = 2',            related.count,                          2)
const relatedIds = related.relatedSkills.map(s => s.id)
check('GET related includes s2',          relatedIds.includes(s2.skill.id),       true)
check('GET related includes s4',          relatedIds.includes(s4.skill.id),       true)

// Remove related (s1 ↔ s2 unlink)
check('Remove related self → 400',
  await httpCode(`/skills/${s1.skill.id}/related/${s1.skill.id}`, 'DELETE', tI), 400)
check('Remove non-linked related → 404',
  await httpCode(`/skills/${s1.skill.id}/related/${s3.skill.id}`, 'DELETE', tI), 404)

const afterUnlink = await api(`/skills/${s1.skill.id}/related/${s2.skill.id}`, 'DELETE', tI)
check('After unlink s1 related count',    afterUnlink.skill.relatedSkillIds.length, 1)
check('s2 no longer in s1 related',       !afterUnlink.skill.relatedSkillIds.includes(s2.skill.id), true)

// Verify bidirectionality of unlink
const s2Unlinked = await api(`/skills/${s2.skill.id}`)
check('Bidirectional unlink: s2 no longer has s1', !s2Unlinked.skill.relatedSkillIds.includes(s1.skill.id), true)

// ─────────────────────────────────────────────────────────────────────────────
// 11. DELETE SKILL
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[11] DELETE SKILL')

// Industry cannot delete
check('Industry DELETE → 403',            await httpCode(`/skills/${s5.skill.id}`, 'DELETE', tI), 403)

// First link s5 to s3 so we can test cascade
await api(`/skills/${s5.skill.id}/related`, 'POST', tG, { relatedSkillIds: [s3.skill.id] })
const s3BeforeDelete = await api(`/skills/${s3.skill.id}`)
check('s3 has s5 before delete',          s3BeforeDelete.skill.relatedSkillIds.includes(s5.skill.id), true)

// Government deletes s5
const delResult = await api(`/skills/${s5.skill.id}`, 'DELETE', tG)
check('Delete returns message',           delResult.message,                      'Skill deleted successfully')
check('Delete returns id',                delResult.id,                           s5.skill.id)

// Non-existent delete
check('Delete non-existent → 404',        await httpCode('/skills/00000000-0000-0000-0000-000000000000', 'DELETE', tG), 404)

// ─────────────────────────────────────────────────────────────────────────────
// 12. DELETED SKILL VISIBILITY
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[12] DELETED SKILL VISIBILITY')

check('GET deleted skill → 404',          await httpCode(`/skills/${s5.skill.id}`), 404)

const listAfterDel = await api('/skills?limit=100')
check('Deleted skill absent from list',   !listAfterDel.skills.map(s=>s.id).includes(s5.skill.id), true)

const srchAfterDel = await api(`/skills/search?q=Cloud+Security+${ts}`)
check('Deleted skill absent from search', !srchAfterDel.skills.map(s=>s.id).includes(s5.skill.id), true)

// Cascade: s3 should no longer list s5 in relatedSkillIds
const s3After = await api(`/skills/${s3.skill.id}`)
check('Cascade: s3 relatedSkillIds no longer has s5', !s3After.skill.relatedSkillIds.includes(s5.skill.id), true)

// Double-delete guard (already deleted)
check('Re-delete already deleted → 404', await httpCode(`/skills/${s5.skill.id}`, 'DELETE', tG), 404)

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────
const total = pass + fail
console.log(`\n${'─'.repeat(50)}`)
console.log(`  TOTAL  ${total}   PASS  ${pass}   FAIL  ${fail}`)
console.log('─'.repeat(50))
if (fail > 0) process.exit(1)
