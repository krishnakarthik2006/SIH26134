/**
 * Phase B9 — Skill Normalization Routes
 * Mounted at /api/normalize
 *
 * Public (no auth):
 *   POST /api/normalize               — batch normalize raw skill terms
 *
 * Protected reads (any authenticated user):
 *   GET  /api/normalize/mappings      — list all skill_mappings (paginated)
 *   GET  /api/normalize/mappings/:id  — get one mapping
 *
 * Protected writes (industry | government):
 *   POST   /api/normalize/mappings          — create mapping(s)
 *   PATCH  /api/normalize/mappings/:id      — update a mapping's target skill
 *   DELETE /api/normalize/mappings/:id      — delete a mapping
 *   POST   /api/normalize/mappings/bulk     — bulk upsert mappings
 */

import { randomUUID } from 'node:crypto'
import { Router }     from 'express'
import { getDatabase }          from '../db.js'
import { asyncHandler }         from '../middleware/errorHandler.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { normalizeTerms, deduplicateResults, buildNormalizedTerm } from '../services/normalization.js'

const router   = Router()
const WRITE_ROLES = ['industry', 'government']

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const bad      = (m) => Object.assign(new Error(m), { statusCode: 400 })
const notFound = (m = 'Mapping not found') => Object.assign(new Error(m), { statusCode: 404 })
const conflict = (m) => Object.assign(new Error(m), { statusCode: 409 })

function pub(doc) {
  if (!doc) return null
  const { _id, ...rest } = doc
  return { id: _id, ...rest }
}

// ─── PUBLIC ───────────────────────────────────────────────────────────────────

/**
 * POST /api/normalize
 * Resolve one or many raw skill strings to canonical skills.
 *
 * Body:
 *   terms*         string[]   — raw skill strings to normalize (1-100)
 *   deduplicate    boolean    — merge results that resolve to same canonical skill (default true)
 *   maxEditDistance  number   — override fuzzy threshold (0-3, default 2)
 *   tokenOverlapThresh number — override Jaccard threshold (0-1, default 0.6)
 *
 * Response:
 *   {
 *     results: MatchResult[],
 *     summary: { total, matched, unmatched, byMatchType: {...} }
 *   }
 */
router.post('/', asyncHandler(async (req, res) => {
  const { terms, deduplicate = true, maxEditDistance, tokenOverlapThresh } = req.body

  if (!Array.isArray(terms) || terms.length === 0)
    throw bad('terms must be a non-empty array of strings')
  if (terms.length > 100)
    throw bad('terms array must not exceed 100 items per request')
  if (terms.some(t => typeof t !== 'string' || !t.trim()))
    throw bad('every item in terms must be a non-empty string')

  const opts = {}
  if (maxEditDistance !== undefined) {
    if (typeof maxEditDistance !== 'number' || maxEditDistance < 0 || maxEditDistance > 3)
      throw bad('maxEditDistance must be a number between 0 and 3')
    opts.maxEditDistance = maxEditDistance
  }
  if (tokenOverlapThresh !== undefined) {
    if (typeof tokenOverlapThresh !== 'number' || tokenOverlapThresh < 0 || tokenOverlapThresh > 1)
      throw bad('tokenOverlapThresh must be a number between 0 and 1')
    opts.tokenOverlapThresh = tokenOverlapThresh
  }

  const raw     = terms.map(t => t.trim())
  let   results = await normalizeTerms(raw, opts)
  if (deduplicate) results = deduplicateResults(results)

  // Build summary
  const byMatchType = {}
  for (const r of results) {
    byMatchType[r.matchType] = (byMatchType[r.matchType] || 0) + 1
  }

  res.json({
    results,
    summary: {
      total:     raw.length,
      matched:   results.filter(r => r.matched).length,
      unmatched: results.filter(r => !r.matched).length,
      byMatchType,
    },
  })
}))

// ─── PROTECTED READS ─────────────────────────────────────────────────────────
router.use(requireAuth)

/**
 * GET /api/normalize/mappings
 * Query: skillId, page, limit, sort (sourceTerm|createdAt), order
 */
router.get('/mappings', asyncHandler(async (req, res) => {
  const { skillId, page: pg = '1', limit: lm = '20', sort = 'sourceTerm', order = 'asc' } = req.query
  const page  = Math.max(1, parseInt(pg, 10)  || 1)
  const limit = Math.min(100, Math.max(1, parseInt(lm, 10) || 20))
  const skip  = (page - 1) * limit

  const filter = {}
  if (skillId) filter.skillId = skillId

  const sortField = ['sourceTerm', 'createdAt'].includes(sort) ? sort : 'sourceTerm'
  const col   = getDatabase().collection('skill_mappings')
  const total = await col.countDocuments(filter)
  const docs  = await col.find(filter).sort({ [sortField]: order === 'desc' ? -1 : 1 }).skip(skip).limit(limit).toArray()

  res.json({ mappings: docs.map(pub), pagination: { total, page, limit, pages: Math.ceil(total / limit) } })
}))

/**
 * GET /api/normalize/mappings/:id
 */
router.get('/mappings/:id', asyncHandler(async (req, res) => {
  const doc = await getDatabase().collection('skill_mappings').findOne({ _id: req.params.id })
  if (!doc) throw notFound()
  res.json({ mapping: pub(doc) })
}))

// ─── WRITE ROUTES ─────────────────────────────────────────────────────────────

/**
 * POST /api/normalize/mappings
 * Create a single mapping: sourceTerm → skillId
 *
 * Body:
 *   sourceTerm*  string  — raw/variant term (will be cleaned before storing)
 *   skillId*     string  — UUID of the canonical skill in the skills collection
 *   notes        string  — optional admin note
 */
router.post('/mappings', requireRole(...WRITE_ROLES), asyncHandler(async (req, res) => {
  const { sourceTerm, skillId, notes = '' } = req.body

  if (!sourceTerm?.trim()) throw bad('sourceTerm is required')
  if (!skillId?.trim())    throw bad('skillId is required')

  const cleanedTerm = buildNormalizedTerm(sourceTerm)
  if (!cleanedTerm) throw bad('sourceTerm reduces to an empty string after cleaning')

  // Verify canonical skill exists
  const skill = await getDatabase().collection('skills').findOne({ _id: skillId, isDeleted: { $ne: true } })
  if (!skill) throw bad(`skillId "${skillId}" does not exist in the skill knowledge base`)

  // Prevent duplicate sourceTerm
  const existing = await getDatabase().collection('skill_mappings').findOne({ sourceTerm: cleanedTerm })
  if (existing) throw conflict(`A mapping for "${cleanedTerm}" already exists (mapped to skill ${existing.skillId})`)

  const now = new Date()
  const doc = {
    _id: randomUUID(), sourceTerm: cleanedTerm, originalTerm: sourceTerm.trim(),
    skillId, skillName: skill.name, notes,
    createdBy: req.user.id, createdAt: now, updatedAt: now,
  }
  await getDatabase().collection('skill_mappings').insertOne(doc)
  res.status(201).json({ mapping: pub(doc) })
}))

/**
 * POST /api/normalize/mappings/bulk
 * Upsert multiple mappings at once.
 *
 * Body:
 *   mappings*  Array<{ sourceTerm, skillId, notes? }>  (max 500)
 *   mode       "skip" | "replace"  — what to do on duplicate sourceTerm (default "skip")
 *
 * Response:
 *   { created, skipped, replaced, errors[] }
 */
router.post('/mappings/bulk', requireRole(...WRITE_ROLES), asyncHandler(async (req, res) => {
  const { mappings, mode = 'skip' } = req.body

  if (!Array.isArray(mappings) || mappings.length === 0) throw bad('mappings must be a non-empty array')
  if (mappings.length > 500) throw bad('mappings array must not exceed 500 items per request')
  if (!['skip', 'replace'].includes(mode)) throw bad('mode must be "skip" or "replace"')

  const db  = getDatabase()
  const col = db.collection('skill_mappings')
  let created = 0, skipped = 0, replaced = 0
  const errors = []

  for (const [i, item] of mappings.entries()) {
    try {
      if (!item.sourceTerm?.trim()) throw new Error('sourceTerm is required')
      if (!item.skillId?.trim())   throw new Error('skillId is required')

      const cleanedTerm = buildNormalizedTerm(item.sourceTerm)
      if (!cleanedTerm) throw new Error('sourceTerm reduces to empty string after cleaning')

      const skill = await db.collection('skills').findOne({ _id: item.skillId, isDeleted: { $ne: true } })
      if (!skill) throw new Error(`skillId "${item.skillId}" not found`)

      const existing = await col.findOne({ sourceTerm: cleanedTerm })
      if (existing) {
        if (mode === 'skip') { skipped++; continue }
        // replace
        await col.updateOne({ _id: existing._id }, {
          $set: { skillId: item.skillId, skillName: skill.name, notes: item.notes || '', updatedAt: new Date() },
        })
        replaced++
      } else {
        const now = new Date()
        await col.insertOne({
          _id: randomUUID(), sourceTerm: cleanedTerm, originalTerm: item.sourceTerm.trim(),
          skillId: item.skillId, skillName: skill.name, notes: item.notes || '',
          createdBy: req.user.id, createdAt: now, updatedAt: now,
        })
        created++
      }
    } catch (err) {
      errors.push({ index: i, sourceTerm: item.sourceTerm, error: err.message })
    }
  }

  res.status(207).json({ created, skipped, replaced, errors, total: mappings.length })
}))

/**
 * PATCH /api/normalize/mappings/:id
 * Update the target skillId (or notes) of an existing mapping.
 *
 * Body: { skillId?, notes? }
 */
router.patch('/mappings/:id', requireRole(...WRITE_ROLES), asyncHandler(async (req, res) => {
  const doc = await getDatabase().collection('skill_mappings').findOne({ _id: req.params.id })
  if (!doc) throw notFound()

  const { skillId, notes } = req.body
  if (skillId === undefined && notes === undefined) throw bad('Provide skillId or notes to update')

  const update = { updatedAt: new Date() }

  if (skillId !== undefined) {
    const skill = await getDatabase().collection('skills').findOne({ _id: skillId, isDeleted: { $ne: true } })
    if (!skill) throw bad(`skillId "${skillId}" does not exist`)
    update.skillId   = skillId
    update.skillName = skill.name
  }
  if (notes !== undefined) update.notes = notes

  const result = await getDatabase().collection('skill_mappings').findOneAndUpdate(
    { _id: req.params.id }, { $set: update }, { returnDocument: 'after' },
  )
  res.json({ mapping: pub(result) })
}))

/**
 * DELETE /api/normalize/mappings/:id
 */
router.delete('/mappings/:id', requireRole(...WRITE_ROLES), asyncHandler(async (req, res) => {
  const doc = await getDatabase().collection('skill_mappings').findOne({ _id: req.params.id })
  if (!doc) throw notFound()
  await getDatabase().collection('skill_mappings').deleteOne({ _id: req.params.id })
  res.json({ message: 'Mapping deleted', id: req.params.id })
}))

export default router
