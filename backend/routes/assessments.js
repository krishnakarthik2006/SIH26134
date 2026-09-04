/**
 * B16 — Assessments & Continuous Feedback
 * Mounted at /api/assessments
 *
 * POST /api/assessments                          — create assessment (training/govt)
 * GET  /api/assessments                          — list assessments (public)
 * GET  /api/assessments/:id                      — get one
 * PATCH /api/assessments/:id                     — update (owner/govt)
 * DELETE /api/assessments/:id                    — soft-delete (govt)
 *
 * POST /api/assessments/:id/attempt              — submit attempt (learner)
 * GET  /api/assessments/:id/attempts             — list attempts (owner/admin)
 * GET  /api/assessments/my/attempts              — learner's own attempts
 * POST /api/assessments/:id/attempt/:attemptId/grade  — grade attempt (training/govt)
 *
 * GET  /api/assessments/skill/:skillId           — assessments for a skill
 */

import { randomUUID }   from 'node:crypto'
import { Router }       from 'express'
import { getDatabase }  from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { computeAndPersistGap } from '../services/matcher.js'

const router = Router()
router.use(requireAuth)

const bad      = (m) => Object.assign(new Error(m), { statusCode: 400 })
const notFound = (m = 'Not found') => Object.assign(new Error(m), { statusCode: 404 })
const TYPES    = ['quiz','practical','project','mock-interview','coding-challenge']
const LEVELS   = ['beginner','intermediate','advanced','expert']
function pub(d) { if (!d) return null; const { _id, ...r } = d; return { id: _id, ...r } }

// ── Create assessment ─────────────────────────────────────────────────────────
router.post('/', requireRole('training', 'government'), asyncHandler(async (req, res) => {
  const {
    title, skillId, skillName, type = 'quiz', level,
    description = '', questions = [], passingScore = 70,
    durationMinutes, programId, tags = [],
  } = req.body

  if (!title?.trim()) throw bad('title is required')
  if (!type || !TYPES.includes(type)) throw bad(`type must be one of: ${TYPES.join(', ')}`)
  if (level && !LEVELS.includes(level)) throw bad(`level must be one of: ${LEVELS.join(', ')}`)
  if (!Array.isArray(questions)) throw bad('questions must be an array')
  if (typeof passingScore !== 'number' || passingScore < 0 || passingScore > 100)
    throw bad('passingScore must be 0-100')

  // Validate skill reference
  if (skillId) {
    const sk = await getDatabase().collection('skills').findOne({ _id: skillId, isDeleted: { $ne: true } })
    if (!sk) throw bad(`skillId "${skillId}" not found`)
  }

  const now = new Date()
  const doc = {
    _id: randomUUID(), title: title.trim(), skillId: skillId || null, skillName: skillName || null,
    type, level: level || null, description, questions,
    totalQuestions: questions.length, passingScore, durationMinutes: durationMinutes || null,
    programId: programId || null, tags: tags.map(t => t.toLowerCase()),
    isDeleted: false, createdBy: req.user.id, createdAt: now, updatedAt: now,
  }
  await getDatabase().collection('assessments').insertOne(doc)
  res.status(201).json({ assessment: pub(doc) })
}))

// ── List ──────────────────────────────────────────────────────────────────────
router.get('/', asyncHandler(async (req, res) => {
  const { skillId, type, level, page: pg = '1', limit: lm = '20' } = req.query
  const page  = Math.max(1, parseInt(pg) || 1)
  const limit = Math.min(50, Math.max(1, parseInt(lm) || 20))
  const filter = { isDeleted: { $ne: true } }
  if (skillId) filter.skillId = skillId
  if (type)    filter.type    = type
  if (level)   filter.level   = level

  const col   = getDatabase().collection('assessments')
  const total = await col.countDocuments(filter)
  const docs  = await col.find(filter, { projection: { questions: 0 } })
    .sort({ createdAt: -1 }).skip((page-1)*limit).limit(limit).toArray()
  res.json({ assessments: docs.map(pub), pagination: { total, page, limit, pages: Math.ceil(total/limit) } })
}))

router.get('/skill/:skillId', asyncHandler(async (req, res) => {
  const docs = await getDatabase().collection('assessments')
    .find({ skillId: req.params.skillId, isDeleted: { $ne: true } }, { projection: { questions: 0 } })
    .sort({ level: 1 }).toArray()
  res.json({ assessments: docs.map(pub), count: docs.length })
}))

// ── Get one (exclude answers from questions) ──────────────────────────────────
router.get('/my/attempts', asyncHandler(async (req, res) => {
  const { page: pg = '1', limit: lm = '20' } = req.query
  const page  = Math.max(1, parseInt(pg) || 1)
  const limit = Math.min(50, Math.max(1, parseInt(lm) || 20))
  const col   = getDatabase().collection('assessment_attempts')
  const total = await col.countDocuments({ studentId: req.user.id })
  const docs  = await col.find({ studentId: req.user.id })
    .sort({ submittedAt: -1 }).skip((page-1)*limit).limit(limit).toArray()
  res.json({ attempts: docs.map(pub), pagination: { total, page, limit, pages: Math.ceil(total/limit) } })
}))

router.get('/:id', asyncHandler(async (req, res) => {
  const doc = await getDatabase().collection('assessments').findOne({ _id: req.params.id, isDeleted: { $ne: true } })
  if (!doc) throw notFound('Assessment not found')
  // Strip correct answers from questions for learners
  const safe = req.user.role === 'learner'
    ? { ...doc, questions: (doc.questions || []).map(q => { const { correctAnswer, ...rest } = q; return rest }) }
    : doc
  res.json({ assessment: pub(safe) })
}))

// ── Update ────────────────────────────────────────────────────────────────────
router.patch('/:id', requireRole('training', 'government'), asyncHandler(async (req, res) => {
  const doc = await getDatabase().collection('assessments').findOne({ _id: req.params.id, isDeleted: { $ne: true } })
  if (!doc) throw notFound('Assessment not found')
  if (doc.createdBy !== req.user.id && req.user.role !== 'government')
    throw Object.assign(new Error('Access denied'), { statusCode: 403 })

  const allowed = ['title', 'description', 'questions', 'passingScore', 'durationMinutes', 'tags', 'level', 'type']
  const update  = {}
  for (const f of allowed) if (Object.prototype.hasOwnProperty.call(req.body, f)) update[f] = req.body[f]
  if (!Object.keys(update).length) throw bad('No valid fields provided')
  if (update.type && !TYPES.includes(update.type)) throw bad(`type must be one of: ${TYPES.join(', ')}`)
  if (update.level && !LEVELS.includes(update.level)) throw bad(`level must be one of: ${LEVELS.join(', ')}`)
  if (update.questions) update.totalQuestions = update.questions.length
  if (update.tags) update.tags = update.tags.map(t => t.toLowerCase())
  update.updatedAt = new Date()

  const result = await getDatabase().collection('assessments').findOneAndUpdate(
    { _id: req.params.id }, { $set: update }, { returnDocument: 'after' },
  )
  res.json({ assessment: pub(result) })
}))

// ── Delete ────────────────────────────────────────────────────────────────────
router.delete('/:id', requireRole('government'), asyncHandler(async (req, res) => {
  const doc = await getDatabase().collection('assessments').findOne({ _id: req.params.id, isDeleted: { $ne: true } })
  if (!doc) throw notFound('Assessment not found')
  await getDatabase().collection('assessments').updateOne(
    { _id: req.params.id },
    { $set: { isDeleted: true, deletedAt: new Date(), updatedAt: new Date() } },
  )
  res.json({ message: 'Assessment deleted', id: req.params.id })
}))

// ── Attempts ──────────────────────────────────────────────────────────────────
router.post('/:id/attempt', requireRole('learner'), asyncHandler(async (req, res) => {
  const assessment = await getDatabase().collection('assessments').findOne({ _id: req.params.id, isDeleted: { $ne: true } })
  if (!assessment) throw notFound('Assessment not found')

  const { answers = [], timeTakenMinutes } = req.body
  if (!Array.isArray(answers)) throw bad('answers must be an array')

  // Auto-grade if questions have correctAnswer
  let score = null; let passed = null; let feedback = []
  const questions = assessment.questions || []
  if (questions.length > 0 && questions.every(q => q.correctAnswer !== undefined)) {
    let correct = 0
    feedback = questions.map((q, i) => {
      const given   = answers[i]?.answer
      const isRight = given === q.correctAnswer
      if (isRight) correct++
      return { questionId: q.questionId || i, correct: isRight, given, expected: q.correctAnswer }
    })
    score  = Math.round((correct / questions.length) * 100)
    passed = score >= (assessment.passingScore || 70)
  }

  const now = new Date()
  const doc = {
    _id: randomUUID(), assessmentId: req.params.id, assessmentTitle: assessment.title,
    skillId: assessment.skillId || null, skillName: assessment.skillName || null,
    studentId: req.user.id, answers, score, passed, feedback,
    timeTakenMinutes: timeTakenMinutes || null, gradedBy: score !== null ? 'auto' : null,
    status: score !== null ? 'graded' : 'submitted',
    submittedAt: now, completedAt: score !== null ? now : null, updatedAt: now,
  }
  await getDatabase().collection('assessment_attempts').insertOne(doc)

  // If passed and skill linked — update learner proficiency + recalculate readiness
  if (passed && assessment.skillId) {
    await updateLearnerProficiency(req.user.id, assessment.skillId, assessment.level)
  }

  res.status(201).json({ attempt: pub(doc) })
}))

router.get('/:id/attempts', requireRole('training', 'government'), asyncHandler(async (req, res) => {
  const { page: pg = '1', limit: lm = '20' } = req.query
  const page  = Math.max(1, parseInt(pg) || 1)
  const limit = Math.min(50, Math.max(1, parseInt(lm) || 20))
  const col   = getDatabase().collection('assessment_attempts')
  const total = await col.countDocuments({ assessmentId: req.params.id })
  const docs  = await col.find({ assessmentId: req.params.id })
    .sort({ submittedAt: -1 }).skip((page-1)*limit).limit(limit).toArray()
  res.json({ attempts: docs.map(pub), pagination: { total, page, limit, pages: Math.ceil(total/limit) } })
}))

router.post('/:id/attempt/:attemptId/grade', requireRole('training', 'government'), asyncHandler(async (req, res) => {
  const { score, passed, notes = '', feedback = [] } = req.body
  if (typeof score !== 'number' || score < 0 || score > 100) throw bad('score must be 0-100')

  const attempt = await getDatabase().collection('assessment_attempts')
    .findOne({ _id: req.params.attemptId, assessmentId: req.params.id })
  if (!attempt) throw notFound('Attempt not found')

  const now    = new Date()
  const result = await getDatabase().collection('assessment_attempts').findOneAndUpdate(
    { _id: req.params.attemptId },
    { $set: { score, passed: passed ?? (score >= 70), feedback, notes, gradedBy: req.user.id, gradedAt: now, status: 'graded', completedAt: now, updatedAt: now } },
    { returnDocument: 'after' },
  )

  // Update learner proficiency if passed
  const assessment = await getDatabase().collection('assessments').findOne({ _id: req.params.id })
  if ((passed ?? score >= 70) && assessment?.skillId) {
    await updateLearnerProficiency(attempt.studentId, assessment.skillId, assessment.level)
  }

  res.json({ attempt: pub(result) })
}))

// ── Proficiency update helper ─────────────────────────────────────────────────
async function updateLearnerProficiency(userId, skillId, achievedLevel) {
  if (!userId || !skillId) return
  const db = getDatabase()

  const student = await db.collection('students').findOne({ userId })
  if (!student) return

  // Update or add the skill in currentSkills
  const currentSkills = student.currentSkills || []
  const idx = currentSkills.findIndex(s => s.skillId === skillId)
  const now = new Date()

  if (idx >= 0) {
    const LEVELS_ORDER = ['beginner','intermediate','advanced','expert']
    const current = LEVELS_ORDER.indexOf(currentSkills[idx].level || 'beginner')
    const achieved = LEVELS_ORDER.indexOf(achievedLevel || 'beginner')
    if (achieved > current) currentSkills[idx].level = achievedLevel
  } else {
    const skill = await db.collection('skills').findOne({ _id: skillId })
    currentSkills.push({ skillId, skillName: skill?.name || skillId, level: achievedLevel || 'beginner' })
  }

  await db.collection('students').updateOne(
    { userId }, { $set: { currentSkills, updatedAt: now } },
  )

  // Recalculate readiness if student has a target role
  if (student.targetJobRoleId) {
    const role = await db.collection('job_roles')
      .findOne({ _id: student.targetJobRoleId, isDeleted: { $ne: true } })
    if (role?.requiredSkills?.length) {
      try {
        await computeAndPersistGap({
          subjectType: 'learner',
          subjectId:   userId,
          targetRole:  role.title,
          jobRoleId:   role._id,
          requiredSkills: role.requiredSkills,
          currentSkills,
          computedBy:  'assessment-auto',
        })
      } catch { /* non-blocking */ }
    }
  }
}

export default router
