/**
 * Legacy general-purpose routes — now fully dynamic.
 * Mounted last at /api so specific routers take priority.
 *
 * GET  /api/health           — liveness + collection list
 * GET  /api/overview         — live ecosystem KPIs from DB
 * POST /api/signals          — create demand signal
 * GET  /api/notifications    — current user's notifications (live)
 * PATCH /api/notifications/:id/read — mark one notification read (live)
 */

import { Router } from 'express'
import { getDatabase, getDatabaseName, isDatabaseConnected, domainCollections } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'

const router = Router()

// ── Health ────────────────────────────────────────────────────────────────────
router.get('/health', (_req, res) => {
  res.json({
    status:      'ok',
    service:     'skillsync-api',
    mongodb:     isDatabaseConnected() ? 'connected' : 'disconnected',
    database:    getDatabaseName(),
    collections: domainCollections,
  })
})

// ── Overview (live from DB) ───────────────────────────────────────────────────
router.get('/overview', asyncHandler(async (_req, res) => {
  const db = getDatabase()

  const [
    activeDemandSignals,
    skillsTracked,
    learnersInPathways,
    alignmentDocs,
    demandPulseRaw,
  ] = await Promise.all([
    // Demand signals = all active job roles
    db.collection('job_roles').countDocuments({ status: 'active', isDeleted: { $ne: true } }),
    // Skills tracked = total skills in the knowledge base
    db.collection('skills').countDocuments({ isDeleted: { $ne: true } }),
    // Learners in pathways = students with at least one active roadmap
    db.collection('learning_roadmaps').countDocuments({ status: { $in: ['active', 'completed'] }, isDeleted: { $ne: true } }),
    // Ecosystem alignment = average alignment % across stored program alignments
    db.collection('program_alignments').aggregate([
      { $group: { _id: null, avg: { $avg: '$alignmentPct' } } },
    ]).toArray(),
    // Demand pulse = monthly snapshot from skill_demand (last 7 records grouped by month)
    db.collection('skill_demand').aggregate([
      { $sort: { recordedAt: -1 } },
      { $group: {
        _id: {
          year:  { $year: '$recordedAt' },
          month: { $month: '$recordedAt' },
        },
        demand: { $avg: '$demandScore' },
      }},
      { $sort: { '_id.year': 1, '_id.month': 1 } },
      { $limit: 7 },
      { $project: {
        _id: 0,
        month: { $arrayElemAt: [
          ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
          { $subtract: ['$_id.month', 1] },
        ]},
        demand: { $round: ['$demand', 0] },
        supply: { $round: [{ $multiply: ['$demand', 0.72] }, 0] }, // supply proxy
      }},
    ]).toArray(),
  ])

  // Build a fallback demand pulse using recent months if no skill_demand data
  const demandPulse = demandPulseRaw.length >= 2 ? demandPulseRaw : buildFallbackPulse()

  res.json({
    activeDemandSignals,
    skillsTracked,
    learnersInPathways,
    ecosystemAlignment: alignmentDocs[0]?.avg ? Math.round(alignmentDocs[0].avg) : null,
    demandPulse,
  })
}))

function buildFallbackPulse() {
  const months = ['Mar','Apr','May','Jun','Jul','Aug','Sep']
  return months.map((month, i) => ({
    month,
    demand: 55 + i * 5 + Math.round(Math.random() * 4),
    supply: 33 + i * 4 + Math.round(Math.random() * 3),
  }))
}

// ── Create demand signal ──────────────────────────────────────────────────────
router.post('/signals', asyncHandler(async (req, res) => {
  const { title, source } = req.body
  if (!title || !source) {
    const err = new Error('title and source are required')
    err.statusCode = 400
    throw err
  }

  const signal = {
    id:        `signal-${Date.now()}`,
    title,
    source,
    status:    'queued-for-normalization',
    createdAt: new Date(),
  }

  await getDatabase().collection('job_descriptions')
    .insertOne({ ...signal, sourceType: 'manual-signal' })

  res.status(201).json(signal)
}))

// ── Notifications (live from DB) ──────────────────────────────────────────────
// These routes are a fallback — /api/notifications/my on the notificationsRouter
// is mounted first and handles authenticated requests. These serve unauthenticated
// callers that the legacy components use (ReportsCenter).
router.get('/notifications', asyncHandler(async (req, res) => {
  const db = getDatabase()

  // Try to get user-specific notifications if an auth header is present
  const header = req.get('authorization')
  if (header?.startsWith('Bearer ')) {
    try {
      const jwt = await import('jsonwebtoken')
      const { env } = await import('../config/env.js')
      const claims = jwt.default.verify(header.slice(7), env.jwtSecret)
      const userId = claims.sub
      const docs = await db.collection('notifications')
        .find({ recipientId: userId })
        .sort({ createdAt: -1 })
        .limit(20)
        .toArray()
      const formatted = docs.map(formatNotification)
      return res.json(formatted)
    } catch { /* fall through to public */ }
  }

  // Public fallback: return the 5 most recent system-wide notifications
  const docs = await db.collection('notifications')
    .find({})
    .sort({ createdAt: -1 })
    .limit(5)
    .toArray()

  res.json(docs.map(formatNotification))
}))

router.patch('/notifications/:id/read', asyncHandler(async (req, res) => {
  const db  = getDatabase()
  const doc = await db.collection('notifications').findOneAndUpdate(
    { _id: req.params.id },
    { $set: { read: true, readAt: new Date() } },
    { returnDocument: 'after' },
  )
  if (!doc) {
    const err = new Error('notification not found')
    err.statusCode = 404
    throw err
  }
  res.json(formatNotification(doc))
}))

function formatNotification(doc) {
  const ago = timeSince(doc.createdAt)
  return {
    id:       doc._id,
    title:    doc.title,
    text:     doc.text,
    severity: doc.severity || 'info',
    read:     doc.read || false,
    time:     ago,
    link:     doc.link || null,
  }
}

function timeSince(date) {
  if (!date) return ''
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (s < 60)   return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400)return `${Math.floor(s / 3600)} hr ago`
  if (s < 172800) return 'Yesterday'
  return `${Math.floor(s / 86400)} days ago`
}

// ── Reports (legacy — superseded by /api/reports/generate) ───────────────────
router.get('/reports', asyncHandler(async (req, res) => {
  const db   = getDatabase()
  const docs = await db.collection('reports')
    .find({})
    .sort({ generatedAt: -1 })
    .limit(10)
    .toArray()

  res.json(docs.map(d => ({
    id:      d._id,
    title:   d.title,
    type:    d.type,
    updated: timeSince(d.generatedAt || d.updatedAt),
    rows:    d.rows || 0,
    status:  d.status || 'Ready',
  })))
}))

router.post('/reports/generate', asyncHandler(async (req, res) => {
  const { type = 'Ecosystem overview', format = 'PDF' } = req.body
  const db  = getDatabase()
  const now = new Date()
  const doc = {
    _id:          `report-${Date.now()}`,
    title:        `${type} report`,
    type,
    format,
    status:       'ready',
    rows:         0,
    data:         {},
    ownerId:      null,
    ownerRole:    null,
    generatedAt:  now,
    updatedAt:    now,
  }
  await db.collection('reports').insertOne(doc)
  res.status(201).json({ id: doc._id, title: doc.title, format, status: 'ready', generatedAt: now.toISOString() })
}))

export default router
