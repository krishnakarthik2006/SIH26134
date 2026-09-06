/**
 * Phase B5 — Job Role & Job Description APIs
 *
 * Routes mounted at /api/jobs
 *
 * Public (no auth):
 *   GET  /api/jobs                      — list/search job roles (paginated)
 *   GET  /api/jobs/search               — full-text job search
 *   GET  /api/jobs/:id                  — get one job role
 *   GET  /api/jobs/:id/descriptions     — list job descriptions for a role
 *   GET  /api/jobs/:id/skills           — required + optional skills for a role
 *
 * Protected (industry | government):
 *   POST   /api/jobs                    — create job role
 *   PATCH  /api/jobs/:id                — update job role
 *   DELETE /api/jobs/:id                — soft-delete job role
 *   POST   /api/jobs/:id/descriptions   — upload job description
 *   DELETE /api/jobs/:id/descriptions/:descId  — delete job description
 *   POST   /api/jobs/:id/skills         — set / update required skills
 *   DELETE /api/jobs/:id/skills/:skillId— remove a required skill
 */

import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { getDatabase } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

const router = Router()

// ─── constants ───────────────────────────────────────────────────────────────
const VALID_STATUSES       = ['active', 'paused', 'closed', 'draft']
const VALID_EMPLOYMENT     = ['full-time', 'part-time', 'contract', 'internship', 'freelance']
const VALID_WORK_MODES     = ['onsite', 'remote', 'hybrid']
const VALID_SKILL_LEVELS   = ['beginner', 'intermediate', 'advanced', 'expert']
const VALID_SKILL_REQS     = ['required', 'preferred', 'nice-to-have']
const VALID_DESC_SOURCES   = ['manual', 'upload', 'scraped', 'api']

// ─── helpers ─────────────────────────────────────────────────────────────────
function bad(msg)      { const e = new Error(msg); e.statusCode = 400; return e }
function notFound(msg = 'Job role not found') { const e = new Error(msg); e.statusCode = 404; return e }
function forbidden(msg){ const e = new Error(msg); e.statusCode = 403; return e }
function conflict(msg) { const e = new Error(msg); e.statusCode = 409; return e }

function pub(doc) {
  if (!doc) return null
  const { _id, ...rest } = doc
  return { id: _id, ...rest }
}

async function findActiveRole(id) {
  const doc = await getDatabase().collection('job_roles').findOne({ _id: id, isDeleted: { $ne: true } })
  if (!doc) throw notFound()
  return doc
}

/** Verify the linked industry exists and is active */
async function findActiveIndustry(id) {
  const doc = await getDatabase().collection('industries').findOne({ _id: id, isDeleted: { $ne: true } })
  if (!doc) { const e = new Error('Industry not found'); e.statusCode = 404; throw e }
  return doc
}

/** Owner industry user or government can write */
function assertCanWrite(role, user) {
  if (user.role === 'government') return
  if (role.createdBy !== user.id) throw forbidden('You can only manage your own job roles')
}

// ─── PUBLIC READS ─────────────────────────────────────────────────────────────

/**
 * GET /api/jobs
 * Query: industryId, status, employmentType, workMode, location,
 *        page, limit, sort (title|createdAt|salaryMin), order
 */
router.get('/', asyncHandler(async (req, res) => {
  const {
    industryId, status, employmentType, workMode, location,
    page = '1', limit = '20', sort = 'title', order = 'asc',
  } = req.query

  const pageNum  = Math.max(1, parseInt(page, 10)  || 1)
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20))
  const skip     = (pageNum - 1) * limitNum

  const filter = { isDeleted: { $ne: true } }
  if (industryId)     filter.industryId      = industryId
  if (status)         filter.status          = status
  if (employmentType) filter.employmentType  = employmentType
  if (workMode)       filter.workMode        = workMode
  if (location)       filter.location        = { $regex: new RegExp(location.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }

  const sortField = ['title', 'createdAt', 'salaryMin'].includes(sort) ? sort : 'title'
  const sortDir   = order === 'desc' ? -1 : 1

  const col   = getDatabase().collection('job_roles')
  const total = await col.countDocuments(filter)
  const docs  = await col.find(filter).sort({ [sortField]: sortDir }).skip(skip).limit(limitNum).toArray()

  res.json({ jobRoles: docs.map(pub), pagination: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) } })
}))

/**
 * GET /api/jobs/search?q=
 * Regex search across title, description, location, and requiredSkills names.
 */
router.get('/search', asyncHandler(async (req, res) => {
  const { q, industryId, status = 'active', limit = '20' } = req.query
  if (!q?.trim()) throw bad('q is required')

  const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 20))
  const regex    = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')

  const filter = {
    isDeleted: { $ne: true },
    status,
    $or: [
      { title: regex },
      { description: regex },
      { location: regex },
      { 'requiredSkills.skillName': regex },
      { tags: regex },
    ],
  }
  if (industryId) filter.industryId = industryId

  const docs = await getDatabase().collection('job_roles')
    .find(filter).sort({ title: 1 }).limit(limitNum).toArray()

  res.json({ jobRoles: docs.map(pub), count: docs.length, query: q })
}))

/**
 * GET /api/jobs/:id
 */
router.get('/:id', asyncHandler(async (req, res) => {
  const doc = await findActiveRole(req.params.id)
  res.json({ jobRole: pub(doc) })
}))

/**
 * GET /api/jobs/:id/descriptions
 * Returns job descriptions uploaded for this role.
 */
router.get('/:id/descriptions', asyncHandler(async (req, res) => {
  await findActiveRole(req.params.id)

  const { page = '1', limit = '10' } = req.query
  const pageNum  = Math.max(1, parseInt(page, 10)  || 1)
  const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 10))
  const skip     = (pageNum - 1) * limitNum

  const col   = getDatabase().collection('job_descriptions')
  const filter = { jobRoleId: req.params.id, isDeleted: { $ne: true } }
  const total  = await col.countDocuments(filter)
  const docs   = await col.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).toArray()

  res.json({ descriptions: docs.map(pub), pagination: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) } })
}))

/**
 * GET /api/jobs/:id/skills
 * Returns the requiredSkills array with full skill details if available.
 */
router.get('/:id/skills', asyncHandler(async (req, res) => {
  const role = await findActiveRole(req.params.id)
  const requiredSkills = role.requiredSkills || []

  // Optionally enrich with canonical skill data
  const skillIds = requiredSkills.map(s => s.skillId).filter(Boolean)
  let skillDocs  = []
  if (skillIds.length) {
    skillDocs = await getDatabase().collection('skills')
      .find({ _id: { $in: skillIds }, isDeleted: { $ne: true } })
      .toArray()
  }
  const skillMap = Object.fromEntries(skillDocs.map(s => [s._id, s]))

  const enriched = requiredSkills.map(rs => ({
    ...rs,
    skillDetails: skillMap[rs.skillId] ? pub(skillMap[rs.skillId]) : null,
  }))

  res.json({ requiredSkills: enriched, count: enriched.length, jobRoleId: req.params.id })
}))

// ─── WRITE ROUTES — auth required ─────────────────────────────────────────────
router.use(requireAuth)

/**
 * POST /api/jobs
 * Body:
 *   industryId*        — parent industry UUID
 *   title*             — job role title
 *   description        — detailed description
 *   status             — active|paused|closed|draft  (default draft)
 *   employmentType     — full-time|part-time|contract|internship|freelance
 *   workMode           — onsite|remote|hybrid
 *   location           — city / region string
 *   salaryMin          — number
 *   salaryMax          — number
 *   salaryCurrency     — e.g. "INR"
 *   experienceYears    — number
 *   tags[]             — free-form labels
 *   requiredSkills[]   — [{ skillId?, skillName*, level, requirement }]
 */
router.post('/', requireRole('industry', 'government'), asyncHandler(async (req, res) => {
  const {
    industryId, title, description = '',
    status = 'draft', employmentType, workMode,
    location = '', salaryMin, salaryMax, salaryCurrency = 'INR',
    experienceYears, tags = [], requiredSkills = [],
  } = req.body

  if (!industryId?.trim()) throw bad('industryId is required')
  if (!title?.trim())      throw bad('title is required')
  if (!VALID_STATUSES.includes(status)) throw bad(`status must be one of: ${VALID_STATUSES.join(', ')}`)
  if (employmentType && !VALID_EMPLOYMENT.includes(employmentType))
    throw bad(`employmentType must be one of: ${VALID_EMPLOYMENT.join(', ')}`)
  if (workMode && !VALID_WORK_MODES.includes(workMode))
    throw bad(`workMode must be one of: ${VALID_WORK_MODES.join(', ')}`)
  if (!Array.isArray(tags))           throw bad('tags must be an array')
  if (!Array.isArray(requiredSkills)) throw bad('requiredSkills must be an array')

  // Salary validation
  if (salaryMin !== undefined && (typeof salaryMin !== 'number' || salaryMin < 0))
    throw bad('salaryMin must be a non-negative number')
  if (salaryMax !== undefined && (typeof salaryMax !== 'number' || salaryMax < 0))
    throw bad('salaryMax must be a non-negative number')
  if (salaryMin !== undefined && salaryMax !== undefined && salaryMax < salaryMin)
    throw bad('salaryMax must be >= salaryMin')
  if (experienceYears !== undefined && (typeof experienceYears !== 'number' || experienceYears < 0))
    throw bad('experienceYears must be a non-negative number')

  // Validate parent industry
  await findActiveIndustry(industryId)

  // Validate requiredSkills structure
  const validatedSkills = await validateSkillsArray(requiredSkills)

  const now = new Date()
  const doc = {
    _id: randomUUID(),
    industryId,
    title:          title.trim(),
    description,
    status,
    employmentType: employmentType || null,
    workMode:       workMode       || null,
    location,
    salaryMin:      salaryMin      ?? null,
    salaryMax:      salaryMax      ?? null,
    salaryCurrency,
    experienceYears: experienceYears ?? null,
    tags:           tags.map(t => t.trim().toLowerCase()).filter(Boolean),
    requiredSkills: validatedSkills,
    isDeleted:      false,
    createdBy:      req.user.id,
    createdAt:      now,
    updatedAt:      now,
  }

  await getDatabase().collection('job_roles').insertOne(doc)

  // Real-time demand aggregation: update skill_demand collection for each required skill
  const db = getDatabase()
  for (const s of validatedSkills) {
    if (s.skillName) {
      const norm = s.skillName.trim().toLowerCase()
      await db.collection('skill_demand').updateOne(
        { skillNameNormalized: norm },
        {
          $inc: { demandScore: s.requirement === 'required' ? 10 : 5, totalJobPostings: 1 },
          $set: { skillName: s.skillName, updatedAt: new Date() },
          $setOnInsert: { _id: randomUUID(), createdAt: new Date() },
        },
        { upsert: true }
      ).catch(() => {})
    }
  }

  res.status(201).json({ jobRole: pub(doc) })
}))

/**
 * GET /api/jobs/:id/applicants
 * List applicants for a job role along with match/readiness scores.
 */
router.get('/:id/applicants', requireRole('industry', 'government'), asyncHandler(async (req, res) => {
  const role = await findActiveRole(req.params.id)
  const db = getDatabase()

  const applications = await db.collection('job_applications')
    .find({ jobRoleId: req.params.id, isDeleted: { $ne: true } })
    .sort({ createdAt: -1 })
    .toArray()

  const applicantIds = applications.map(a => a.applicantId).filter(Boolean)

  const students = applicantIds.length
    ? await db.collection('students').find({ _id: { $in: applicantIds } }).toArray()
    : []
  const studentMap = new Map(students.map(s => [s._id, s]))

  const users = students.map(s => s.userId).filter(Boolean)
  const userDocs = users.length
    ? await db.collection('users').find({ _id: { $in: users } }).toArray()
    : []
  const userMap = new Map(userDocs.map(u => [u._id, u]))

  const results = applications.map(app => {
    const student = studentMap.get(app.applicantId)
    const user = student ? userMap.get(student.userId) : null

    // Compute basic skill match score against job's required skills
    const candidateSkills = (student?.currentSkills || []).map(s => (s.skillName || s.name || '').toLowerCase())
    const requiredSkills = (role.requiredSkills || []).map(s => (s.skillName || s.name || '').toLowerCase())
    const matched = requiredSkills.filter(s => candidateSkills.includes(s))
    const matchScore = requiredSkills.length > 0
      ? Math.round((matched.length / requiredSkills.length) * 100)
      : 75

    return {
      id: app._id,
      applicantId: app.applicantId,
      applicantName: user?.name || student?.name || 'Applicant',
      applicantEmail: user?.email || student?.email || 'N/A',
      status: app.status || 'applied',
      appliedAt: app.createdAt,
      matchScore,
      matchedSkills: matched,
      missingSkills: requiredSkills.filter(s => !candidateSkills.includes(s)),
      currentSkills: student?.currentSkills || [],
    }
  })

  res.json({ applicants: results, jobTitle: role.title })
}))

/**
 * PATCH /api/jobs/:id
 * Partial update. Owner or government only.
 */
router.patch('/:id', requireRole('industry', 'government'), asyncHandler(async (req, res) => {
  const existing = await findActiveRole(req.params.id)
  assertCanWrite(existing, req.user)

  const allowed = ['title', 'description', 'status', 'employmentType', 'workMode',
                   'location', 'salaryMin', 'salaryMax', 'salaryCurrency',
                   'experienceYears', 'tags']
  const update  = {}
  for (const f of allowed) {
    if (Object.prototype.hasOwnProperty.call(req.body, f)) update[f] = req.body[f]
  }
  if (Object.keys(update).length === 0) throw bad('No valid fields provided')

  if (update.title !== undefined && !update.title?.trim()) throw bad('title cannot be empty')
  if (update.title) update.title = update.title.trim()
  if (update.status && !VALID_STATUSES.includes(update.status))
    throw bad(`status must be one of: ${VALID_STATUSES.join(', ')}`)
  if (update.employmentType && !VALID_EMPLOYMENT.includes(update.employmentType))
    throw bad(`employmentType must be one of: ${VALID_EMPLOYMENT.join(', ')}`)
  if (update.workMode && !VALID_WORK_MODES.includes(update.workMode))
    throw bad(`workMode must be one of: ${VALID_WORK_MODES.join(', ')}`)
  if (update.tags !== undefined) {
    if (!Array.isArray(update.tags)) throw bad('tags must be an array')
    update.tags = update.tags.map(t => t.trim().toLowerCase()).filter(Boolean)
  }
  if (update.salaryMin !== undefined && update.salaryMin !== null &&
      (typeof update.salaryMin !== 'number' || update.salaryMin < 0))
    throw bad('salaryMin must be a non-negative number')
  if (update.salaryMax !== undefined && update.salaryMax !== null &&
      (typeof update.salaryMax !== 'number' || update.salaryMax < 0))
    throw bad('salaryMax must be a non-negative number')

  const effectiveMin = update.salaryMin ?? existing.salaryMin
  const effectiveMax = update.salaryMax ?? existing.salaryMax
  if (effectiveMin !== null && effectiveMax !== null && effectiveMax < effectiveMin)
    throw bad('salaryMax must be >= salaryMin')

  update.updatedAt = new Date()
  const result = await getDatabase().collection('job_roles').findOneAndUpdate(
    { _id: req.params.id, isDeleted: { $ne: true } },
    { $set: update },
    { returnDocument: 'after' },
  )
  res.json({ jobRole: pub(result) })
}))

/**
 * DELETE /api/jobs/:id
 * Soft-delete job role + its descriptions.
 */
router.delete('/:id', requireRole('industry', 'government'), asyncHandler(async (req, res) => {
  const existing = await findActiveRole(req.params.id)
  assertCanWrite(existing, req.user)

  const now = new Date()
  await getDatabase().collection('job_roles').updateOne(
    { _id: req.params.id },
    { $set: { isDeleted: true, deletedAt: now, deletedBy: req.user.id, updatedAt: now } },
  )
  // Cascade: soft-delete job descriptions
  await getDatabase().collection('job_descriptions').updateMany(
    { jobRoleId: req.params.id },
    { $set: { isDeleted: true, deletedAt: now, updatedAt: now } },
  )

  res.json({ message: 'Job role deleted', id: req.params.id })
}))

// ─── JOB DESCRIPTIONS ─────────────────────────────────────────────────────────

/**
 * POST /api/jobs/:id/descriptions
 * Upload / record a job description document.
 * Body:
 *   content*    — raw text of the JD
 *   source      — manual|upload|scraped|api  (default manual)
 *   sourceUrl   — origin URL if scraped
 *   rawTitle    — original title from source
 *   notes       — internal notes
 */
router.post('/:id/descriptions', requireRole('industry', 'government'), asyncHandler(async (req, res) => {
  const role = await findActiveRole(req.params.id)
  assertCanWrite(role, req.user)

  const { content, source = 'manual', sourceUrl = '', rawTitle = '', notes = '' } = req.body
  if (!content?.trim()) throw bad('content is required')
  if (!VALID_DESC_SOURCES.includes(source)) throw bad(`source must be one of: ${VALID_DESC_SOURCES.join(', ')}`)

  const now = new Date()
  const doc = {
    _id: randomUUID(),
    jobRoleId:  req.params.id,
    industryId: role.industryId,
    content:    content.trim(),
    source,
    sourceUrl,
    rawTitle,
    notes,
    wordCount:  content.trim().split(/\s+/).length,
    isDeleted:  false,
    uploadedBy: req.user.id,
    createdAt:  now,
    updatedAt:  now,
  }

  await getDatabase().collection('job_descriptions').insertOne(doc)
  res.status(201).json({ description: pub(doc) })
}))

/**
 * DELETE /api/jobs/:id/descriptions/:descId
 * Soft-delete a specific job description.
 */
router.delete('/:id/descriptions/:descId', requireRole('industry', 'government'), asyncHandler(async (req, res) => {
  const role = await findActiveRole(req.params.id)
  assertCanWrite(role, req.user)

  const desc = await getDatabase().collection('job_descriptions').findOne({
    _id: req.params.descId, jobRoleId: req.params.id, isDeleted: { $ne: true },
  })
  if (!desc) { const e = new Error('Job description not found'); e.statusCode = 404; throw e }

  await getDatabase().collection('job_descriptions').updateOne(
    { _id: req.params.descId },
    { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: req.user.id, updatedAt: new Date() } },
  )
  res.json({ message: 'Job description deleted', id: req.params.descId })
}))

// ─── REQUIRED SKILLS ─────────────────────────────────────────────────────────

/**
 * POST /api/jobs/:id/skills
 * Add or update required skills on a job role.
 * Body: { skills: [{ skillId?, skillName*, level?, requirement? }] }
 *
 * - skillId (optional): UUID of a canonical skill from the skills collection
 * - skillName: display name (required)
 * - level: beginner|intermediate|advanced|expert
 * - requirement: required|preferred|nice-to-have (default required)
 *
 * Existing skills with the same skillId (or same skillName if no skillId)
 * are replaced (upsert semantics). New skills are appended.
 */
router.post('/:id/skills', requireRole('industry', 'government'), asyncHandler(async (req, res) => {
  const role = await findActiveRole(req.params.id)
  assertCanWrite(role, req.user)

  const { skills } = req.body
  if (!Array.isArray(skills) || skills.length === 0) throw bad('skills must be a non-empty array')

  const validated = await validateSkillsArray(skills)

  // Merge: replace matching entries, append new ones
  const existing  = role.requiredSkills || []
  const merged    = mergeSkills(existing, validated)

  const result = await getDatabase().collection('job_roles').findOneAndUpdate(
    { _id: req.params.id, isDeleted: { $ne: true } },
    { $set: { requiredSkills: merged, updatedAt: new Date() } },
    { returnDocument: 'after' },
  )
  res.json({ jobRole: pub(result) })
}))

/**
 * DELETE /api/jobs/:id/skills/:skillId
 * Remove a required skill entry by its skillId or by name (passed as :skillId).
 */
router.delete('/:id/skills/:skillRef', requireRole('industry', 'government'), asyncHandler(async (req, res) => {
  const role = await findActiveRole(req.params.id)
  assertCanWrite(role, req.user)

  const ref      = req.params.skillRef
  const existing = role.requiredSkills || []
  const filtered = existing.filter(s => s.skillId !== ref && s.skillName.toLowerCase() !== ref.toLowerCase())

  if (filtered.length === existing.length)
    throw notFound('Required skill entry not found on this job role')

  const result = await getDatabase().collection('job_roles').findOneAndUpdate(
    { _id: req.params.id, isDeleted: { $ne: true } },
    { $set: { requiredSkills: filtered, updatedAt: new Date() } },
    { returnDocument: 'after' },
  )
  res.json({ jobRole: pub(result) })
}))

// ─── SHARED VALIDATORS ────────────────────────────────────────────────────────

/**
 * Validate and normalise a skills array from request body.
 * Each entry: { skillId?, skillName*, level?, requirement? }
 */
async function validateSkillsArray(skills) {
  if (!Array.isArray(skills)) throw bad('skills must be an array')

  const validated = []
  for (const [i, s] of skills.entries()) {
    if (!s.skillName?.trim()) throw bad(`skills[${i}].skillName is required`)
    if (s.level       && !VALID_SKILL_LEVELS.includes(s.level))
      throw bad(`skills[${i}].level must be one of: ${VALID_SKILL_LEVELS.join(', ')}`)
    if (s.requirement && !VALID_SKILL_REQS.includes(s.requirement))
      throw bad(`skills[${i}].requirement must be one of: ${VALID_SKILL_REQS.join(', ')}`)

    // Verify skillId if provided
    if (s.skillId) {
      const canonical = await getDatabase().collection('skills')
        .findOne({ _id: s.skillId, isDeleted: { $ne: true } })
      if (!canonical) throw bad(`skills[${i}].skillId "${s.skillId}" does not exist in the skill knowledge base`)
    }

    validated.push({
      skillId:     s.skillId     || null,
      skillName:   s.skillName.trim(),
      level:       s.level       || null,
      requirement: s.requirement || 'required',
    })
  }
  return validated
}

/**
 * Merge a new skills list into existing, using skillId (then skillName) as key.
 */
function mergeSkills(existing, incoming) {
  const map = new Map()
  for (const s of existing) {
    const key = s.skillId || s.skillName.toLowerCase()
    map.set(key, s)
  }
  for (const s of incoming) {
    const key = s.skillId || s.skillName.toLowerCase()
    map.set(key, s)
  }
  return Array.from(map.values())
}

export default router
