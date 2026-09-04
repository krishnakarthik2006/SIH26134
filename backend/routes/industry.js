/**
 * Phase B5 — Industry APIs
 *
 * Routes mounted at /api/industries
 *
 * Public (no auth):
 *   GET  /api/industries                — list all (paginated, filterable)
 *   GET  /api/industries/search         — text search on name/sector
 *   GET  /api/industries/:id            — get one industry
 *
 * Protected:
 *   POST   /api/industries              — create          (industry | government)
 *   PATCH  /api/industries/:id          — update          (owner industry user | government)
 *   DELETE /api/industries/:id          — soft-delete     (government only)
 *   GET    /api/industries/:id/jobs     — list job roles for this industry (public)
 */

import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { getDatabase } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

const router = Router()

// ─── constants ───────────────────────────────────────────────────────────────
const VALID_SIZES   = ['1-50', '51-200', '201-500', '501-1000', '1000+']
const VALID_SECTORS = [
  'Technology', 'Manufacturing', 'Healthcare', 'Finance', 'Education',
  'Agriculture', 'Retail', 'Construction', 'Logistics', 'Media',
  'Government', 'Energy', 'Hospitality', 'Automobile', 'Other',
]

// ─── helpers ─────────────────────────────────────────────────────────────────
function bad(msg)       { const e = new Error(msg); e.statusCode = 400; return e }
function notFound(msg = 'Industry not found') { const e = new Error(msg); e.statusCode = 404; return e }
function forbidden(msg) { const e = new Error(msg); e.statusCode = 403; return e }
function conflict(msg)  { const e = new Error(msg); e.statusCode = 409; return e }

function pub(doc) {
  if (!doc) return null
  const { _id, ...rest } = doc
  return { id: _id, ...rest }
}

async function findActiveIndustry(id) {
  const doc = await getDatabase().collection('industries').findOne({ _id: id, isDeleted: { $ne: true } })
  if (!doc) throw notFound()
  return doc
}

/** Owner or government can mutate */
function assertCanWrite(doc, user) {
  if (user.role === 'government') return
  if (doc.createdBy !== user.id)  throw forbidden('You can only manage your own industry record')
}

// ─── PUBLIC READS ─────────────────────────────────────────────────────────────

/**
 * GET /api/industries
 * Query: sector, size, region, page, limit, sort (name|createdAt|employeeCount), order
 */
router.get('/', asyncHandler(async (req, res) => {
  const { sector, size, region, page = '1', limit = '20', sort = 'name', order = 'asc' } = req.query

  const pageNum  = Math.max(1, parseInt(page, 10)  || 1)
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20))
  const skip     = (pageNum - 1) * limitNum

  const filter = { isDeleted: { $ne: true } }
  if (sector) filter.sector            = { $regex: new RegExp(`^${sector}$`, 'i') }
  if (size)   filter.companySize       = size
  if (region) filter.operatingRegions  = region

  const sortField = ['name', 'createdAt', 'employeeCount'].includes(sort) ? sort : 'name'
  const sortDir   = order === 'desc' ? -1 : 1

  const col   = getDatabase().collection('industries')
  const total = await col.countDocuments(filter)
  const docs  = await col.find(filter).sort({ [sortField]: sortDir }).skip(skip).limit(limitNum).toArray()

  res.json({ industries: docs.map(pub), pagination: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) } })
}))

/**
 * GET /api/industries/search?q=
 * Regex search on name, sector, description.
 */
router.get('/search', asyncHandler(async (req, res) => {
  const { q, sector, limit = '20' } = req.query
  if (!q?.trim()) throw bad('q is required')

  const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 20))
  const regex    = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  const filter   = {
    isDeleted: { $ne: true },
    $or: [{ name: regex }, { sector: regex }, { description: regex }],
  }
  if (sector) filter.sector = { $regex: new RegExp(`^${sector}$`, 'i') }

  const docs = await getDatabase().collection('industries').find(filter).sort({ name: 1 }).limit(limitNum).toArray()
  res.json({ industries: docs.map(pub), count: docs.length, query: q })
}))

/**
 * GET /api/industries/:id
 */
router.get('/:id', asyncHandler(async (req, res) => {
  const doc = await findActiveIndustry(req.params.id)
  res.json({ industry: pub(doc) })
}))

/**
 * GET /api/industries/:id/jobs
 * Lists active job roles belonging to this industry.
 */
router.get('/:id/jobs', asyncHandler(async (req, res) => {
  await findActiveIndustry(req.params.id)   // 404 guard

  const { status, page = '1', limit = '20' } = req.query
  const pageNum  = Math.max(1, parseInt(page, 10)  || 1)
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20))
  const skip     = (pageNum - 1) * limitNum

  const filter = { industryId: req.params.id, isDeleted: { $ne: true } }
  if (status) filter.status = status

  const col   = getDatabase().collection('job_roles')
  const total = await col.countDocuments(filter)
  const docs  = await col.find(filter).sort({ title: 1 }).skip(skip).limit(limitNum).toArray()

  res.json({ jobRoles: docs.map(pub), pagination: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) } })
}))

// ─── WRITE ROUTES — auth required ─────────────────────────────────────────────
router.use(requireAuth)

/**
 * POST /api/industries
 * Body: name*, sector*, description, companySize, headquarters,
 *       operatingRegions[], website, contactEmail, employeeCount
 */
router.post('/', requireRole('industry', 'government'), asyncHandler(async (req, res) => {
  const {
    name, sector, description = '', companySize,
    headquarters = '', operatingRegions = [], website = '',
    contactEmail = '', employeeCount,
  } = req.body

  if (!name?.trim())   throw bad('name is required')
  if (!sector?.trim()) throw bad('sector is required')
  if (!VALID_SECTORS.includes(sector)) throw bad(`sector must be one of: ${VALID_SECTORS.join(', ')}`)
  if (companySize && !VALID_SIZES.includes(companySize)) throw bad(`companySize must be one of: ${VALID_SIZES.join(', ')}`)
  if (!Array.isArray(operatingRegions)) throw bad('operatingRegions must be an array')
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) throw bad('contactEmail must be valid')
  if (employeeCount !== undefined && (typeof employeeCount !== 'number' || employeeCount < 0))
    throw bad('employeeCount must be a non-negative number')

  // Unique name guard
  const existing = await getDatabase().collection('industries').findOne({ name: name.trim(), isDeleted: { $ne: true } })
  if (existing) throw conflict(`An industry named "${name.trim()}" already exists`)

  const now = new Date()
  const doc = {
    _id: randomUUID(),
    name: name.trim(),
    sector,
    description,
    companySize:       companySize || null,
    headquarters,
    operatingRegions,
    website,
    contactEmail,
    employeeCount:     employeeCount ?? null,
    isDeleted:         false,
    createdBy:         req.user.id,
    createdAt:         now,
    updatedAt:         now,
  }

  await getDatabase().collection('industries').insertOne(doc)
  res.status(201).json({ industry: pub(doc) })
}))

/**
 * PATCH /api/industries/:id
 * Partial update. Owner or government only.
 */
router.patch('/:id', requireRole('industry', 'government'), asyncHandler(async (req, res) => {
  const existing = await findActiveIndustry(req.params.id)
  assertCanWrite(existing, req.user)

  const allowed = ['name', 'sector', 'description', 'companySize', 'headquarters',
                   'operatingRegions', 'website', 'contactEmail', 'employeeCount']
  const update  = {}
  for (const f of allowed) {
    if (Object.prototype.hasOwnProperty.call(req.body, f)) update[f] = req.body[f]
  }
  if (Object.keys(update).length === 0) throw bad('No valid fields provided')

  // Validate changed fields
  if (update.name !== undefined) {
    if (!update.name?.trim()) throw bad('name cannot be empty')
    update.name = update.name.trim()
    const clash = await getDatabase().collection('industries').findOne({
      name: update.name, _id: { $ne: req.params.id }, isDeleted: { $ne: true },
    })
    if (clash) throw conflict(`An industry named "${update.name}" already exists`)
  }
  if (update.sector && !VALID_SECTORS.includes(update.sector)) throw bad(`sector must be one of: ${VALID_SECTORS.join(', ')}`)
  if (update.companySize && !VALID_SIZES.includes(update.companySize)) throw bad(`companySize must be one of: ${VALID_SIZES.join(', ')}`)
  if (update.operatingRegions !== undefined && !Array.isArray(update.operatingRegions)) throw bad('operatingRegions must be an array')
  if (update.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(update.contactEmail)) throw bad('contactEmail must be valid')
  if (update.employeeCount !== undefined && update.employeeCount !== null &&
      (typeof update.employeeCount !== 'number' || update.employeeCount < 0))
    throw bad('employeeCount must be a non-negative number')

  update.updatedAt = new Date()
  const result = await getDatabase().collection('industries').findOneAndUpdate(
    { _id: req.params.id, isDeleted: { $ne: true } },
    { $set: update },
    { returnDocument: 'after' },
  )
  res.json({ industry: pub(result) })
}))

/**
 * DELETE /api/industries/:id
 * Soft-delete. Also soft-deletes all job roles and job descriptions under it.
 * Government only.
 */
router.delete('/:id', requireRole('government'), asyncHandler(async (req, res) => {
  await findActiveIndustry(req.params.id)

  const now = new Date()
  await getDatabase().collection('industries').updateOne(
    { _id: req.params.id },
    { $set: { isDeleted: true, deletedAt: now, deletedBy: req.user.id, updatedAt: now } },
  )

  // Cascade: soft-delete all job roles
  const roleIds = (await getDatabase().collection('job_roles')
    .find({ industryId: req.params.id }, { projection: { _id: 1 } }).toArray()).map(r => r._id)

  if (roleIds.length) {
    await getDatabase().collection('job_roles').updateMany(
      { industryId: req.params.id },
      { $set: { isDeleted: true, deletedAt: now, updatedAt: now } },
    )
    // Cascade: soft-delete all job descriptions under those roles
    await getDatabase().collection('job_descriptions').updateMany(
      { jobRoleId: { $in: roleIds } },
      { $set: { isDeleted: true, deletedAt: now, updatedAt: now } },
    )
  }

  res.json({ message: 'Industry and all associated job data deleted', id: req.params.id })
}))

export default router
