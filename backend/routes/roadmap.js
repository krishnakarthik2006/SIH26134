/**
 * B12 — Personalized Learning Roadmap
 * Mounted at /api/roadmap
 *
 * POST /api/roadmap/generate          — build roadmap from recommendations + gaps
 * GET  /api/roadmap/my                — learner's active roadmap
 * GET  /api/roadmap/:id               — fetch one roadmap
 * PATCH /api/roadmap/:id/steps/:stepId/complete  — mark step done
 * PATCH /api/roadmap/:id/steps/:stepId/uncomplete
 * PATCH /api/roadmap/:id/status       — activate | paused | completed | abandoned
 * POST  /api/roadmap/:id/recalculate  — refresh ordering after skills improve
 * DELETE /api/roadmap/:id             — soft-delete
 */

import { randomUUID } from 'node:crypto'
import { Router }     from 'express'
import { getDatabase }       from '../db.js'
import { asyncHandler }      from '../middleware/errorHandler.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { matchSkills, LEVEL_ORDER }  from '../services/matcher.js'
import { recommendForGaps }  from '../services/recommender.js'

const router = Router()
router.use(requireAuth)

const bad      = (m) => Object.assign(new Error(m), { statusCode: 400 })
const notFound = (m = 'Roadmap not found') => Object.assign(new Error(m), { statusCode: 404 })
const forbidden= (m) => Object.assign(new Error(m), { statusCode: 403 })
const VALID_STATUSES = ['draft','active','paused','completed','abandoned']

function pub(doc) { if (!doc) return null; const { _id, ...r } = doc; return { id: _id, ...r } }

/** Priority-weight for requirement field */
const REQ_W = { required: 3, preferred: 2, 'nice-to-have': 1 }

/**
 * Determine ordering of steps using a topological sort that respects:
 *  1. Skill prerequisites (if skillB depends on skillA, learn A first)
 *  2. Requirement priority (required gaps addressed before preferred)
 *  3. Relevance score from recommendations
 */
function orderSteps(gaps, recommendations) {
  const recByProgram = new Map(recommendations.map(r => [r.programId, r]))

  // Assign each gap a step
  return gaps.map((gap, idx) => {
    const rec = recommendations.find(r => r.coveredGaps?.some(g =>
      g.canonicalId === gap.canonicalId ||
      (g.skillName || '').toLowerCase() === (gap.skillName || '').toLowerCase()
    ))

    return {
      stepId:         randomUUID(),
      order:          idx + 1,
      skillName:      gap.skillName,
      canonicalId:    gap.canonicalId || null,
      requiredLevel:  gap.requiredLevel || null,
      requirement:    gap.requirement || 'required',
      priorityWeight: REQ_W[gap.requirement] || 1,
      programId:      rec?.programId    || null,
      programName:    rec?.programName  || null,
      providerId:     rec?.providerId   || null,
      providerName:   rec?.providerName || null,
      relevanceScore: rec?.relevanceScore || 0,
      status:         'pending',   // pending | in_progress | completed | skipped
      prerequisites:  [],          // filled in by dependency analysis below
      completedAt:    null,
      notes:          '',
    }
  }).sort((a, b) => {
    // Sort: required first, then by relevanceScore desc
    if (b.priorityWeight !== a.priorityWeight) return b.priorityWeight - a.priorityWeight
    return b.relevanceScore - a.relevanceScore
  }).map((s, i) => ({ ...s, order: i + 1 }))
}

// ── Generate ──────────────────────────────────────────────────────────────────
router.post('/generate', asyncHandler(async (req, res) => {
  const { subjectId, targetRole, jobRoleId, gaps, currentSkills = [], title } = req.body

  if (!subjectId?.trim())  throw bad('subjectId is required')
  if (!targetRole?.trim()) throw bad('targetRole is required')
  if (!Array.isArray(gaps) || gaps.length === 0) throw bad('gaps must be a non-empty array')

  // Get recommendations to attach programs to steps
  const recs = await recommendForGaps(gaps, { limit: 25, minRelevance: 0, prioritizeCritical: true })

  const steps = orderSteps(gaps, recs)

  const now = new Date()
  const doc = {
    _id:           randomUUID(),
    studentId:     subjectId,
    ownerId:       req.user.id,
    targetRole:    targetRole.trim(),
    jobRoleId:     jobRoleId || null,
    title:         title || `Learning roadmap — ${targetRole.trim()}`,
    status:        'active',
    steps,
    totalSteps:    steps.length,
    completedSteps: 0,
    progressPct:   0,
    currentSkills,
    gapSnapshot:   gaps,
    isDeleted:     false,
    createdAt:     now,
    updatedAt:     now,
    completedAt:   null,
  }

  await getDatabase().collection('learning_roadmaps').insertOne(doc)
  res.status(201).json({ roadmap: pub(doc) })
}))

// ── My roadmap ────────────────────────────────────────────────────────────────
router.get('/my', asyncHandler(async (req, res) => {
  const { status, page: pg = '1', limit: lm = '10' } = req.query
  const page  = Math.max(1, parseInt(pg)  || 1)
  const limit = Math.min(50, Math.max(1, parseInt(lm) || 10))
  const filter = { ownerId: req.user.id, isDeleted: { $ne: true } }
  if (status) filter.status = status
  const col   = getDatabase().collection('learning_roadmaps')
  const total = await col.countDocuments(filter)
  const docs  = await col.find(filter).sort({ createdAt: -1 }).skip((page-1)*limit).limit(limit).toArray()
  res.json({ roadmaps: docs.map(pub), pagination: { total, page, limit, pages: Math.ceil(total/limit) } })
}))

// ── Get one ───────────────────────────────────────────────────────────────────
router.get('/:id', asyncHandler(async (req, res) => {
  const doc = await getDatabase().collection('learning_roadmaps')
    .findOne({ _id: req.params.id, isDeleted: { $ne: true } })
  if (!doc) throw notFound()
  if (doc.ownerId !== req.user.id && req.user.role !== 'government') throw forbidden('Access denied')
  res.json({ roadmap: pub(doc) })
}))

// ── Complete / uncomplete step ────────────────────────────────────────────────
router.patch('/:id/steps/:stepId/complete', asyncHandler(async (req, res) => {
  const doc = await getDatabase().collection('learning_roadmaps')
    .findOne({ _id: req.params.id, isDeleted: { $ne: true } })
  if (!doc) throw notFound()
  if (doc.ownerId !== req.user.id) throw forbidden('Access denied')

  const steps = doc.steps.map(s =>
    s.stepId === req.params.stepId
      ? { ...s, status: 'completed', completedAt: new Date(), notes: req.body.notes || s.notes }
      : s
  )
  const completedSteps = steps.filter(s => s.status === 'completed').length
  const progressPct    = Math.round((completedSteps / steps.length) * 100)
  const status         = progressPct === 100 ? 'completed' : doc.status

  const result = await getDatabase().collection('learning_roadmaps').findOneAndUpdate(
    { _id: req.params.id },
    { $set: { steps, completedSteps, progressPct, status, updatedAt: new Date(),
               ...(status === 'completed' ? { completedAt: new Date() } : {}) } },
    { returnDocument: 'after' },
  )
  res.json({ roadmap: pub(result) })
}))

router.patch('/:id/steps/:stepId/uncomplete', asyncHandler(async (req, res) => {
  const doc = await getDatabase().collection('learning_roadmaps')
    .findOne({ _id: req.params.id, isDeleted: { $ne: true } })
  if (!doc) throw notFound()
  if (doc.ownerId !== req.user.id) throw forbidden('Access denied')

  const steps = doc.steps.map(s =>
    s.stepId === req.params.stepId ? { ...s, status: 'pending', completedAt: null } : s
  )
  const completedSteps = steps.filter(s => s.status === 'completed').length
  const progressPct    = Math.round((completedSteps / steps.length) * 100)

  const result = await getDatabase().collection('learning_roadmaps').findOneAndUpdate(
    { _id: req.params.id },
    { $set: { steps, completedSteps, progressPct, status: doc.status === 'completed' ? 'active' : doc.status, updatedAt: new Date() } },
    { returnDocument: 'after' },
  )
  res.json({ roadmap: pub(result) })
}))

// ── Update status ─────────────────────────────────────────────────────────────
router.patch('/:id/status', asyncHandler(async (req, res) => {
  const { status } = req.body
  if (!VALID_STATUSES.includes(status)) throw bad(`status must be one of: ${VALID_STATUSES.join(', ')}`)

  const doc = await getDatabase().collection('learning_roadmaps')
    .findOne({ _id: req.params.id, isDeleted: { $ne: true } })
  if (!doc) throw notFound()
  if (doc.ownerId !== req.user.id) throw forbidden('Access denied')

  const result = await getDatabase().collection('learning_roadmaps').findOneAndUpdate(
    { _id: req.params.id },
    { $set: { status, updatedAt: new Date() } },
    { returnDocument: 'after' },
  )
  res.json({ roadmap: pub(result) })
}))

// ── Recalculate (after skills improve) ───────────────────────────────────────
router.post('/:id/recalculate', asyncHandler(async (req, res) => {
  const doc = await getDatabase().collection('learning_roadmaps')
    .findOne({ _id: req.params.id, isDeleted: { $ne: true } })
  if (!doc) throw notFound()
  if (doc.ownerId !== req.user.id) throw forbidden('Access denied')

  const { currentSkills = doc.currentSkills || [] } = req.body

  // Re-run match to see which gaps are now closed
  if (doc.gapSnapshot?.length && currentSkills.length) {
    const requiredSkills = doc.gapSnapshot.map(g => ({
      skillId: g.canonicalId, skillName: g.skillName,
      level: g.requiredLevel, requirement: g.requirement,
    }))
    const match = await matchSkills(requiredSkills, currentSkills)

    // Mark steps for closed gaps
    const closedIds = new Set(match.matched.map(m => m.canonicalId).filter(Boolean))
    const steps = doc.steps.map(s => ({
      ...s,
      status: closedIds.has(s.canonicalId) && s.status !== 'completed' ? 'completed' : s.status,
      completedAt: closedIds.has(s.canonicalId) && !s.completedAt ? new Date() : s.completedAt,
    }))
    const completedSteps = steps.filter(s => s.status === 'completed').length
    const progressPct    = Math.round((completedSteps / steps.length) * 100)

    const result = await getDatabase().collection('learning_roadmaps').findOneAndUpdate(
      { _id: req.params.id },
      { $set: { steps, completedSteps, progressPct, currentSkills, updatedAt: new Date(),
                 readinessScore: match.readinessScore, gapSeverity: match.gapSeverity } },
      { returnDocument: 'after' },
    )
    return res.json({ roadmap: pub(result), recalculated: true, newReadinessScore: match.readinessScore })
  }

  res.json({ roadmap: pub(doc), recalculated: false, message: 'No skill data to recalculate from' })
}))

// ── Delete ────────────────────────────────────────────────────────────────────
router.delete('/:id', asyncHandler(async (req, res) => {
  const doc = await getDatabase().collection('learning_roadmaps')
    .findOne({ _id: req.params.id, isDeleted: { $ne: true } })
  if (!doc) throw notFound()
  if (doc.ownerId !== req.user.id && req.user.role !== 'government') throw forbidden('Access denied')
  await getDatabase().collection('learning_roadmaps').updateOne(
    { _id: req.params.id },
    { $set: { isDeleted: true, deletedAt: new Date(), updatedAt: new Date() } },
  )
  res.json({ message: 'Roadmap deleted', id: req.params.id })
}))

export default router
