/**
 * Phase B4 — Skill Knowledge Base
 *
 * Routes mounted at /api/skills
 *
 * Public (read-only, no auth required):
 *   GET  /api/skills                   — list skills (paginated, filterable)
 *   GET  /api/skills/search            — full-text + field search
 *   GET  /api/skills/categories        — list all distinct categories
 *   GET  /api/skills/:id               — get one skill
 *   GET  /api/skills/:id/related       — skills related to a skill
 *
 * Protected (require auth):
 *   POST   /api/skills                 — create skill         (industry | government)
 *   PATCH  /api/skills/:id             — update skill         (industry | government)
 *   DELETE /api/skills/:id             — soft-delete skill    (government only)
 *   POST   /api/skills/:id/aliases     — add alias(es)        (industry | government)
 *   DELETE /api/skills/:id/aliases     — remove alias         (industry | government)
 *   POST   /api/skills/:id/related     — link related skills  (industry | government)
 *   DELETE /api/skills/:id/related/:relatedId  — unlink       (industry | government)
 */

import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { getDatabase } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

const router = Router()

// ─── ALLOWED CONSTANTS ───────────────────────────────────────────────────────

export const VALID_LEVELS = ['beginner', 'intermediate', 'advanced', 'expert']
export const VALID_TYPES  = ['technical', 'soft', 'domain', 'tool', 'certification']

const WRITE_ROLES = ['industry', 'government']

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function badRequest(msg) {
  const e = new Error(msg); e.statusCode = 400; return e
}
function notFound(msg = 'Skill not found') {
  const e = new Error(msg); e.statusCode = 404; return e
}
function conflict(msg) {
  const e = new Error(msg); e.statusCode = 409; return e
}

/** Lowercase, trim, collapse internal whitespace */
function normalize(name) {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Strip _id, return id instead */
function pub(doc) {
  if (!doc) return null
  const { _id, ...rest } = doc
  return { id: _id, ...rest }
}

/** Return a skill by its UUID — throws 404 if missing or deleted */
async function findActive(id) {
  const skill = await getDatabase().collection('skills').findOne({ _id: id, isDeleted: { $ne: true } })
  if (!skill) throw notFound()
  return skill
}

// ─── 1. LIST SKILLS ──────────────────────────────────────────────────────────
/**
 * GET /api/skills
 * Query params:
 *   category  — filter by category (exact, case-insensitive)
 *   type      — filter by type
 *   level     — filter by demandLevel
 *   tag       — filter by tag (exact match in tags array)
 *   page      — 1-based page number (default 1)
 *   limit     — page size (default 20, max 100)
 *   sort      — field to sort by: name|category|createdAt|demandScore (default name)
 *   order     — asc|desc (default asc)
 */
router.get('/', asyncHandler(async (_req, res) => {
  const {
    category, type, level, tag,
    page = '1', limit = '20',
    sort = 'name', order = 'asc',
  } = _req.query

  const pageNum  = Math.max(1, parseInt(page,  10) || 1)
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20))
  const skip     = (pageNum - 1) * limitNum

  const filter = { isDeleted: { $ne: true } }
  if (category) filter.category    = { $regex: new RegExp(`^${category}$`, 'i') }
  if (type)     filter.type        = type
  if (level)    filter.demandLevel = level
  if (tag)      filter.tags        = tag

  const sortField = ['name', 'category', 'createdAt', 'demandScore'].includes(sort) ? sort : 'name'
  const sortDir   = order === 'desc' ? -1 : 1

  const col   = getDatabase().collection('skills')
  const total = await col.countDocuments(filter)
  const docs  = await col.find(filter)
    .sort({ [sortField]: sortDir })
    .skip(skip)
    .limit(limitNum)
    .toArray()

  res.json({
    skills:     docs.map(pub),
    pagination: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) },
  })
}))

// ─── 2. SEARCH SKILLS ────────────────────────────────────────────────────────
/**
 * GET /api/skills/search?q=...
 * Full-text MongoDB text search across name, aliases, description, tags.
 * Falls back to a regex prefix search on name if no text index hit.
 *
 * Query params:
 *   q        — search string (required)
 *   category — optional category filter
 *   type     — optional type filter
 *   limit    — max results (default 20, max 50)
 */
router.get('/search', asyncHandler(async (req, res) => {
  const { q, category, type, limit = '20' } = req.query
  if (!q?.trim()) throw badRequest('q (search query) is required')

  const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 20))
  const filter   = { isDeleted: { $ne: true } }
  if (category) filter.category = { $regex: new RegExp(`^${category}$`, 'i') }
  if (type)     filter.type     = type

  const col = getDatabase().collection('skills')

  // Try MongoDB text search first (uses the text index)
  let docs = await col
    .find({ $text: { $search: q }, ...filter })
    .sort({ score: { $meta: 'textScore' } })
    .limit(limitNum)
    .toArray()

  // Fallback: prefix regex on normalizedName and aliases
  if (docs.length === 0) {
    const regex = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    docs = await col
      .find({ ...filter, $or: [{ normalizedName: regex }, { aliases: regex }, { name: regex }] })
      .sort({ name: 1 })
      .limit(limitNum)
      .toArray()
  }

  res.json({ skills: docs.map(pub), count: docs.length, query: q })
}))

// ─── 3. LIST CATEGORIES ──────────────────────────────────────────────────────
/**
 * GET /api/skills/categories
 * Returns every distinct category with its skill count.
 */
router.get('/categories', asyncHandler(async (_req, res) => {
  const pipeline = [
    { $match: { isDeleted: { $ne: true } } },
    { $group: { _id: '$category', count: { $sum: 1 } } },
    { $match: { _id: { $ne: null } } },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, category: '$_id', count: 1 } },
  ]
  const categories = await getDatabase().collection('skills').aggregate(pipeline).toArray()
  res.json({ categories })
}))

// ─── 4. GET ONE SKILL ────────────────────────────────────────────────────────
/**
 * GET /api/skills/:id
 */
router.get('/:id', asyncHandler(async (req, res) => {
  const skill = await findActive(req.params.id)
  res.json({ skill: pub(skill) })
}))

// ─── 5. GET RELATED SKILLS ───────────────────────────────────────────────────
/**
 * GET /api/skills/:id/related
 * Returns full skill documents for each id listed in skill.relatedSkillIds.
 */
router.get('/:id/related', asyncHandler(async (req, res) => {
  const skill = await findActive(req.params.id)
  const ids   = skill.relatedSkillIds || []

  const related = ids.length
    ? await getDatabase().collection('skills')
        .find({ _id: { $in: ids }, isDeleted: { $ne: true } })
        .sort({ name: 1 })
        .toArray()
    : []

  res.json({ relatedSkills: related.map(pub), count: related.length })
}))

// ─── WRITE ROUTES — require auth from here ───────────────────────────────────
router.use(requireAuth)

// ─── 6. CREATE SKILL ─────────────────────────────────────────────────────────
/**
 * POST /api/skills
 * Body:
 *   name*         — canonical display name
 *   category*     — e.g. "Cloud Computing"
 *   type          — technical|soft|domain|tool|certification  (default technical)
 *   description   — free text
 *   aliases[]     — alternative names / acronyms
 *   tags[]        — free-form labels for grouping
 *   demandLevel   — beginner|intermediate|advanced|expert
 *   demandScore   — 0-100 numeric score
 *   relatedSkillIds[] — UUIDs of existing skills
 */
router.post('/', requireRole(...WRITE_ROLES), asyncHandler(async (req, res) => {
  const {
    name, category, type = 'technical',
    description = '', aliases = [], tags = [],
    demandLevel, demandScore, relatedSkillIds = [],
  } = req.body

  // ── Validate required fields
  if (!name?.trim())     throw badRequest('name is required')
  if (!category?.trim()) throw badRequest('category is required')

  // ── Validate enums
  if (!VALID_TYPES.includes(type))
    throw badRequest(`type must be one of: ${VALID_TYPES.join(', ')}`)
  if (demandLevel && !VALID_LEVELS.includes(demandLevel))
    throw badRequest(`demandLevel must be one of: ${VALID_LEVELS.join(', ')}`)
  if (demandScore !== undefined && (typeof demandScore !== 'number' || demandScore < 0 || demandScore > 100))
    throw badRequest('demandScore must be a number between 0 and 100')

  // ── Validate arrays
  if (!Array.isArray(aliases))        throw badRequest('aliases must be an array')
  if (!Array.isArray(tags))           throw badRequest('tags must be an array')
  if (!Array.isArray(relatedSkillIds)) throw badRequest('relatedSkillIds must be an array')

  // ── Validate related skill IDs exist
  if (relatedSkillIds.length) {
    const found = await getDatabase().collection('skills')
      .countDocuments({ _id: { $in: relatedSkillIds }, isDeleted: { $ne: true } })
    if (found !== relatedSkillIds.length)
      throw badRequest('One or more relatedSkillIds do not exist')
  }

  const normalizedName = normalize(name)
  const normalizedAliases = aliases.map(normalize).filter(Boolean)

  // ── Check uniqueness on normalizedName
  const existing = await getDatabase().collection('skills').findOne({ normalizedName, isDeleted: { $ne: true } })
  if (existing) throw conflict(`A skill with the name "${name}" already exists`)

  const now  = new Date()
  const skill = {
    _id: randomUUID(),
    name:            name.trim(),
    normalizedName,
    category:        category.trim(),
    type,
    description,
    aliases:         normalizedAliases,
    tags:            tags.map(t => t.trim().toLowerCase()).filter(Boolean),
    demandLevel:     demandLevel || null,
    demandScore:     demandScore ?? null,
    relatedSkillIds,
    createdBy:       req.user.id,
    isDeleted:       false,
    createdAt:       now,
    updatedAt:       now,
  }

  await getDatabase().collection('skills').insertOne(skill)
  res.status(201).json({ skill: pub(skill) })
}))

// ─── 7. UPDATE SKILL ─────────────────────────────────────────────────────────
/**
 * PATCH /api/skills/:id
 * All fields optional — only provided fields are updated.
 * aliases and relatedSkillIds replace the existing arrays entirely.
 * To add/remove individual aliases, use the /aliases sub-routes.
 */
router.patch('/:id', requireRole(...WRITE_ROLES), asyncHandler(async (req, res) => {
  await findActive(req.params.id)  // 404 guard

  const allowed = ['name', 'category', 'type', 'description', 'tags', 'demandLevel', 'demandScore', 'relatedSkillIds']
  const update  = {}

  for (const field of allowed) {
    if (!Object.prototype.hasOwnProperty.call(req.body, field)) continue
    update[field] = req.body[field]
  }

  if (Object.keys(update).length === 0) throw badRequest('No valid fields provided')

  // Validate provided fields
  if (update.name !== undefined) {
    if (!update.name?.trim()) throw badRequest('name cannot be empty')
    update.normalizedName = normalize(update.name)
    update.name           = update.name.trim()

    const clash = await getDatabase().collection('skills').findOne({
      normalizedName: update.normalizedName,
      _id:            { $ne: req.params.id },
      isDeleted:      { $ne: true },
    })
    if (clash) throw conflict(`A skill named "${update.name}" already exists`)
  }

  if (update.category !== undefined) {
    if (!update.category?.trim()) throw badRequest('category cannot be empty')
    update.category = update.category.trim()
  }

  if (update.type !== undefined && !VALID_TYPES.includes(update.type))
    throw badRequest(`type must be one of: ${VALID_TYPES.join(', ')}`)

  if (update.demandLevel !== undefined && update.demandLevel !== null && !VALID_LEVELS.includes(update.demandLevel))
    throw badRequest(`demandLevel must be one of: ${VALID_LEVELS.join(', ')}`)

  if (update.demandScore !== undefined && update.demandScore !== null) {
    if (typeof update.demandScore !== 'number' || update.demandScore < 0 || update.demandScore > 100)
      throw badRequest('demandScore must be a number between 0 and 100')
  }

  if (update.tags !== undefined) {
    if (!Array.isArray(update.tags)) throw badRequest('tags must be an array')
    update.tags = update.tags.map(t => t.trim().toLowerCase()).filter(Boolean)
  }

  if (update.relatedSkillIds !== undefined) {
    if (!Array.isArray(update.relatedSkillIds)) throw badRequest('relatedSkillIds must be an array')
    if (update.relatedSkillIds.length) {
      const found = await getDatabase().collection('skills')
        .countDocuments({ _id: { $in: update.relatedSkillIds }, isDeleted: { $ne: true } })
      if (found !== update.relatedSkillIds.length)
        throw badRequest('One or more relatedSkillIds do not exist')
    }
    // Prevent self-reference
    if (update.relatedSkillIds.includes(req.params.id))
      throw badRequest('A skill cannot be related to itself')
  }

  update.updatedAt = new Date()

  const result = await getDatabase().collection('skills').findOneAndUpdate(
    { _id: req.params.id, isDeleted: { $ne: true } },
    { $set: update },
    { returnDocument: 'after' },
  )

  res.json({ skill: pub(result) })
}))

// ─── 8. DELETE SKILL (soft) ───────────────────────────────────────────────────
/**
 * DELETE /api/skills/:id
 * Soft-deletes by setting isDeleted: true.
 * Only government role can delete — industry can only create/update.
 * Also removes the skill from all other skills' relatedSkillIds.
 */
router.delete('/:id', requireRole('government'), asyncHandler(async (req, res) => {
  await findActive(req.params.id)  // 404 guard

  const now = new Date()
  await getDatabase().collection('skills').updateOne(
    { _id: req.params.id },
    { $set: { isDeleted: true, deletedAt: now, deletedBy: req.user.id, updatedAt: now } },
  )

  // Remove this skill from all other skills' relatedSkillIds
  await getDatabase().collection('skills').updateMany(
    { relatedSkillIds: req.params.id },
    { $pull: { relatedSkillIds: req.params.id } },
  )

  res.json({ message: 'Skill deleted successfully', id: req.params.id })
}))

// ─── 9. ADD ALIASES ──────────────────────────────────────────────────────────
/**
 * POST /api/skills/:id/aliases
 * Body: { aliases: string[] }
 * Appends new aliases; duplicates (across the entire skills collection) are rejected.
 */
router.post('/:id/aliases', requireRole(...WRITE_ROLES), asyncHandler(async (req, res) => {
  const skill = await findActive(req.params.id)

  const { aliases } = req.body
  if (!Array.isArray(aliases) || aliases.length === 0)
    throw badRequest('aliases must be a non-empty array of strings')

  const normalized = aliases.map(normalize).filter(Boolean)
  if (normalized.length === 0) throw badRequest('No valid alias strings provided')

  // Check none of the new aliases clash with any skill's normalizedName or existing aliases
  const clash = await getDatabase().collection('skills').findOne({
    isDeleted: { $ne: true },
    $or: [
      { normalizedName: { $in: normalized } },
      { aliases:        { $in: normalized } },
    ],
  })
  if (clash) throw conflict('One or more aliases conflict with an existing skill name or alias')

  // Merge — avoid duplicates already on this skill
  const existing = new Set(skill.aliases || [])
  const toAdd    = normalized.filter(a => !existing.has(a))
  if (toAdd.length === 0) throw conflict('All provided aliases already exist on this skill')

  const result = await getDatabase().collection('skills').findOneAndUpdate(
    { _id: req.params.id },
    { $addToSet: { aliases: { $each: toAdd } }, $set: { updatedAt: new Date() } },
    { returnDocument: 'after' },
  )

  res.json({ skill: pub(result) })
}))

// ─── 10. REMOVE ALIAS ────────────────────────────────────────────────────────
/**
 * DELETE /api/skills/:id/aliases
 * Body: { alias: string }
 * Removes a single alias from the skill.
 */
router.delete('/:id/aliases', requireRole(...WRITE_ROLES), asyncHandler(async (req, res) => {
  await findActive(req.params.id)

  const { alias } = req.body
  if (!alias?.trim()) throw badRequest('alias is required')

  const normalizedAlias = normalize(alias)

  const result = await getDatabase().collection('skills').findOneAndUpdate(
    { _id: req.params.id, aliases: normalizedAlias },
    { $pull: { aliases: normalizedAlias }, $set: { updatedAt: new Date() } },
    { returnDocument: 'after' },
  )

  if (!result) throw notFound('Alias not found on this skill')

  res.json({ skill: pub(result) })
}))

// ─── 11. ADD RELATED SKILLS ──────────────────────────────────────────────────
/**
 * POST /api/skills/:id/related
 * Body: { relatedSkillIds: string[] }
 * Links one or more skills as related. Relationship is bidirectional —
 * the target skills also get the source skill added to their relatedSkillIds.
 */
router.post('/:id/related', requireRole(...WRITE_ROLES), asyncHandler(async (req, res) => {
  const skill = await findActive(req.params.id)

  const { relatedSkillIds } = req.body
  if (!Array.isArray(relatedSkillIds) || relatedSkillIds.length === 0)
    throw badRequest('relatedSkillIds must be a non-empty array')

  // Prevent self-link
  if (relatedSkillIds.includes(req.params.id))
    throw badRequest('A skill cannot be related to itself')

  // Verify all referenced skills exist
  const found = await getDatabase().collection('skills')
    .countDocuments({ _id: { $in: relatedSkillIds }, isDeleted: { $ne: true } })
  if (found !== relatedSkillIds.length)
    throw badRequest('One or more relatedSkillIds do not exist')

  // Filter out IDs already linked
  const existingSet = new Set(skill.relatedSkillIds || [])
  const toAdd       = relatedSkillIds.filter(id => !existingSet.has(id))
  if (toAdd.length === 0) throw conflict('All provided skills are already related')

  const now = new Date()

  // Update source skill
  const result = await getDatabase().collection('skills').findOneAndUpdate(
    { _id: req.params.id },
    { $addToSet: { relatedSkillIds: { $each: toAdd } }, $set: { updatedAt: now } },
    { returnDocument: 'after' },
  )

  // Bidirectional: update each target skill to also point back
  await getDatabase().collection('skills').updateMany(
    { _id: { $in: toAdd } },
    { $addToSet: { relatedSkillIds: req.params.id }, $set: { updatedAt: now } },
  )

  res.json({ skill: pub(result) })
}))

// ─── 12. REMOVE RELATED SKILL ────────────────────────────────────────────────
/**
 * DELETE /api/skills/:id/related/:relatedId
 * Unlinks one related skill. Also removes the back-link bidirectionally.
 */
router.delete('/:id/related/:relatedId', requireRole(...WRITE_ROLES), asyncHandler(async (req, res) => {
  const { id, relatedId } = req.params
  await findActive(id)

  if (id === relatedId) throw badRequest('A skill cannot be related to itself')

  const now = new Date()

  const result = await getDatabase().collection('skills').findOneAndUpdate(
    { _id: id, relatedSkillIds: relatedId },
    { $pull: { relatedSkillIds: relatedId }, $set: { updatedAt: now } },
    { returnDocument: 'after' },
  )

  if (!result) throw notFound('Related skill link not found')

  // Remove back-link
  await getDatabase().collection('skills').updateOne(
    { _id: relatedId },
    { $pull: { relatedSkillIds: id }, $set: { updatedAt: now } },
  )

  res.json({ skill: pub(result) })
}))

export default router
