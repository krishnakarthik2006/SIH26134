/**
 * Phase B9 — Skill Matching & Gap Analysis Routes
 * Mounted at /api/match
 *
 * All routes require authentication.
 *
 *   POST /api/match                       — ad-hoc match (not persisted)
 *   POST /api/match/gap                   — full gap analysis (persisted to DB)
 *   GET  /api/match/gap/:subjectType/:subjectId   — fetch persisted gap results
 *   GET  /api/match/gap/:subjectType/:subjectId/history — all historical readiness scores
 *   POST /api/match/job/:jobRoleId        — match learner against a job role directly
 */

import { Router }     from 'express'
import { getDatabase }          from '../db.js'
import { asyncHandler }         from '../middleware/errorHandler.js'
import { requireAuth }          from '../middleware/auth.js'
import { matchSkills, computeAndPersistGap, LEVEL_NAMES } from '../services/matcher.js'

const router = Router()
router.use(requireAuth)

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const bad      = (m) => Object.assign(new Error(m), { statusCode: 400 })
const notFound = (m = 'Gap analysis not found') => Object.assign(new Error(m), { statusCode: 404 })

function pub(doc) {
  if (!doc) return null
  const { _id, ...rest } = doc
  return { id: _id, ...rest }
}

const VALID_SUBJECT_TYPES = ['learner', 'training_program', 'team']

/**
 * Validate a skills array submitted in the request body.
 * Each item needs at least a skillId OR a skillName.
 */
function validateSkillsInput(arr, fieldName) {
  if (!Array.isArray(arr)) throw bad(`${fieldName} must be an array`)
  for (const [i, s] of arr.entries()) {
    if (!s.skillId && !s.skillName && !s.name)
      throw bad(`${fieldName}[${i}] must have skillId or skillName`)
    if (s.level && !LEVEL_NAMES.includes(s.level))
      throw bad(`${fieldName}[${i}].level must be one of: ${LEVEL_NAMES.join(', ')}`)
    if (s.requirement && !['required', 'preferred', 'nice-to-have'].includes(s.requirement))
      throw bad(`${fieldName}[${i}].requirement must be required | preferred | nice-to-have`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AD-HOC MATCH  (not persisted)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/match
 * Run a skill match without saving results.
 * Useful for previewing before committing to the DB.
 *
 * Body:
 *   requiredSkills*  [{ skillId?, skillName?, level?, requirement? }]
 *   currentSkills*   [{ skillId?, skillName?, level?, selfRating? }]
 */
router.post('/', asyncHandler(async (req, res) => {
  const { requiredSkills, currentSkills } = req.body

  if (requiredSkills === undefined) throw bad('requiredSkills is required')
  if (currentSkills  === undefined) throw bad('currentSkills is required')

  validateSkillsInput(requiredSkills, 'requiredSkills')
  validateSkillsInput(currentSkills,  'currentSkills')

  if (requiredSkills.length > 200) throw bad('requiredSkills must not exceed 200 items')
  if (currentSkills.length  > 200) throw bad('currentSkills must not exceed 200 items')

  const result = await matchSkills(requiredSkills, currentSkills)
  res.json({ result })
}))

// ─────────────────────────────────────────────────────────────────────────────
// FULL GAP ANALYSIS  (persisted)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/match/gap
 * Run gap analysis and persist results to skill_gaps + readiness_scores.
 *
 * Body:
 *   subjectType*    learner | training_program | team
 *   subjectId*      UUID of the subject (student._id, program._id, etc.)
 *   targetRole*     human-readable target role name
 *   jobRoleId       UUID of the job_roles document (optional, used for enrichment)
 *   requiredSkills* same format as POST /api/match
 *   currentSkills*  same format as POST /api/match
 */
router.post('/gap', asyncHandler(async (req, res) => {
  const {
    subjectType, subjectId, targetRole, jobRoleId,
    requiredSkills, currentSkills,
  } = req.body

  if (!subjectType?.trim())  throw bad('subjectType is required')
  if (!subjectId?.trim())    throw bad('subjectId is required')
  if (!targetRole?.trim())   throw bad('targetRole is required')
  if (!VALID_SUBJECT_TYPES.includes(subjectType))
    throw bad(`subjectType must be one of: ${VALID_SUBJECT_TYPES.join(', ')}`)

  if (requiredSkills === undefined) throw bad('requiredSkills is required')
  if (currentSkills  === undefined) throw bad('currentSkills is required')

  validateSkillsInput(requiredSkills, 'requiredSkills')
  validateSkillsInput(currentSkills,  'currentSkills')

  if (requiredSkills.length > 200) throw bad('requiredSkills must not exceed 200 items')
  if (currentSkills.length  > 200) throw bad('currentSkills must not exceed 200 items')

  // If jobRoleId given, verify it exists
  if (jobRoleId) {
    const jobRole = await getDatabase().collection('job_roles').findOne({ _id: jobRoleId, isDeleted: { $ne: true } })
    if (!jobRole) throw bad(`jobRoleId "${jobRoleId}" not found`)
  }

  const { matchResult, readinessDoc, gapDocs } = await computeAndPersistGap({
    subjectType,
    subjectId,
    targetRole:    targetRole.trim(),
    jobRoleId:     jobRoleId || null,
    requiredSkills,
    currentSkills,
    computedBy:    req.user.id,
  })

  res.status(201).json({
    message:       'Gap analysis completed and saved',
    result:        matchResult,
    readinessScore: pub(readinessDoc),
    gapCount:      gapDocs.length,
  })
}))

// ─────────────────────────────────────────────────────────────────────────────
// GET PERSISTED GAP RESULTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/match/gap/:subjectType/:subjectId
 * Returns the latest persisted readiness score for a subject.
 * Optional ?targetRole= to filter to a specific role.
 */
router.get('/gap/:subjectType/:subjectId', asyncHandler(async (req, res) => {
  const { subjectType, subjectId } = req.params
  const { targetRole } = req.query

  if (!VALID_SUBJECT_TYPES.includes(subjectType))
    throw bad(`subjectType must be one of: ${VALID_SUBJECT_TYPES.join(', ')}`)

  const filter = { subjectType, subjectId }
  if (targetRole?.trim()) filter.targetRole = targetRole.trim()

  const scores = await getDatabase().collection('readiness_scores')
    .find(filter).sort({ calculatedAt: -1 }).toArray()

  if (scores.length === 0) throw notFound(`No gap analysis found for ${subjectType} "${subjectId}"`)

  // Also fetch open gap records
  const gapFilter = { subjectType, subjectId, status: 'open' }
  if (targetRole?.trim()) gapFilter.targetRole = targetRole.trim()
  const openGaps = await getDatabase().collection('skill_gaps')
    .find(gapFilter).sort({ priority: -1 }).toArray()

  res.json({
    readinessScores: scores.map(pub),
    openGaps:        openGaps.map(pub),
    latest:          pub(scores[0]),
  })
}))

/**
 * GET /api/match/gap/:subjectType/:subjectId/history
 * Returns all historical readiness score records for a subject, sorted newest first.
 * Supports ?targetRole= filter and pagination.
 */
router.get('/gap/:subjectType/:subjectId/history', asyncHandler(async (req, res) => {
  const { subjectType, subjectId } = req.params
  const { targetRole, page: pg = '1', limit: lm = '20' } = req.query

  if (!VALID_SUBJECT_TYPES.includes(subjectType))
    throw bad(`subjectType must be one of: ${VALID_SUBJECT_TYPES.join(', ')}`)

  const page  = Math.max(1, parseInt(pg, 10)  || 1)
  const limit = Math.min(50, Math.max(1, parseInt(lm, 10) || 20))
  const skip  = (page - 1) * limit

  const filter = { subjectType, subjectId }
  if (targetRole?.trim()) filter.targetRole = targetRole.trim()

  const col   = getDatabase().collection('readiness_scores')
  const total = await col.countDocuments(filter)
  const docs  = await col.find(filter).sort({ calculatedAt: -1 }).skip(skip).limit(limit).toArray()

  res.json({
    history:    docs.map(pub),
    pagination: { total, page, limit, pages: Math.ceil(total / limit) },
  })
}))

// ─────────────────────────────────────────────────────────────────────────────
// MATCH AGAINST JOB ROLE  (convenience shortcut)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/match/job/:jobRoleId
 * Match a learner's skills directly against a job role's requiredSkills.
 *
 * Fetches the job role's requiredSkills from the DB automatically.
 * Caller only needs to provide their current skills.
 *
 * Body:
 *   currentSkills*  [{ skillId?, skillName?, level?, selfRating? }]
 *   persist         boolean — whether to persist to skill_gaps/readiness_scores (default false)
 *   subjectType     learner | training_program | team  (required if persist=true)
 *   subjectId       UUID of subject  (required if persist=true)
 */
router.post('/job/:jobRoleId', asyncHandler(async (req, res) => {
  const { jobRoleId } = req.params
  const { currentSkills, persist = false, subjectType, subjectId } = req.body

  if (currentSkills === undefined) throw bad('currentSkills is required')
  validateSkillsInput(currentSkills, 'currentSkills')
  if (currentSkills.length > 200) throw bad('currentSkills must not exceed 200 items')

  // Fetch job role
  const jobRole = await getDatabase().collection('job_roles').findOne({ _id: jobRoleId, isDeleted: { $ne: true } })
  if (!jobRole) throw notFound(`Job role "${jobRoleId}" not found`)

  const requiredSkills = (jobRole.requiredSkills || [])
  if (requiredSkills.length === 0) {
    return res.json({
      result: {
        readinessScore: 100, gapSeverity: 'none', totalRequired: 0,
        matchedCount: 0, gapCount: 0, surplusCount: currentSkills.length,
        matched: [], gaps: [], surplus: [],
        calculatedAt: new Date().toISOString(),
        note: 'Job role has no required skills defined',
      },
      jobRole: { id: jobRole._id, title: jobRole.title },
    })
  }

  if (persist) {
    if (!subjectType || !subjectId) throw bad('subjectType and subjectId are required when persist=true')
    if (!VALID_SUBJECT_TYPES.includes(subjectType))
      throw bad(`subjectType must be one of: ${VALID_SUBJECT_TYPES.join(', ')}`)

    const { matchResult, readinessDoc, gapDocs } = await computeAndPersistGap({
      subjectType, subjectId,
      targetRole:    jobRole.title,
      jobRoleId,
      requiredSkills,
      currentSkills,
      computedBy:    req.user.id,
    })
    return res.status(201).json({
      message:        'Gap analysis completed and saved',
      result:         matchResult,
      readinessScore: pub(readinessDoc),
      gapCount:       gapDocs.length,
      jobRole:        { id: jobRole._id, title: jobRole.title },
    })
  }

  const result = await matchSkills(requiredSkills, currentSkills)
  res.json({
    result,
    jobRole: { id: jobRole._id, title: jobRole.title, industryId: jobRole.industryId },
  })
}))

export default router
