/**
 * B13 — Training Program Alignment
 * Mounted at /api/alignment
 *
 * POST /api/alignment/calculate          — compute alignment % for a program vs job role
 * GET  /api/alignment/program/:programId — all stored alignments for a program
 * GET  /api/alignment/job/:jobRoleId     — all programs aligned to a job role
 * GET  /api/alignment/:id                — fetch one alignment record
 * POST /api/alignment/improvements       — recommend curriculum improvements
 */

import { randomUUID } from 'node:crypto'
import { Router }     from 'express'
import { getDatabase }       from '../db.js'
import { asyncHandler }      from '../middleware/errorHandler.js'
import { requireAuth }       from '../middleware/auth.js'

const router = Router()
router.use(requireAuth)

const bad      = (m) => Object.assign(new Error(m), { statusCode: 400 })
const notFound = (m = 'Not found') => Object.assign(new Error(m), { statusCode: 404 })

function pub(doc) { if (!doc) return null; const { _id, ...r } = doc; return { id: _id, ...r } }

// ─── Core alignment calculation ───────────────────────────────────────────────
async function computeAlignment(programId, jobRoleId) {
  const db = getDatabase()

  const program = await db.collection('training_programs')
    .findOne({ _id: programId, status: 'active', isDeleted: { $ne: true } })
  if (!program) throw notFound(`Training program "${programId}" not found or not active`)

  const jobRole = await db.collection('job_roles')
    .findOne({ _id: jobRoleId, isDeleted: { $ne: true } })
  if (!jobRole) throw notFound(`Job role "${jobRoleId}" not found`)

  // Get latest published curriculum for the program
  const curriculum = await db.collection('curriculums')
    .findOne(
      { trainingProgramId: programId, status: 'published', isDeleted: { $ne: true } },
      { sort: { updatedAt: -1 } },
    )

  const covered    = curriculum?.skillsCovered || []
  const required   = jobRole.requiredSkills    || []

  if (required.length === 0) {
    return { alignmentPct: 100, coveredSkills: [], missingSkills: [], extraSkills: [], covered, required, note: 'Job role has no required skills' }
  }

  // Build lookup sets
  const coveredIds   = new Set(covered.map(s => s.skillId).filter(Boolean))
  const coveredNames = new Set(covered.map(s => (s.skillName||'').toLowerCase()).filter(Boolean))

  const coveredSkills = []
  const missingSkills = []

  for (const req of required) {
    const reqId   = req.skillId
    const reqName = (req.skillName || '').toLowerCase()
    const found   = (reqId && coveredIds.has(reqId)) || (reqName && coveredNames.has(reqName))

    if (found) {
      const currSkill = covered.find(c =>
        (c.skillId && c.skillId === reqId) || (c.skillName||'').toLowerCase() === reqName
      )
      coveredSkills.push({
        canonicalId:      reqId || null,
        skillName:        req.skillName,
        requirement:      req.requirement || 'required',
        coveredLevel:     currSkill?.proficiencyLevel || null,
        requiredLevel:    req.level || null,
        levelSufficient:  currSkill?.proficiencyLevel && req.level
          ? ['beginner','intermediate','advanced','expert'].indexOf(currSkill.proficiencyLevel) >=
            ['beginner','intermediate','advanced','expert'].indexOf(req.level)
          : null,
      })
    } else {
      missingSkills.push({
        canonicalId:   reqId || null,
        skillName:     req.skillName,
        requirement:   req.requirement || 'required',
        requiredLevel: req.level || null,
        priority:      req.requirement === 'required' ? 'critical' : req.requirement === 'preferred' ? 'high' : 'medium',
      })
    }
  }

  // Skills in curriculum not required by role (extra/bonus coverage)
  const requiredIds   = new Set(required.map(r => r.skillId).filter(Boolean))
  const requiredNames = new Set(required.map(r => (r.skillName||'').toLowerCase()).filter(Boolean))
  const extraSkills   = covered
    .filter(c => !requiredIds.has(c.skillId) && !requiredNames.has((c.skillName||'').toLowerCase()))
    .map(c => ({ canonicalId: c.skillId || null, skillName: c.skillName, coverage: c.coverage }))

  // Weighted alignment % (required gaps penalise more)
  const totalWeight  = required.reduce((s,r) => s + (r.requirement === 'required' ? 3 : r.requirement === 'preferred' ? 2 : 1), 0)
  const coveredWeight= coveredSkills.reduce((s,c) => s + (c.requirement === 'required' ? 3 : c.requirement === 'preferred' ? 2 : 1), 0)
  const alignmentPct = totalWeight > 0 ? Math.round((coveredWeight / totalWeight) * 100) : 100

  return {
    programId, jobRoleId,
    programName:   program.name,
    jobRoleTitle:  jobRole.title,
    curriculumId:  curriculum?._id || null,
    alignmentPct,
    coveredCount:  coveredSkills.length,
    missingCount:  missingSkills.length,
    extraCount:    extraSkills.length,
    totalRequired: required.length,
    coveredSkills,
    missingSkills: missingSkills.sort((a,b) => (b.priority==='critical'?2:b.priority==='high'?1:0) - (a.priority==='critical'?2:a.priority==='high'?1:0)),
    extraSkills,
  }
}

// ── Calculate + persist ───────────────────────────────────────────────────────
router.post('/calculate', asyncHandler(async (req, res) => {
  const { programId, jobRoleId, persist = true } = req.body
  if (!programId?.trim()) throw bad('programId is required')
  if (!jobRoleId?.trim()) throw bad('jobRoleId is required')

  const result = await computeAlignment(programId, jobRoleId)

  if (persist) {
    const now = new Date()
    const doc = {
      _id:           randomUUID(),
      trainingProgramId: programId,
      jobRoleId,
      ...result,
      calculatedBy:  req.user.id,
      calculatedAt:  now,
      updatedAt:     now,
    }
    await getDatabase().collection('program_alignments').findOneAndUpdate(
      { trainingProgramId: programId, jobRoleId },
      { $set: doc, $setOnInsert: { createdAt: now } },
      { upsert: true },
    )
    const saved = await getDatabase().collection('program_alignments')
      .findOne({ trainingProgramId: programId, jobRoleId })
    return res.status(201).json({ alignment: pub(saved) })
  }

  res.json({ alignment: { ...result, persisted: false } })
}))

// ── Get by program ────────────────────────────────────────────────────────────
router.get('/program/:programId', asyncHandler(async (req, res) => {
  const docs = await getDatabase().collection('program_alignments')
    .find({ trainingProgramId: req.params.programId })
    .sort({ alignmentPct: -1 }).toArray()
  res.json({ alignments: docs.map(pub), count: docs.length })
}))

// ── Get by job role ───────────────────────────────────────────────────────────
router.get('/job/:jobRoleId', asyncHandler(async (req, res) => {
  const docs = await getDatabase().collection('program_alignments')
    .find({ jobRoleId: req.params.jobRoleId })
    .sort({ alignmentPct: -1 }).toArray()
  res.json({ alignments: docs.map(pub), count: docs.length })
}))

// ── Get one ───────────────────────────────────────────────────────────────────
router.get('/:id', asyncHandler(async (req, res) => {
  const doc = await getDatabase().collection('program_alignments').findOne({ _id: req.params.id })
  if (!doc) throw notFound()
  res.json({ alignment: pub(doc) })
}))

// ── Curriculum improvement recommendations ────────────────────────────────────
router.post('/improvements', asyncHandler(async (req, res) => {
  const { programId, jobRoleIds = [] } = req.body
  if (!programId?.trim()) throw bad('programId is required')
  if (!Array.isArray(jobRoleIds) || jobRoleIds.length === 0) throw bad('jobRoleIds must be a non-empty array')

  // Aggregate missing skills across all specified job roles
  const missingMap = new Map()
  const results    = []

  for (const jobRoleId of jobRoleIds) {
    try {
      const r = await computeAlignment(programId, jobRoleId)
      results.push(r)
      for (const ms of r.missingSkills) {
        const key = ms.canonicalId || ms.skillName
        if (!missingMap.has(key)) missingMap.set(key, { ...ms, frequency: 0, roles: [] })
        const entry = missingMap.get(key)
        entry.frequency++
        entry.roles.push(r.jobRoleTitle)
      }
    } catch { /* skip invalid role */ }
  }

  const improvements = [...missingMap.values()]
    .sort((a, b) => {
      const prio = (p) => p === 'critical' ? 3 : p === 'high' ? 2 : 1
      if (prio(b.priority) !== prio(a.priority)) return prio(b.priority) - prio(a.priority)
      return b.frequency - a.frequency
    })
    .map((s, i) => ({
      rank:       i + 1,
      skillName:  s.skillName,
      canonicalId:s.canonicalId,
      priority:   s.priority,
      frequency:  s.frequency,
      affectedRoles: s.roles,
      recommendation: `Add ${s.skillName} at ${s.requiredLevel || 'intermediate'} level to curriculum (missing from ${s.frequency} target role${s.frequency > 1 ? 's' : ''})`,
    }))

  const avgAlignment = results.length
    ? Math.round(results.reduce((s, r) => s + r.alignmentPct, 0) / results.length)
    : 0

  res.json({ programId, avgAlignmentPct: avgAlignment, improvements, totalJobRoles: results.length })
}))

export default router
