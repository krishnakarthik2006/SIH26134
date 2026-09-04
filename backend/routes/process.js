/**
 * Phase B7 — Document Processing Routes
 * Mounted at /api/process
 *
 * Flow:
 *   Client POSTs content → Backend creates extraction_results record →
 *   Backend calls Python AI service → If AI available: stores result, returns 200
 *                                   → If AI unavailable: stores pending job, returns 202
 *
 * Endpoints:
 *   POST  /api/process/resume          — submit resume for skill extraction
 *   POST  /api/process/jd              — submit job description for skill extraction
 *   POST  /api/process/curriculum      — submit curriculum for skill extraction
 *   GET   /api/process/:jobId          — poll a specific extraction job
 *   POST  /api/process/:jobId/retry    — retry a pending/failed job
 *   GET   /api/process                 — list jobs submitted by the current user
 *   GET   /api/process/ai/health       — check AI service availability
 *
 * Job statuses:
 *   pending    — job queued, AI service was unavailable at submission time
 *   processing — job sent to AI service (transient, not stored)
 *   completed  — AI service responded with results
 *   failed     — AI service returned a 4xx hard error
 */

import { randomUUID } from 'node:crypto'
import { Router }     from 'express'
import { getDatabase }         from '../db.js'
import { asyncHandler }        from '../middleware/errorHandler.js'
import { requireAuth }         from '../middleware/auth.js'
import {
  extractResume,
  extractJobDescription,
  extractCurriculum,
  pingAiService,
} from '../services/aiService.js'

const router = Router()

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const bad     = (m) => Object.assign(new Error(m), { statusCode: 400 })
const notFound= (m = 'Extraction job not found') => Object.assign(new Error(m), { statusCode: 404 })
const forbidden=(m) => Object.assign(new Error(m), { statusCode: 403 })

function pub(doc) {
  if (!doc) return null
  const { _id, ...rest } = doc
  // Never expose raw content back to the client in list/poll responses
  const { content: _c, ...safe } = rest
  return { id: _id, ...safe }
}

const VALID_SOURCE_TYPES = ['resume', 'job_description', 'curriculum']

/** Build a base job document (before AI call) */
function makeJob({ sourceType, sourceId = null, content, metadata, userId }) {
  const now = new Date()
  return {
    _id:           randomUUID(),
    sourceType,
    sourceId,
    content,       // stored so retry has the text
    metadata,
    status:        'pending',
    submittedBy:   userId,
    extractedSkills: [],
    entities:      null,
    summary:       null,
    language:      null,
    wordCount:     null,
    modelVersion:  null,
    processingMs:  null,
    errorMessage:  null,
    createdAt:     now,
    updatedAt:     now,
    completedAt:   null,
  }
}

/** Apply AI result to a job document update */
function applyResult(aiData) {
  return {
    status:          'completed',
    extractedSkills: aiData.extractedSkills || [],
    entities:        aiData.entities        || null,
    summary:         aiData.summary         || null,
    language:        aiData.language        || null,
    wordCount:       aiData.wordCount       || null,
    modelVersion:    aiData.modelVersion    || null,
    processingMs:    aiData.processingMs    || null,
    errorMessage:    null,
    completedAt:     new Date(),
    updatedAt:       new Date(),
  }
}

/**
 * Core submission handler used by all three document types.
 * Creates the job doc, attempts AI call, updates doc, responds.
 */
async function submitForExtraction({ res, job, extractFn, extractArgs }) {
  const col = getDatabase().collection('extraction_results')

  // Persist the job immediately so we always have a record
  await col.insertOne(job)

  // Attempt AI service call
  const result = await extractFn(extractArgs)

  if (result.available && result.data) {
    // ── Success ──────────────────────────────────────────────────────────────
    const update = applyResult(result.data)
    await col.updateOne({ _id: job._id }, { $set: update })
    const completed = await col.findOne({ _id: job._id })
    return res.status(200).json({
      status:  'completed',
      job:     pub(completed),
      message: 'Document processed successfully',
    })
  }

  if (result.available && result.error) {
    // ── Hard AI error (4xx from Python) ──────────────────────────────────────
    await col.updateOne({ _id: job._id }, {
      $set: { status: 'failed', errorMessage: result.error, updatedAt: new Date() },
    })
    const failed = await col.findOne({ _id: job._id })
    // Return 422 — client sent something the AI service cannot process
    const err = new Error(`AI processing failed: ${result.error}`)
    err.statusCode = 422
    // Still return the job so the client can see it
    return res.status(422).json({
      error:  err.message,
      status: 'failed',
      job:    pub(failed),
    })
  }

  // ── AI service unavailable — job stays pending ────────────────────────────
  await col.updateOne({ _id: job._id }, {
    $set: { errorMessage: result.error, updatedAt: new Date() },
  })
  return res.status(202).json({
    status:  'pending',
    job:     pub(job),
    message: 'AI service is currently unavailable. Job queued — use POST /api/process/:jobId/retry to process when the service is back.',
    retryUrl: `/api/process/${job._id}/retry`,
  })
}

// ─── ALL ROUTES REQUIRE AUTH ──────────────────────────────────────────────────
router.use(requireAuth)

// ─────────────────────────────────────────────────────────────────────────────
// AI SERVICE HEALTH  (declared before /:jobId to avoid param clash)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/process/ai/health
 * Returns liveness of the Python AI microservice.
 */
router.get('/ai/health', asyncHandler(async (_req, res) => {
  const result = await pingAiService()
  res.status(result.alive ? 200 : 503).json({
    aiService: result.alive ? 'available' : 'unavailable',
    latencyMs: result.latencyMs,
    error:     result.error || null,
  })
}))

// ─────────────────────────────────────────────────────────────────────────────
// LIST JOBS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/process
 * Returns extraction jobs submitted by the current user.
 * Query: sourceType, status, page, limit
 */
router.get('/', asyncHandler(async (req, res) => {
  const { sourceType, status, page: pg = '1', limit: lm = '20' } = req.query
  const page  = Math.max(1, parseInt(pg, 10)  || 1)
  const limit = Math.min(50, Math.max(1, parseInt(lm, 10) || 20))
  const skip  = (page - 1) * limit

  const filter = { submittedBy: req.user.id }
  if (sourceType && VALID_SOURCE_TYPES.includes(sourceType)) filter.sourceType = sourceType
  if (status)     filter.status = status

  const col   = getDatabase().collection('extraction_results')
  const total = await col.countDocuments(filter)
  const docs  = await col.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray()

  res.json({
    jobs:       docs.map(pub),
    pagination: { total, page, limit, pages: Math.ceil(total / limit) },
  })
}))

// ─────────────────────────────────────────────────────────────────────────────
// SUBMIT — RESUME
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/process/resume
 * Body:
 *   content*      — plain text of the resume (≥ 50 chars)
 *   sourceId      — UUID of the student/user profile document (optional)
 *   candidateName — name hint for the AI service (optional)
 *   targetRole    — desired job role (optional)
 */
router.post('/resume', asyncHandler(async (req, res) => {
  const { content, sourceId = null, candidateName = '', targetRole = '' } = req.body

  if (!content?.trim())         throw bad('content is required')
  if (content.trim().length < 50) throw bad('content must be at least 50 characters')

  const metadata = { candidateName, targetRole }
  const job      = makeJob({ sourceType: 'resume', sourceId, content: content.trim(), metadata, userId: req.user.id })

  await submitForExtraction({
    res, job,
    extractFn:   extractResume,
    extractArgs: { content: content.trim(), candidateName, targetRole, sourceId: sourceId || '' },
  })
}))

// ─────────────────────────────────────────────────────────────────────────────
// SUBMIT — JOB DESCRIPTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/process/jd
 * Body:
 *   content*    — plain text of the job description (≥ 50 chars)
 *   sourceId    — UUID of the job_roles document (optional)
 *   jobTitle    — title hint (optional)
 *   industryId  — UUID of industry (optional)
 */
router.post('/jd', asyncHandler(async (req, res) => {
  const { content, sourceId = null, jobTitle = '', industryId = '' } = req.body

  if (!content?.trim())           throw bad('content is required')
  if (content.trim().length < 50) throw bad('content must be at least 50 characters')

  const metadata = { jobTitle, industryId, jobRoleId: sourceId || '' }
  const job      = makeJob({ sourceType: 'job_description', sourceId, content: content.trim(), metadata, userId: req.user.id })

  await submitForExtraction({
    res, job,
    extractFn:   extractJobDescription,
    extractArgs: { content: content.trim(), jobTitle, industryId, jobRoleId: sourceId || '' },
  })
}))

// ─────────────────────────────────────────────────────────────────────────────
// SUBMIT — CURRICULUM
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/process/curriculum
 * Body:
 *   content*             — plain text of the curriculum (≥ 50 chars)
 *   sourceId             — UUID of the curriculums document (optional)
 *   programName          — program name hint (optional)
 *   trainingProgramId    — UUID of training_programs document (optional)
 */
router.post('/curriculum', asyncHandler(async (req, res) => {
  const { content, sourceId = null, programName = '', trainingProgramId = '' } = req.body

  if (!content?.trim())           throw bad('content is required')
  if (content.trim().length < 50) throw bad('content must be at least 50 characters')

  const metadata = { programName, trainingProgramId, curriculumId: sourceId || '' }
  const job      = makeJob({ sourceType: 'curriculum', sourceId, content: content.trim(), metadata, userId: req.user.id })

  await submitForExtraction({
    res, job,
    extractFn:   extractCurriculum,
    extractArgs: { content: content.trim(), programName, trainingProgramId, curriculumId: sourceId || '' },
  })
}))

// ─────────────────────────────────────────────────────────────────────────────
// POLL — GET ONE JOB
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/process/:jobId
 * Returns the full extraction job (without raw content).
 * Only the submitter or a government user can view.
 */
router.get('/:jobId', asyncHandler(async (req, res) => {
  const doc = await getDatabase().collection('extraction_results')
    .findOne({ _id: req.params.jobId })
  if (!doc) throw notFound()

  if (doc.submittedBy !== req.user.id && req.user.role !== 'government')
    throw forbidden('You do not have access to this extraction job')

  res.json({ job: pub(doc) })
}))

// ─────────────────────────────────────────────────────────────────────────────
// RETRY — RE-SEND PENDING/FAILED JOB TO AI SERVICE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/process/:jobId/retry
 * Re-attempts AI processing for a pending or failed job.
 * Only the original submitter or government may retry.
 */
router.post('/:jobId/retry', asyncHandler(async (req, res) => {
  const col = getDatabase().collection('extraction_results')
  const doc = await col.findOne({ _id: req.params.jobId })
  if (!doc) throw notFound()

  if (doc.submittedBy !== req.user.id && req.user.role !== 'government')
    throw forbidden('You do not have access to this extraction job')

  if (doc.status === 'completed') {
    return res.status(200).json({
      status:  'completed',
      job:     pub(doc),
      message: 'Job is already completed — no retry needed',
    })
  }

  if (!['pending', 'failed'].includes(doc.status)) {
    const err = new Error(`Cannot retry a job with status "${doc.status}"`)
    err.statusCode = 409
    throw err
  }

  // Reset to pending before retry
  await col.updateOne({ _id: doc._id }, {
    $set: { status: 'pending', errorMessage: null, updatedAt: new Date() },
  })

  // Select the right extractor
  const extractorMap = {
    resume:          { fn: extractResume,          args: { content: doc.content, ...doc.metadata } },
    job_description: { fn: extractJobDescription,  args: { content: doc.content, ...doc.metadata } },
    curriculum:      { fn: extractCurriculum,      args: { content: doc.content, ...doc.metadata } },
  }
  const extractor = extractorMap[doc.sourceType]
  if (!extractor) throw bad(`Unknown sourceType "${doc.sourceType}"`)

  const result = await extractor.fn(extractor.args)

  if (result.available && result.data) {
    const update = applyResult(result.data)
    await col.updateOne({ _id: doc._id }, { $set: update })
    const completed = await col.findOne({ _id: doc._id })
    return res.status(200).json({
      status:  'completed',
      job:     pub(completed),
      message: 'Retry succeeded — document processed successfully',
    })
  }

  if (result.available && result.error) {
    await col.updateOne({ _id: doc._id }, {
      $set: { status: 'failed', errorMessage: result.error, updatedAt: new Date() },
    })
    const failed = await col.findOne({ _id: doc._id })
    return res.status(422).json({
      error:  `AI processing failed: ${result.error}`,
      status: 'failed',
      job:    pub(failed),
    })
  }

  // Still unavailable
  await col.updateOne({ _id: doc._id }, {
    $set: { errorMessage: result.error, updatedAt: new Date() },
  })
  return res.status(202).json({
    status:  'pending',
    job:     pub(await col.findOne({ _id: doc._id })),
    message: 'AI service still unavailable. Try again later.',
    retryUrl: `/api/process/${doc._id}/retry`,
  })
}))

export default router
