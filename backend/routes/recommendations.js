/**
 * Phase B11 — Recommendation Engine Routes
 * Mounted at /api/recommendations
 *
 * Public:
 *   GET  /api/recommendations/program/:programId/explain
 *       — explain why a specific program is relevant to given gaps (ad-hoc)
 *
 * Protected (any auth):
 *   POST /api/recommendations/preview
 *       — ad-hoc recommendations for supplied gaps (not persisted)
 *   POST /api/recommendations/generate
 *       — generate + persist recommendations for a subject
 *   GET  /api/recommendations/my
 *       — recommendations persisted for the current user (learner)
 *   GET  /api/recommendations/:id
 *       — fetch one persisted recommendation set
 *   PATCH /api/recommendations/:id/status
 *       — mark a recommendation as viewed / dismissed / enrolled
 *   GET  /api/recommendations/subject/:subjectType/:subjectId
 *       — recommendations for a given subject (government / training view)
 */

import { randomUUID } from 'node:crypto'
import { Router }     from 'express'
import { getDatabase }          from '../db.js'
import { asyncHandler }         from '../middleware/errorHandler.js'
import { requireAuth }          from '../middleware/auth.js'
import { recommendForGaps, loadEnrichedPrograms, scoreProgram, buildExplanation, normalizeGaps, SCORING_WEIGHTS } from '../services/recommender.js'
import { matchSkills }          from '../services/matcher.js'

const router = Router()

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const bad      = (m) => Object.assign(new Error(m), { statusCode: 400 })
const notFound = (m = 'Recommendation not found') => Object.assign(new Error(m), { statusCode: 404 })
const forbidden= (m) => Object.assign(new Error(m), { statusCode: 403 })

function pub(doc) {
  if (!doc) return null
  const { _id, ...rest } = doc
  return { id: _id, ...rest }
}

const VALID_SUBJECT_TYPES = ['learner', 'training_program', 'team']
const VALID_STATUSES      = ['pending', 'viewed', 'enrolled', 'dismissed', 'completed']

function validateGaps(gaps) {
  if (!Array.isArray(gaps)) throw bad('gaps must be an array')
  if (gaps.length === 0)    throw bad('gaps must not be empty')
  for (const [i, g] of gaps.entries()) {
    if (!g.skillName && !g.canonicalId && !g.skillId)
      throw bad(`gaps[${i}] must have skillName or canonicalId`)
    const allowedReq = ['required','preferred','nice-to-have','critical','high','medium','low']
    if (g.requirement && !allowedReq.includes(g.requirement))
      throw bad(`gaps[${i}].requirement must be required | preferred | nice-to-have`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC — explain one program
// ─────────────────────────────────────────────────────────────────────────────
router.get('/program/:programId/explain', asyncHandler(async (req, res) => {
  const { programId } = req.params
  let gaps = req.body && req.body.gaps
  if (!gaps && req.query.gaps) {
    try { gaps = JSON.parse(req.query.gaps) } catch { throw bad('gaps query param must be valid JSON') }
  }
  if (!gaps || !Array.isArray(gaps) || gaps.length === 0) {
    throw bad('Provide gaps as a JSON body or ?gaps= query param')
  }
  validateGaps(gaps)

  const program = await getDatabase().collection('training_programs')
    .findOne({ _id: programId, status: 'active', isDeleted: { $ne: true } })
  if (!program) throw notFound(`Program "${programId}" not found or not active`)

  const normalized = normalizeGaps(gaps)
  const enriched = await loadEnrichedPrograms({
    skillIds:   normalized.map(g => g.canonicalId).filter(Boolean),
    skillNames: normalized.map(g => g.skillName).filter(Boolean),
  })
  const ep = enriched.find(e => e.program._id === programId)
  if (!ep) {
    return res.json({
      programId,
      programName: program.name,
      relevanceScore: 0,
      explanation:   'This program does not cover any of the specified skill gaps.',
      coveredGaps:   [],
      scores:        null,
    })
  }

  const { scores, coveredGaps, uncoveredGaps, relevanceScore } = scoreProgram(ep, normalized)
  if (!scores) {
    return res.json({
      programId,
      programName: program.name,
      relevanceScore: 0,
      explanation:   'This program does not cover any of the specified skill gaps.',
      coveredGaps:   [],
      scores:        null,
    })
  }
  const explanation = buildExplanation(ep, coveredGaps, scores, relevanceScore, uncoveredGaps)

  res.json({ programId, programName: program.name, relevanceScore, explanation, coveredGaps, scores })
}))

// ─────────────────────────────────────────────────────────────────────────────
// PROTECTED — all remaining routes
// ─────────────────────────────────────────────────────────────────────────────
router.use(requireAuth)

// ─── AD-HOC PREVIEW (not persisted) ─────────────────────────────────────────
/**
 * POST /api/recommendations/preview
 * Body:
 *   gaps*           [{ canonicalId?, skillName*, requiredLevel?, requirement? }]
 *   limit           max recommendations (default 10, max 25)
 *   minRelevance    minimum score 0-100 (default 10)
 *   prioritizeCritical  bool (default true)
 *   excludeProgramIds   string[]
 */
router.post('/preview', asyncHandler(async (req, res) => {
  const {
    gaps, limit = 10, minRelevance = 10,
    prioritizeCritical = true, excludeProgramIds = [],
  } = req.body

  validateGaps(gaps)
  if (typeof limit !== 'number' || limit < 1 || limit > 25) throw bad('limit must be 1-25')

  const recommendations = await recommendForGaps(gaps, {
    limit, minRelevance, prioritizeCritical,
    excludeProgramIds: Array.isArray(excludeProgramIds) ? excludeProgramIds : [],
  })

  res.json({
    recommendations,
    count:    recommendations.length,
    gapCount: gaps.length,
    scoring:  { weights: SCORING_WEIGHTS },
  })
}))

// ─── GENERATE + PERSIST ──────────────────────────────────────────────────────
/**
 * POST /api/recommendations/generate
 * Runs the recommendation engine for a subject and persists results.
 *
 * Body — option A (supply gaps directly):
 *   subjectType*    learner | training_program | team
 *   subjectId*      UUID
 *   targetRole*     human-readable label
 *   gaps*           gap array
 *   limit / minRelevance / prioritizeCritical / excludeProgramIds  (optional)
 *
 * Body — option B (auto-derive gaps from readiness_scores):
 *   subjectType*, subjectId*, targetRole*   (gaps omitted — fetched from DB)
 */
router.post('/generate', asyncHandler(async (req, res) => {
  const {
    subjectType, subjectId, targetRole,
    limit = 10, minRelevance = 10,
    prioritizeCritical = true, excludeProgramIds = [],
  } = req.body
  let { gaps } = req.body

  if (!subjectType?.trim())  throw bad('subjectType is required')
  if (!subjectId?.trim())    throw bad('subjectId is required')
  if (!targetRole?.trim())   throw bad('targetRole is required')
  if (!VALID_SUBJECT_TYPES.includes(subjectType))
    throw bad(`subjectType must be one of: ${VALID_SUBJECT_TYPES.join(', ')}`)

  // If gaps not supplied, auto-derive from stored readiness score
  if (!gaps) {
    const stored = await getDatabase().collection('readiness_scores')
      .findOne({ subjectType, subjectId, targetRole: targetRole.trim() })
    if (!stored || !stored.gaps?.length) {
      throw bad('No gaps provided and no stored gap analysis found. Run POST /api/match/gap first, or supply gaps directly.')
    }
    gaps = stored.gaps
  }

  validateGaps(gaps)

  const recommendations = await recommendForGaps(gaps, {
    limit, minRelevance, prioritizeCritical,
    excludeProgramIds: Array.isArray(excludeProgramIds) ? excludeProgramIds : [],
  })

  const now = new Date()
  const doc = {
    _id:           randomUUID(),
    recipientType: subjectType,
    recipientId:   subjectId,
    targetRole:    targetRole.trim(),
    generatedBy:   req.user.id,
    status:        'pending',
    recommendations,
    totalCount:    recommendations.length,
    gapCount:      gaps.length,
    gapSnapshot:   gaps,
    createdAt:     now,
    updatedAt:     now,
    viewedAt:      null,
  }

  await getDatabase().collection('recommendations').insertOne(doc)

  res.status(201).json({
    message:         'Recommendations generated and saved',
    recommendation:  pub(doc),
  })
}))

// ─── MY RECOMMENDATIONS (learner shortcut) ────────────────────────────────────
/**
 * GET /api/recommendations/my
 * Returns recommendation sets where recipientType=learner and recipientId=current user.
 * Query: status, targetRole, page, limit
 */
router.get('/my', asyncHandler(async (req, res) => {
  const { status, targetRole, page: pg = '1', limit: lm = '10' } = req.query
  const page  = Math.max(1, parseInt(pg, 10)  || 1)
  const limit = Math.min(50, Math.max(1, parseInt(lm, 10) || 10))
  const skip  = (page - 1) * limit

  const filter = {
    recipientType: 'learner',
    $or: [{ recipientId: req.user.id }, { generatedBy: req.user.id }],
  }
  if (status)     filter.status     = status
  if (targetRole) filter.targetRole = targetRole.trim()

  const col   = getDatabase().collection('recommendations')
  const total = await col.countDocuments(filter)
  const docs  = await col.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray()

  res.json({
    recommendations: docs.map(pub),
    pagination:      { total, page, limit, pages: Math.ceil(total / limit) },
  })
}))

// ─── GET BY SUBJECT ───────────────────────────────────────────────────────────
/**
 * GET /api/recommendations/subject/:subjectType/:subjectId
 * For government / training views — see recommendations for any subject.
 */
router.get('/subject/:subjectType/:subjectId', asyncHandler(async (req, res) => {
  const { subjectType, subjectId } = req.params
  const { targetRole, page: pg = '1', limit: lm = '10' } = req.query

  if (!VALID_SUBJECT_TYPES.includes(subjectType))
    throw bad(`subjectType must be one of: ${VALID_SUBJECT_TYPES.join(', ')}`)

  // Only the subject themselves or government may access
  const isOwn = req.user.id === subjectId || subjectType !== 'learner'
  if (!isOwn && req.user.role !== 'government')
    throw forbidden('You do not have access to these recommendations')

  const page  = Math.max(1, parseInt(pg, 10)  || 1)
  const limit = Math.min(50, Math.max(1, parseInt(lm, 10) || 10))
  const skip  = (page - 1) * limit

  const filter = { recipientType: subjectType, recipientId: subjectId }
  if (targetRole) filter.targetRole = targetRole.trim()

  const col   = getDatabase().collection('recommendations')
  const total = await col.countDocuments(filter)
  const docs  = await col.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray()

  res.json({
    recommendations: docs.map(pub),
    pagination:      { total, page, limit, pages: Math.ceil(total / limit) },
  })
}))

/**
 * POST /api/recommendations/for-me
 * Learner convenience: auto-fetches gaps from the latest readiness score
 * (or the learner's B10 target-role analysis) and returns a fresh list.
 */
router.post('/for-me', asyncHandler(async (req, res) => {
  const { targetRole, limit = 10, minRelevance = 10, prioritizeCritical = true } = req.body || {}

  const filter = { subjectType: 'learner', subjectId: req.user.id }
  if (targetRole?.trim()) filter.targetRole = targetRole.trim()

  const score = await getDatabase().collection('readiness_scores')
    .findOne(filter, { sort: { calculatedAt: -1 } })

  let gaps = score?.gaps
  let roleLabel = score?.targetRole
  let analysedAt = score?.calculatedAt

  if (!gaps?.length && req.user.role === 'learner') {
    const student = await getDatabase().collection('students').findOne({ userId: req.user.id })
    const roleId = student?.targetJobRoleId
    const role = roleId
      ? await getDatabase().collection('job_roles').findOne({ _id: roleId, isDeleted: { $ne: true } })
      : null
    if (role?.requiredSkills?.length) {
      const match = await matchSkills(role.requiredSkills, student.currentSkills || [])
      gaps = [
        ...match.gaps,
        ...match.matched.filter(s => s.levelGap > 0).map(s => ({
          canonicalId: s.canonicalId,
          skillName: s.skillName,
          requiredLevel: s.requiredLevel,
          requirement: s.requirement,
        })),
      ]
      roleLabel = role.title
      analysedAt = match.calculatedAt
    }
  }

  if (!gaps?.length) {
    return res.json({
      recommendations: [],
      count:    0,
      message:  'No gap analysis found. Run a gap analysis first via POST /api/match/gap or set a target role.',
    })
  }

  const recommendations = await recommendForGaps(gaps, {
    limit, minRelevance, prioritizeCritical,
  })

  res.json({
    recommendations,
    count:      recommendations.length,
    targetRole: roleLabel,
    basedOnGapAnalysisAt: analysedAt,
    scoring: { weights: SCORING_WEIGHTS },
  })
}))

// ─── GET ONE ──────────────────────────────────────────────────────────────────
router.get('/:id', asyncHandler(async (req, res) => {
  const doc = await getDatabase().collection('recommendations').findOne({ _id: req.params.id })
  if (!doc) throw notFound()

  const isOwn = doc.recipientId === req.user.id || doc.generatedBy === req.user.id
  if (!isOwn && req.user.role !== 'government')
    throw forbidden('You do not have access to this recommendation')

  // Auto-mark as viewed
  if (doc.status === 'pending') {
    await getDatabase().collection('recommendations').updateOne(
      { _id: doc._id },
      { $set: { status: 'viewed', viewedAt: new Date(), updatedAt: new Date() } },
    )
    doc.status   = 'viewed'
    doc.viewedAt = new Date()
  }

  res.json({ recommendation: pub(doc) })
}))

// ─── UPDATE STATUS ────────────────────────────────────────────────────────────
/**
 * PATCH /api/recommendations/:id/status
 * Body: { status: viewed | enrolled | dismissed | completed }
 */
router.patch('/:id/status', asyncHandler(async (req, res) => {
  const { status } = req.body
  if (!status) throw bad('status is required')
  if (!VALID_STATUSES.includes(status)) throw bad(`status must be one of: ${VALID_STATUSES.join(', ')}`)

  const doc = await getDatabase().collection('recommendations').findOne({ _id: req.params.id })
  if (!doc) throw notFound()

  const isOwn = doc.recipientId === req.user.id || doc.generatedBy === req.user.id
  if (!isOwn && req.user.role !== 'government')
    throw forbidden('You do not have access to this recommendation')

  const now    = new Date()
  const update = { status, updatedAt: now }
  if (status === 'viewed'    && !doc.viewedAt)   update.viewedAt    = now
  if (status === 'enrolled')                      update.enrolledAt  = now
  if (status === 'completed')                     update.completedAt = now

  const result = await getDatabase().collection('recommendations').findOneAndUpdate(
    { _id: req.params.id }, { $set: update }, { returnDocument: 'after' },
  )
  res.json({ recommendation: pub(result) })
}))

export default router
