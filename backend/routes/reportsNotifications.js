/**
 * B17 — Reports & Notifications
 * Mounted at /api/reports and /api/notifications (overrides the static ones in api.js)
 *
 * ── Reports (/api/reports) ───────────────────────────────────────────────────
 * GET  /api/reports/my                    — own reports
 * POST /api/reports/generate              — generate + persist a report
 * GET  /api/reports/:id                   — fetch one report
 * GET  /api/reports/:id/download          — download report data as JSON
 * DELETE /api/reports/:id                 — delete
 *
 * Report types:
 *   learner_progress | skill_gap | training_alignment | industry_demand |
 *   regional_intelligence | ecosystem_overview
 *
 * ── Notifications (/api/notifications) ───────────────────────────────────────
 * GET  /api/notifications/my              — own notifications
 * POST /api/notifications                 — create notification (internal/admin)
 * PATCH /api/notifications/:id/read       — mark read
 * PATCH /api/notifications/read-all       — mark all read
 * DELETE /api/notifications/:id           — delete
 */

import { randomUUID }   from 'node:crypto'
import { Router }       from 'express'
import { getDatabase }  from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

export const reportsRouter = buildReportsRouter()
export const notificationsRouter = buildNotificationsRouter()

function pub(d) { if (!d) return null; const { _id, ...r } = d; return { id: _id, ...r } }
const bad = (m) => Object.assign(new Error(m), { statusCode: 400 })

// ══════════════════════════════════════════════════════════════════════════════
// REPORTS
// ══════════════════════════════════════════════════════════════════════════════
function buildReportsRouter() {
  const router = Router()
  router.use(requireAuth)

  const REPORT_TYPES = ['learner_progress','skill_gap','training_alignment','industry_demand','regional_intelligence','ecosystem_overview']

  // ── Generate ────────────────────────────────────────────────────────────────
  router.post('/generate', asyncHandler(async (req, res) => {
    const {
      type = 'ecosystem_overview', format = 'json', title,
      subjectId, subjectType, targetRole, filters = {},
    } = req.body

    if (!REPORT_TYPES.includes(type)) throw bad(`type must be one of: ${REPORT_TYPES.join(', ')}`)

    const db  = getDatabase()
    const now = new Date()

    // Build report data based on type
    let data = {}
    switch (type) {
      case 'learner_progress': {
        const sid = subjectId || req.user.id
        const student = await db.collection('students').findOne({ userId: sid })
        const readiness = await db.collection('readiness_scores')
          .find({ subjectType: 'learner', subjectId: sid }).sort({ calculatedAt: -1 }).limit(5).toArray()
        const roadmaps = await db.collection('learning_roadmaps')
          .find({ studentId: sid, isDeleted: { $ne: true } }).sort({ createdAt: -1 }).limit(3).toArray()
        const attempts = await db.collection('assessment_attempts')
          .find({ studentId: sid }).sort({ submittedAt: -1 }).limit(10).toArray()
        data = { student, readinessHistory: readiness, roadmaps, recentAttempts: attempts }
        break
      }
      case 'skill_gap': {
        const gaps = await db.collection('skill_gaps')
          .find({ status: 'open', ...(subjectId ? { subjectId } : {}) })
          .sort({ priority: -1 }).limit(100).toArray()
        const bySkill = gaps.reduce((acc, g) => {
          const k = g.skillName; acc[k] = (acc[k] || 0) + 1; return acc
        }, {})
        data = { openGapsTotal: gaps.length, topGaps: Object.entries(bySkill).sort((a,b) => b[1]-a[1]).slice(0,20).map(([skillName, count]) => ({ skillName, count })), gaps: gaps.slice(0, 50) }
        break
      }
      case 'training_alignment': {
        const alignments = await db.collection('program_alignments')
          .find({}).sort({ alignmentPct: -1 }).limit(50).toArray()
        const avgPct = alignments.length ? Math.round(alignments.reduce((s,a) => s + a.alignmentPct, 0) / alignments.length) : 0
        data = { avgAlignmentPct: avgPct, alignments: alignments.slice(0, 20), totalAlignments: alignments.length }
        break
      }
      case 'industry_demand': {
        const skills = await db.collection('skills')
          .find({ isDeleted: { $ne: true }, demandScore: { $gt: 0 } })
          .sort({ demandScore: -1 }).limit(30).toArray()
        const industries = await db.collection('industries')
          .find({ isDeleted: { $ne: true } }).sort({ createdAt: -1 }).limit(20).toArray()
        data = { topDemandedSkills: skills.map(s => ({ skillId: s._id, skillName: s.name, demandScore: s.demandScore, category: s.category })), industries: industries.map(pub) }
        break
      }
      case 'regional_intelligence': {
        const rgaps = await db.collection('regional_skill_gaps')
          .find({}).sort({ priority: -1 }).limit(50).toArray()
        const providers = await db.collection('training_providers')
          .aggregate([{ $match: { isDeleted: { $ne: true } } }, { $group: { _id: '$region', count: { $sum: 1 } } }, { $sort: { count: -1 } }]).toArray()
        data = { regionalGaps: rgaps.map(pub), providersByRegion: providers }
        break
      }
      default: {
        const [learners, providers, programs, industries, roles, gaps] = await Promise.all([
          db.collection('students').countDocuments(),
          db.collection('training_providers').countDocuments({ isDeleted: { $ne: true } }),
          db.collection('training_programs').countDocuments({ status: 'active', isDeleted: { $ne: true } }),
          db.collection('industries').countDocuments({ isDeleted: { $ne: true } }),
          db.collection('job_roles').countDocuments({ status: 'active', isDeleted: { $ne: true } }),
          db.collection('skill_gaps').countDocuments({ status: 'open' }),
        ])
        data = { totalLearners: learners, totalProviders: providers, totalPrograms: programs, totalIndustries: industries, totalJobRoles: roles, openSkillGaps: gaps }
      }
    }

    const doc = {
      _id: randomUUID(),
      type, format, title: title || `${type.replace(/_/g,' ')} report`,
      ownerId: req.user.id, ownerRole: req.user.role,
      subjectId: subjectId || null, subjectType: subjectType || null,
      targetRole: targetRole || null, filters, data,
      status: 'ready', rows: Object.keys(data).length,
      generatedAt: now, updatedAt: now,
    }
    await db.collection('reports').insertOne(doc)
    res.status(201).json({ report: pub(doc) })
  }))

  // ── My reports ──────────────────────────────────────────────────────────────
  router.get('/my', asyncHandler(async (req, res) => {
    const { type, page: pg = '1', limit: lm = '20' } = req.query
    const page  = Math.max(1, parseInt(pg) || 1)
    const limit = Math.min(50, Math.max(1, parseInt(lm) || 20))
    const filter = { ownerId: req.user.id }
    if (type) filter.type = type
    const col = getDatabase().collection('reports')
    const total = await col.countDocuments(filter)
    const docs  = await col.find(filter, { projection: { data: 0 } })
      .sort({ generatedAt: -1 }).skip((page-1)*limit).limit(limit).toArray()
    res.json({ reports: docs.map(pub), pagination: { total, page, limit, pages: Math.ceil(total/limit) } })
  }))

  // ── Get one ─────────────────────────────────────────────────────────────────
  router.get('/:id', asyncHandler(async (req, res) => {
    const doc = await getDatabase().collection('reports').findOne({ _id: req.params.id })
    if (!doc) { throw Object.assign(new Error('Report not found'), { statusCode: 404 }) }
    if (doc.ownerId !== req.user.id && req.user.role !== 'government')
      throw Object.assign(new Error('Access denied'), { statusCode: 403 })
    res.json({ report: pub(doc) })
  }))

  // ── Download ────────────────────────────────────────────────────────────────
  router.get('/:id/download', asyncHandler(async (req, res) => {
    const doc = await getDatabase().collection('reports').findOne({ _id: req.params.id })
    if (!doc) throw Object.assign(new Error('Report not found'), { statusCode: 404 })
    if (doc.ownerId !== req.user.id && req.user.role !== 'government')
      throw Object.assign(new Error('Access denied'), { statusCode: 403 })
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Content-Disposition', `attachment; filename="report-${doc._id}.json"`)
    res.json({ report: pub(doc) })
  }))

  // ── Delete ──────────────────────────────────────────────────────────────────
  router.delete('/:id', asyncHandler(async (req, res) => {
    const doc = await getDatabase().collection('reports').findOne({ _id: req.params.id })
    if (!doc) throw Object.assign(new Error('Report not found'), { statusCode: 404 })
    if (doc.ownerId !== req.user.id && req.user.role !== 'government')
      throw Object.assign(new Error('Access denied'), { statusCode: 403 })
    await getDatabase().collection('reports').deleteOne({ _id: req.params.id })
    res.json({ message: 'Report deleted', id: req.params.id })
  }))

  return router
}

// ══════════════════════════════════════════════════════════════════════════════
// NOTIFICATIONS
// ══════════════════════════════════════════════════════════════════════════════
function buildNotificationsRouter() {
  const router = Router()
  router.use(requireAuth)

  const SEVERITIES = ['info','success','warning','high','critical']

  // ── My notifications ─────────────────────────────────────────────────────────
  router.get('/my', asyncHandler(async (req, res) => {
    const { unreadOnly, page: pg = '1', limit: lm = '20' } = req.query
    const page  = Math.max(1, parseInt(pg) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(lm) || 20))
    const filter = { recipientId: req.user.id }
    if (unreadOnly === 'true') filter.read = false
    const col = getDatabase().collection('notifications')
    const total = await col.countDocuments(filter)
    const docs  = await col.find(filter).sort({ createdAt: -1 }).skip((page-1)*limit).limit(limit).toArray()
    const unreadCount = await col.countDocuments({ recipientId: req.user.id, read: false })
    res.json({ notifications: docs.map(pub), unreadCount, pagination: { total, page, limit, pages: Math.ceil(total/limit) } })
  }))

  // ── Create (internal/admin) ──────────────────────────────────────────────────
  router.post('/', requireRole('government', 'training', 'industry'), asyncHandler(async (req, res) => {
    const { recipientId, recipientRole, title, text, severity = 'info', link } = req.body
    if (!title?.trim()) throw bad('title is required')
    if (!text?.trim())  throw bad('text is required')
    if (severity && !SEVERITIES.includes(severity)) throw bad(`severity must be one of: ${SEVERITIES.join(', ')}`)

    const db  = getDatabase()
    const now = new Date()

    // If recipientRole — send to all users of that role
    if (recipientRole && !recipientId) {
      const users = await db.collection('users').find({ role: recipientRole, isActive: true }).toArray()
      const docs  = users.map(u => ({
        _id: randomUUID(), recipientId: u._id, title, text, severity,
        link: link || null, read: false, createdBy: req.user.id, createdAt: now,
      }))
      if (docs.length) await db.collection('notifications').insertMany(docs)
      return res.status(201).json({ sent: docs.length, message: `Sent to ${docs.length} ${recipientRole} users` })
    }

    if (!recipientId?.trim()) throw bad('recipientId or recipientRole is required')
    const doc = {
      _id: randomUUID(), recipientId, title, text, severity,
      link: link || null, read: false, createdBy: req.user.id, createdAt: now,
    }
    await db.collection('notifications').insertOne(doc)
    res.status(201).json({ notification: pub(doc) })
  }))

  // ── Mark read ────────────────────────────────────────────────────────────────
  router.patch('/:id/read', asyncHandler(async (req, res) => {
    const col  = getDatabase().collection('notifications')
    const doc  = await col.findOne({ _id: req.params.id })
    if (!doc) throw Object.assign(new Error('Notification not found'), { statusCode: 404 })
    if (doc.recipientId !== req.user.id) throw Object.assign(new Error('Access denied'), { statusCode: 403 })
    const result = await col.findOneAndUpdate({ _id: req.params.id }, { $set: { read: true, readAt: new Date() } }, { returnDocument: 'after' })
    res.json({ notification: pub(result) })
  }))

  // ── Mark all read ────────────────────────────────────────────────────────────
  router.patch('/read-all', asyncHandler(async (req, res) => {
    const { modifiedCount } = await getDatabase().collection('notifications').updateMany(
      { recipientId: req.user.id, read: false },
      { $set: { read: true, readAt: new Date() } },
    )
    res.json({ message: `Marked ${modifiedCount} notifications as read`, count: modifiedCount })
  }))

  // ── Delete ──────────────────────────────────────────────────────────────────
  router.delete('/:id', asyncHandler(async (req, res) => {
    const doc = await getDatabase().collection('notifications').findOne({ _id: req.params.id })
    if (!doc) throw Object.assign(new Error('Notification not found'), { statusCode: 404 })
    if (doc.recipientId !== req.user.id && req.user.role !== 'government')
      throw Object.assign(new Error('Access denied'), { statusCode: 403 })
    await getDatabase().collection('notifications').deleteOne({ _id: req.params.id })
    res.json({ message: 'Notification deleted', id: req.params.id })
  }))

  return router
}
