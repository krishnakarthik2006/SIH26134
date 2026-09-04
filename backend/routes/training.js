/**
 * Phase B6 — Training Provider & Curriculum APIs
 * Mounted at /api/training
 *
 * All public GET routes are declared FIRST (before router.use(requireAuth)).
 * Protected write routes come after the single router.use(requireAuth) call.
 */

import { randomUUID } from 'node:crypto'
import { Router }     from 'express'
import { getDatabase }            from '../db.js'
import { asyncHandler }           from '../middleware/errorHandler.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

const router = Router()

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const PROVIDER_TYPES   = ['University','College','Institute','Polytechnic',
                          'Online','Corporate','NGO','Government','Other']
const PROGRAM_STATUSES = ['active','inactive','draft','archived']
const PROGRAM_MODES    = ['online','offline','hybrid']
const CURRIC_STATUSES  = ['draft','published','archived']
const WRITE_ROLES      = ['training','government']

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const bad      = (m) => Object.assign(new Error(m), { statusCode: 400 })
const notFound = (m = 'Not found') => Object.assign(new Error(m), { statusCode: 404 })
const conflict = (m) => Object.assign(new Error(m), { statusCode: 409 })
const forbidden= (m) => Object.assign(new Error(m), { statusCode: 403 })

const pub = (doc) => { if (!doc) return null; const { _id, ...rest } = doc; return { id: _id, ...rest } }

function paginate(q) {
  const page  = Math.max(1, parseInt(q.page  || '1',  10) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(q.limit || '20', 10) || 20))
  return { page, limit, skip: (page - 1) * limit }
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

async function getProvider(id) {
  const d = await getDatabase().collection('training_providers').findOne({ _id: id, isDeleted: { $ne: true } })
  if (!d) throw notFound('Training provider not found')
  return d
}
async function getProgram(id) {
  const d = await getDatabase().collection('training_programs').findOne({ _id: id, isDeleted: { $ne: true } })
  if (!d) throw notFound('Training program not found')
  return d
}
async function getCurriculum(id) {
  const d = await getDatabase().collection('curriculums').findOne({ _id: id, isDeleted: { $ne: true } })
  if (!d) throw notFound('Curriculum not found')
  return d
}

function ownerOrGovt(doc, user) {
  if (user.role === 'government') return
  if (doc.createdBy !== user.id) throw forbidden('You can only manage your own records')
}

function validateModules(modules) {
  if (!Array.isArray(modules)) throw bad('modules must be an array')
  return modules.map((m, i) => {
    if (!m.title?.trim()) throw bad(`modules[${i}].title is required`)
    if (m.durationHours !== undefined && m.durationHours !== null &&
        (typeof m.durationHours !== 'number' || m.durationHours < 0))
      throw bad(`modules[${i}].durationHours must be a non-negative number`)
    if (m.order !== undefined && m.order !== null &&
        (typeof m.order !== 'number' || m.order < 0))
      throw bad(`modules[${i}].order must be a non-negative number`)
    if (m.topics !== undefined && !Array.isArray(m.topics))
      throw bad(`modules[${i}].topics must be an array`)
    return {
      moduleId:      m.moduleId      || randomUUID(),
      title:         m.title.trim(),
      description:   m.description   || '',
      durationHours: m.durationHours ?? null,
      order:         m.order         ?? i,
      topics:        (m.topics || []).map(t => String(t).trim()).filter(Boolean),
    }
  })
}

async function validateSkillsCovered(skills) {
  if (!Array.isArray(skills)) throw bad('skillsCovered must be an array')
  const COVERAGES   = ['core', 'supplementary', 'elective']
  const PROF_LEVELS = ['beginner', 'intermediate', 'advanced', 'expert']
  const validated   = []
  for (const [i, s] of skills.entries()) {
    if (!s.skillName?.trim()) throw bad(`skillsCovered[${i}].skillName is required`)
    if (s.coverage       && !COVERAGES.includes(s.coverage))
      throw bad(`skillsCovered[${i}].coverage must be one of: ${COVERAGES.join(', ')}`)
    if (s.proficiencyLevel && !PROF_LEVELS.includes(s.proficiencyLevel))
      throw bad(`skillsCovered[${i}].proficiencyLevel must be one of: ${PROF_LEVELS.join(', ')}`)
    if (s.skillId) {
      const canonical = await getDatabase().collection('skills')
        .findOne({ _id: s.skillId, isDeleted: { $ne: true } })
      if (!canonical) throw bad(`skillsCovered[${i}].skillId "${s.skillId}" not found in skill knowledge base`)
    }
    validated.push({
      skillId:          s.skillId          || null,
      skillName:        s.skillName.trim(),
      coverage:         s.coverage         || 'core',
      proficiencyLevel: s.proficiencyLevel || null,
    })
  }
  return validated
}

function mergeModules(existing, incoming) {
  const map = new Map()
  for (const m of existing) map.set(m.title.toLowerCase(), m)
  for (const m of incoming) map.set(m.title.toLowerCase(), m)
  return Array.from(map.values())
}

function mergeSkillsCovered(existing, incoming) {
  const map = new Map()
  for (const s of existing) map.set(s.skillId || s.skillName.toLowerCase(), s)
  for (const s of incoming) map.set(s.skillId || s.skillName.toLowerCase(), s)
  return Array.from(map.values())
}

// ═════════════════════════════════════════════════════════════════════════════
// PUBLIC GET ROUTES (before requireAuth)
// ═════════════════════════════════════════════════════════════════════════════

// ── Provider public ───────────────────────────────────────────────────────────
router.get('/providers/search', asyncHandler(async (req, res) => {
  const { q, type, limit: lim = '20' } = req.query
  if (!q?.trim()) throw bad('q is required')
  const limitNum = Math.min(50, Math.max(1, parseInt(lim, 10) || 20))
  const regex    = new RegExp(esc(q.trim()), 'i')
  const filter   = {
    isDeleted: { $ne: true },
    $or: [{ name: regex }, { type: regex }, { district: regex }, { description: regex }, { focusAreas: regex }],
  }
  if (type) filter.type = type
  const docs = await getDatabase().collection('training_providers').find(filter).sort({ name: 1 }).limit(limitNum).toArray()
  res.json({ providers: docs.map(pub), count: docs.length, query: q })
}))

router.get('/providers/:id/programs', asyncHandler(async (req, res) => {
  await getProvider(req.params.id)
  const { page, limit, skip } = paginate(req.query)
  const { status, mode } = req.query
  const filter = { providerId: req.params.id, isDeleted: { $ne: true } }
  if (status) filter.status = status
  if (mode)   filter.deliveryMode = mode
  const col = getDatabase().collection('training_programs')
  const total = await col.countDocuments(filter)
  const docs  = await col.find(filter).sort({ name: 1 }).skip(skip).limit(limit).toArray()
  res.json({ programs: docs.map(pub), pagination: { total, page, limit, pages: Math.ceil(total / limit) } })
}))

router.get('/providers/:id', asyncHandler(async (req, res) => {
  res.json({ provider: pub(await getProvider(req.params.id)) })
}))

router.get('/providers', asyncHandler(async (req, res) => {
  const { type, district, region, accreditation, sort = 'name', order = 'asc' } = req.query
  const { page, limit, skip } = paginate(req.query)
  const filter = { isDeleted: { $ne: true } }
  if (type)          filter.type          = type
  if (district)      filter.district      = { $regex: new RegExp(`^${esc(district)}$`, 'i') }
  if (region)        filter.region        = { $regex: new RegExp(`^${esc(region)}$`,   'i') }
  if (accreditation) filter.accreditation = { $regex: new RegExp(esc(accreditation),  'i') }
  const sortField = ['name','type','createdAt'].includes(sort) ? sort : 'name'
  const col   = getDatabase().collection('training_providers')
  const total = await col.countDocuments(filter)
  const docs  = await col.find(filter).sort({ [sortField]: order === 'desc' ? -1 : 1 }).skip(skip).limit(limit).toArray()
  res.json({ providers: docs.map(pub), pagination: { total, page, limit, pages: Math.ceil(total / limit) } })
}))

// ── Program public ────────────────────────────────────────────────────────────
router.get('/programs/search', asyncHandler(async (req, res) => {
  const { q, providerId, status, limit: lim = '20' } = req.query
  if (!q?.trim()) throw bad('q is required')
  const limitNum = Math.min(50, Math.max(1, parseInt(lim, 10) || 20))
  const regex    = new RegExp(esc(q.trim()), 'i')
  const filter   = {
    isDeleted: { $ne: true },
    $or: [{ name: regex }, { description: regex }, { targetRoles: regex }, { tags: regex }],
  }
  if (providerId) filter.providerId = providerId
  if (status)     filter.status     = status
  const docs = await getDatabase().collection('training_programs').find(filter).sort({ name: 1 }).limit(limitNum).toArray()
  res.json({ programs: docs.map(pub), count: docs.length, query: q })
}))

router.get('/programs/:id/curriculums', asyncHandler(async (req, res) => {
  await getProgram(req.params.id)
  const { page, limit, skip } = paginate(req.query)
  const { status } = req.query
  const filter = { trainingProgramId: req.params.id, isDeleted: { $ne: true } }
  if (status) filter.status = status
  const col = getDatabase().collection('curriculums')
  const total = await col.countDocuments(filter)
  const docs  = await col.find(filter).sort({ version: -1 }).skip(skip).limit(limit).toArray()
  res.json({ curriculums: docs.map(pub), pagination: { total, page, limit, pages: Math.ceil(total / limit) } })
}))

router.get('/programs/:id', asyncHandler(async (req, res) => {
  res.json({ program: pub(await getProgram(req.params.id)) })
}))

router.get('/programs', asyncHandler(async (req, res) => {
  const { providerId, status, mode, tag, sort = 'name', order = 'asc' } = req.query
  const { page, limit, skip } = paginate(req.query)
  const filter = { isDeleted: { $ne: true } }
  if (providerId) filter.providerId   = providerId
  if (status)     filter.status       = status
  if (mode)       filter.deliveryMode = mode
  if (tag)        filter.tags         = tag
  const sortField = ['name','createdAt','durationWeeks'].includes(sort) ? sort : 'name'
  const col   = getDatabase().collection('training_programs')
  const total = await col.countDocuments(filter)
  const docs  = await col.find(filter).sort({ [sortField]: order === 'desc' ? -1 : 1 }).skip(skip).limit(limit).toArray()
  res.json({ programs: docs.map(pub), pagination: { total, page, limit, pages: Math.ceil(total / limit) } })
}))

// ── Curriculum public ─────────────────────────────────────────────────────────
router.get('/curriculums/:id', asyncHandler(async (req, res) => {
  res.json({ curriculum: pub(await getCurriculum(req.params.id)) })
}))

// ═════════════════════════════════════════════════════════════════════════════
// AUTH GATE
// ═════════════════════════════════════════════════════════════════════════════
router.use(requireAuth)

// ═════════════════════════════════════════════════════════════════════════════
// PROTECTED WRITE ROUTES
// ═════════════════════════════════════════════════════════════════════════════

// ── Provider writes ───────────────────────────────────────────────────────────

router.post('/providers', requireRole(...WRITE_ROLES), asyncHandler(async (req, res) => {
  const {
    name, type, district = '', region = '', accreditation = '',
    affiliatedUniversity = '', website = '', contactEmail = '',
    contactPhone = '', description = '', focusAreas = [],
  } = req.body

  if (!name?.trim()) throw bad('name is required')
  if (!type)         throw bad('type is required')
  if (!PROVIDER_TYPES.includes(type)) throw bad(`type must be one of: ${PROVIDER_TYPES.join(', ')}`)
  if (!Array.isArray(focusAreas))     throw bad('focusAreas must be an array')
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) throw bad('contactEmail must be valid')

  const exists = await getDatabase().collection('training_providers').findOne({ name: name.trim(), isDeleted: { $ne: true } })
  if (exists) throw conflict(`A provider named "${name.trim()}" already exists`)

  const now = new Date()
  const doc = {
    _id: randomUUID(), name: name.trim(), type,
    district, region, accreditation, affiliatedUniversity,
    website, contactEmail, contactPhone, description,
    focusAreas: focusAreas.map(f => f.trim()).filter(Boolean),
    isDeleted: false, createdBy: req.user.id, createdAt: now, updatedAt: now,
  }
  await getDatabase().collection('training_providers').insertOne(doc)
  res.status(201).json({ provider: pub(doc) })
}))

router.patch('/providers/:id', requireRole(...WRITE_ROLES), asyncHandler(async (req, res) => {
  const existing = await getProvider(req.params.id)
  ownerOrGovt(existing, req.user)

  const allowed = ['name','type','district','region','accreditation',
    'affiliatedUniversity','website','contactEmail','contactPhone','description','focusAreas']
  const update = {}
  for (const f of allowed) {
    if (Object.prototype.hasOwnProperty.call(req.body, f)) update[f] = req.body[f]
  }
  if (Object.keys(update).length === 0) throw bad('No valid fields provided')

  if (update.name !== undefined) {
    if (!update.name?.trim()) throw bad('name cannot be empty')
    update.name = update.name.trim()
    const clash = await getDatabase().collection('training_providers').findOne({
      name: update.name, _id: { $ne: req.params.id }, isDeleted: { $ne: true },
    })
    if (clash) throw conflict(`A provider named "${update.name}" already exists`)
  }
  if (update.type && !PROVIDER_TYPES.includes(update.type)) throw bad(`type must be one of: ${PROVIDER_TYPES.join(', ')}`)
  if (update.focusAreas !== undefined && !Array.isArray(update.focusAreas)) throw bad('focusAreas must be an array')
  if (update.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(update.contactEmail)) throw bad('contactEmail must be valid')
  if (update.focusAreas) update.focusAreas = update.focusAreas.map(f => f.trim()).filter(Boolean)

  update.updatedAt = new Date()
  const result = await getDatabase().collection('training_providers').findOneAndUpdate(
    { _id: req.params.id, isDeleted: { $ne: true } }, { $set: update }, { returnDocument: 'after' },
  )
  res.json({ provider: pub(result) })
}))

router.delete('/providers/:id', requireRole('government'), asyncHandler(async (req, res) => {
  await getProvider(req.params.id)
  const now = new Date()
  const programIds = (await getDatabase().collection('training_programs')
    .find({ providerId: req.params.id }, { projection: { _id: 1 } }).toArray()).map(p => p._id)

  await getDatabase().collection('training_providers').updateOne(
    { _id: req.params.id },
    { $set: { isDeleted: true, deletedAt: now, deletedBy: req.user.id, updatedAt: now } },
  )
  if (programIds.length) {
    await getDatabase().collection('training_programs').updateMany(
      { _id: { $in: programIds } },
      { $set: { isDeleted: true, deletedAt: now, updatedAt: now } },
    )
    await getDatabase().collection('curriculums').updateMany(
      { trainingProgramId: { $in: programIds } },
      { $set: { isDeleted: true, deletedAt: now, updatedAt: now } },
    )
  }
  res.json({ message: 'Provider and all associated programs and curriculums deleted', id: req.params.id })
}))

// ── Program writes ────────────────────────────────────────────────────────────

router.post('/programs', requireRole(...WRITE_ROLES), asyncHandler(async (req, res) => {
  const {
    providerId, name, description = '',
    status = 'draft', deliveryMode, durationWeeks,
    fees, targetRoles = [], tags = [],
    certificationOffered = false, language = 'English',
  } = req.body

  if (!providerId?.trim()) throw bad('providerId is required')
  if (!name?.trim())       throw bad('name is required')
  if (!PROGRAM_STATUSES.includes(status)) throw bad(`status must be one of: ${PROGRAM_STATUSES.join(', ')}`)
  if (deliveryMode && !PROGRAM_MODES.includes(deliveryMode))
    throw bad(`deliveryMode must be one of: ${PROGRAM_MODES.join(', ')}`)
  if (durationWeeks !== undefined && (typeof durationWeeks !== 'number' || durationWeeks < 0))
    throw bad('durationWeeks must be a non-negative number')
  if (fees !== undefined && (typeof fees !== 'number' || fees < 0))
    throw bad('fees must be a non-negative number')
  if (!Array.isArray(targetRoles))        throw bad('targetRoles must be an array')
  if (!Array.isArray(tags))               throw bad('tags must be an array')
  if (typeof certificationOffered !== 'boolean') throw bad('certificationOffered must be a boolean')

  await getProvider(providerId)  // 404 guard

  const now = new Date()
  const doc = {
    _id: randomUUID(), providerId, name: name.trim(), description,
    status, deliveryMode: deliveryMode || null,
    durationWeeks: durationWeeks ?? null, fees: fees ?? null,
    targetRoles: targetRoles.map(r => r.trim()).filter(Boolean),
    tags: tags.map(t => t.trim().toLowerCase()).filter(Boolean),
    certificationOffered, language,
    isDeleted: false, createdBy: req.user.id, createdAt: now, updatedAt: now,
  }
  await getDatabase().collection('training_programs').insertOne(doc)
  res.status(201).json({ program: pub(doc) })
}))

router.patch('/programs/:id', requireRole(...WRITE_ROLES), asyncHandler(async (req, res) => {
  const existing = await getProgram(req.params.id)
  ownerOrGovt(existing, req.user)

  const allowed = ['name','description','status','deliveryMode','durationWeeks',
    'fees','targetRoles','tags','certificationOffered','language']
  const update = {}
  for (const f of allowed) {
    if (Object.prototype.hasOwnProperty.call(req.body, f)) update[f] = req.body[f]
  }
  if (Object.keys(update).length === 0) throw bad('No valid fields provided')

  if (update.name !== undefined && !update.name?.trim()) throw bad('name cannot be empty')
  if (update.name) update.name = update.name.trim()
  if (update.status && !PROGRAM_STATUSES.includes(update.status))
    throw bad(`status must be one of: ${PROGRAM_STATUSES.join(', ')}`)
  if (update.deliveryMode && !PROGRAM_MODES.includes(update.deliveryMode))
    throw bad(`deliveryMode must be one of: ${PROGRAM_MODES.join(', ')}`)
  if (update.durationWeeks !== undefined && update.durationWeeks !== null &&
      (typeof update.durationWeeks !== 'number' || update.durationWeeks < 0))
    throw bad('durationWeeks must be a non-negative number')
  if (update.fees !== undefined && update.fees !== null &&
      (typeof update.fees !== 'number' || update.fees < 0))
    throw bad('fees must be a non-negative number')
  if (update.targetRoles !== undefined && !Array.isArray(update.targetRoles)) throw bad('targetRoles must be an array')
  if (update.tags !== undefined && !Array.isArray(update.tags)) throw bad('tags must be an array')
  if (update.certificationOffered !== undefined && typeof update.certificationOffered !== 'boolean')
    throw bad('certificationOffered must be a boolean')
  if (update.tags) update.tags = update.tags.map(t => t.trim().toLowerCase()).filter(Boolean)
  if (update.targetRoles) update.targetRoles = update.targetRoles.map(r => r.trim()).filter(Boolean)

  update.updatedAt = new Date()
  const result = await getDatabase().collection('training_programs').findOneAndUpdate(
    { _id: req.params.id, isDeleted: { $ne: true } }, { $set: update }, { returnDocument: 'after' },
  )
  res.json({ program: pub(result) })
}))

router.delete('/programs/:id', requireRole(...WRITE_ROLES), asyncHandler(async (req, res) => {
  const existing = await getProgram(req.params.id)
  ownerOrGovt(existing, req.user)
  const now = new Date()
  await getDatabase().collection('training_programs').updateOne(
    { _id: req.params.id },
    { $set: { isDeleted: true, deletedAt: now, deletedBy: req.user.id, updatedAt: now } },
  )
  await getDatabase().collection('curriculums').updateMany(
    { trainingProgramId: req.params.id },
    { $set: { isDeleted: true, deletedAt: now, updatedAt: now } },
  )
  res.json({ message: 'Program and all associated curriculums deleted', id: req.params.id })
}))

// ── Curriculum writes ─────────────────────────────────────────────────────────

router.post('/curriculums', requireRole(...WRITE_ROLES), asyncHandler(async (req, res) => {
  const {
    trainingProgramId, title, version = '1.0',
    status = 'draft', description = '', content = '',
    learningObjectives = [], totalHours,
    modules = [], skillsCovered = [],
  } = req.body

  if (!trainingProgramId?.trim()) throw bad('trainingProgramId is required')
  if (!title?.trim())             throw bad('title is required')
  if (!CURRIC_STATUSES.includes(status)) throw bad(`status must be one of: ${CURRIC_STATUSES.join(', ')}`)
  if (!Array.isArray(learningObjectives)) throw bad('learningObjectives must be an array')
  if (totalHours !== undefined && (typeof totalHours !== 'number' || totalHours < 0))
    throw bad('totalHours must be a non-negative number')
  if (!Array.isArray(modules))       throw bad('modules must be an array')
  if (!Array.isArray(skillsCovered)) throw bad('skillsCovered must be an array')

  await getProgram(trainingProgramId)  // 404 guard

  const validatedModules = validateModules(modules)
  const validatedSkills  = await validateSkillsCovered(skillsCovered)

  const now = new Date()
  const doc = {
    _id: randomUUID(), trainingProgramId,
    title: title.trim(), version, status,
    description, content,
    learningObjectives: learningObjectives.map(o => o.trim()).filter(Boolean),
    totalHours:    totalHours ?? null,
    modules:       validatedModules,
    skillsCovered: validatedSkills,
    wordCount:     content ? content.trim().split(/\s+/).filter(Boolean).length : 0,
    isDeleted: false, createdBy: req.user.id, createdAt: now, updatedAt: now,
  }
  await getDatabase().collection('curriculums').insertOne(doc)
  res.status(201).json({ curriculum: pub(doc) })
}))

router.patch('/curriculums/:id', requireRole(...WRITE_ROLES), asyncHandler(async (req, res) => {
  const existing = await getCurriculum(req.params.id)
  ownerOrGovt(existing, req.user)

  const allowed = ['title','version','status','description','content','learningObjectives','totalHours']
  const update  = {}
  for (const f of allowed) {
    if (Object.prototype.hasOwnProperty.call(req.body, f)) update[f] = req.body[f]
  }
  if (Object.keys(update).length === 0) throw bad('No valid fields provided')

  if (update.title !== undefined && !update.title?.trim()) throw bad('title cannot be empty')
  if (update.title) update.title = update.title.trim()
  if (update.status && !CURRIC_STATUSES.includes(update.status))
    throw bad(`status must be one of: ${CURRIC_STATUSES.join(', ')}`)
  if (update.totalHours !== undefined && update.totalHours !== null &&
      (typeof update.totalHours !== 'number' || update.totalHours < 0))
    throw bad('totalHours must be a non-negative number')
  if (update.learningObjectives !== undefined && !Array.isArray(update.learningObjectives))
    throw bad('learningObjectives must be an array')
  if (update.learningObjectives)
    update.learningObjectives = update.learningObjectives.map(o => o.trim()).filter(Boolean)
  if (update.content !== undefined)
    update.wordCount = update.content.trim().split(/\s+/).filter(Boolean).length

  update.updatedAt = new Date()
  const result = await getDatabase().collection('curriculums').findOneAndUpdate(
    { _id: req.params.id, isDeleted: { $ne: true } }, { $set: update }, { returnDocument: 'after' },
  )
  res.json({ curriculum: pub(result) })
}))

router.delete('/curriculums/:id', requireRole(...WRITE_ROLES), asyncHandler(async (req, res) => {
  const existing = await getCurriculum(req.params.id)
  ownerOrGovt(existing, req.user)
  const now = new Date()
  await getDatabase().collection('curriculums').updateOne(
    { _id: req.params.id },
    { $set: { isDeleted: true, deletedAt: now, deletedBy: req.user.id, updatedAt: now } },
  )
  res.json({ message: 'Curriculum deleted', id: req.params.id })
}))

// ── Curriculum modules ────────────────────────────────────────────────────────

/**
 * POST /api/training/curriculums/:id/modules
 * Body: { modules: [{ title*, description, durationHours, order, topics[] }] }
 * Upserts by title (existing module with same title is replaced).
 */
router.post('/curriculums/:id/modules', requireRole(...WRITE_ROLES), asyncHandler(async (req, res) => {
  const existing = await getCurriculum(req.params.id)
  ownerOrGovt(existing, req.user)

  const { modules } = req.body
  if (!Array.isArray(modules) || modules.length === 0) throw bad('modules must be a non-empty array')

  const validated = validateModules(modules)
  const merged    = mergeModules(existing.modules || [], validated)

  const result = await getDatabase().collection('curriculums').findOneAndUpdate(
    { _id: req.params.id, isDeleted: { $ne: true } },
    { $set: { modules: merged, updatedAt: new Date() } },
    { returnDocument: 'after' },
  )
  res.json({ curriculum: pub(result) })
}))

/**
 * PATCH /api/training/curriculums/:id/modules/:moduleId
 * Update a single module by its UUID.
 */
router.patch('/curriculums/:id/modules/:moduleId', requireRole(...WRITE_ROLES), asyncHandler(async (req, res) => {
  const existing = await getCurriculum(req.params.id)
  ownerOrGovt(existing, req.user)

  const modules = (existing.modules || []).map(m => ({ ...m }))
  const idx = modules.findIndex(m => m.moduleId === req.params.moduleId)
  if (idx === -1) throw notFound('Module not found in this curriculum')

  const allowed = ['title','description','durationHours','order','topics']
  for (const f of allowed) {
    if (Object.prototype.hasOwnProperty.call(req.body, f)) modules[idx][f] = req.body[f]
  }
  if (modules[idx].title !== undefined && !modules[idx].title?.trim()) throw bad('title cannot be empty')
  if (modules[idx].topics !== undefined && !Array.isArray(modules[idx].topics)) throw bad('topics must be an array')
  if (modules[idx].durationHours !== undefined && modules[idx].durationHours !== null &&
      (typeof modules[idx].durationHours !== 'number' || modules[idx].durationHours < 0))
    throw bad('durationHours must be a non-negative number')

  const result = await getDatabase().collection('curriculums').findOneAndUpdate(
    { _id: req.params.id, isDeleted: { $ne: true } },
    { $set: { modules, updatedAt: new Date() } },
    { returnDocument: 'after' },
  )
  res.json({ curriculum: pub(result) })
}))

/**
 * DELETE /api/training/curriculums/:id/modules/:moduleId
 */
router.delete('/curriculums/:id/modules/:moduleId', requireRole(...WRITE_ROLES), asyncHandler(async (req, res) => {
  const existing = await getCurriculum(req.params.id)
  ownerOrGovt(existing, req.user)

  const before  = (existing.modules || [])
  const modules = before.filter(m => m.moduleId !== req.params.moduleId)
  if (modules.length === before.length) throw notFound('Module not found in this curriculum')

  const result = await getDatabase().collection('curriculums').findOneAndUpdate(
    { _id: req.params.id, isDeleted: { $ne: true } },
    { $set: { modules, updatedAt: new Date() } },
    { returnDocument: 'after' },
  )
  res.json({ curriculum: pub(result) })
}))

// ── Curriculum skills covered ─────────────────────────────────────────────────

/**
 * POST /api/training/curriculums/:id/skills
 * Body: { skillsCovered: [{ skillId?, skillName*, coverage?, proficiencyLevel? }] }
 * Upserts by skillId (or skillName if no skillId).
 */
router.post('/curriculums/:id/skills', requireRole(...WRITE_ROLES), asyncHandler(async (req, res) => {
  const existing = await getCurriculum(req.params.id)
  ownerOrGovt(existing, req.user)

  const { skillsCovered } = req.body
  if (!Array.isArray(skillsCovered) || skillsCovered.length === 0)
    throw bad('skillsCovered must be a non-empty array')

  const validated = await validateSkillsCovered(skillsCovered)
  const merged    = mergeSkillsCovered(existing.skillsCovered || [], validated)

  const result = await getDatabase().collection('curriculums').findOneAndUpdate(
    { _id: req.params.id, isDeleted: { $ne: true } },
    { $set: { skillsCovered: merged, updatedAt: new Date() } },
    { returnDocument: 'after' },
  )
  res.json({ curriculum: pub(result) })
}))

/**
 * DELETE /api/training/curriculums/:id/skills/:skillRef
 * Remove one covered skill by its skillId UUID or skillName.
 */
router.delete('/curriculums/:id/skills/:skillRef', requireRole(...WRITE_ROLES), asyncHandler(async (req, res) => {
  const existing = await getCurriculum(req.params.id)
  ownerOrGovt(existing, req.user)

  const ref    = req.params.skillRef
  const before = (existing.skillsCovered || [])
  const after  = before.filter(s => s.skillId !== ref && s.skillName.toLowerCase() !== ref.toLowerCase())
  if (after.length === before.length) throw notFound('Skill not found in curriculum skills covered')

  const result = await getDatabase().collection('curriculums').findOneAndUpdate(
    { _id: req.params.id, isDeleted: { $ne: true } },
    { $set: { skillsCovered: after, updatedAt: new Date() } },
    { returnDocument: 'after' },
  )
  res.json({ curriculum: pub(result) })
}))

export default router
