/**
 * B14 — Industry Demand & Emerging Skills
 * Mounted at /api/demand
 *
 * GET /api/demand/skills                — top high-demand skills (all or by sector/region)
 * GET /api/demand/skills/:skillId       — demand details for one skill
 * POST /api/demand/skills/:skillId      — record/update demand signal (industry)
 * GET /api/demand/trends                — skill growth trends
 * GET /api/demand/emerging              — emerging/fast-growing skills
 * GET /api/demand/shortages             — skills with high demand but low training supply
 * GET /api/demand/by-role/:jobRoleId    — demand profile for a job role
 * GET /api/demand/by-industry/:industryId — demand profile for an industry
 * POST /api/demand/bulk                 — bulk ingest demand signals (industry/govt)
 */

import { randomUUID } from 'node:crypto'
import { Router }     from 'express'
import { getDatabase }       from '../db.js'
import { asyncHandler }      from '../middleware/errorHandler.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

const router = Router()

const bad = (m) => Object.assign(new Error(m), { statusCode: 400 })
const WRITE_ROLES = ['industry', 'government']

function pub(doc) { if (!doc) return null; const { _id, ...r } = doc; return { id: _id, ...r } }

// ── Public reads ──────────────────────────────────────────────────────────────

/**
 * GET /api/demand/skills
 * Query: sector, region, limit, minDemandScore, sort (demandScore|growthRate)
 */
router.get('/skills', asyncHandler(async (req, res) => {
  const { sector, region, limit: lm = '20', minDemandScore = '0', sort = 'demandScore' } = req.query
  const limitNum = Math.min(100, Math.max(1, parseInt(lm) || 20))
  const minScore = parseFloat(minDemandScore) || 0
  const sortField = sort === 'growthRate' ? 'growthRate' : 'demandScore'

  // Aggregate from skill_demand + join skills collection
  const pipeline = [
    { $match: { ...(region ? { region } : {}), ...(sector ? { sector } : {}) } },
    { $sort: { recordedAt: -1 } },
    { $group: { _id: '$skillId', avgDemandScore: { $avg: '$demandScore' }, maxDemandScore: { $max: '$demandScore' }, growthRate: { $avg: '$growthRate' }, latestAt: { $max: '$recordedAt' }, regions: { $addToSet: '$region' }, sectors: { $addToSet: '$sector' } } },
    { $match: { avgDemandScore: { $gte: minScore } } },
    { $sort: { [sortField === 'growthRate' ? 'growthRate' : 'avgDemandScore']: -1 } },
    { $limit: limitNum },
    { $lookup: { from: 'skills', localField: '_id', foreignField: '_id', as: 'skill' } },
    { $unwind: { path: '$skill', preserveNullAndEmptyArrays: true } },
    { $project: { skillId: '$_id', skillName: '$skill.name', category: '$skill.category', avgDemandScore: 1, maxDemandScore: 1, growthRate: 1, latestAt: 1, regions: 1, sectors: 1 } },
  ]

  const db      = getDatabase()
  let   results = await db.collection('skill_demand').aggregate(pipeline).toArray()

  // Fallback: if no demand data, return skills sorted by demandScore from skills collection
  if (results.length === 0) {
    const filter = { isDeleted: { $ne: true }, demandScore: { $gt: minScore } }
    const skills = await db.collection('skills').find(filter)
      .sort({ demandScore: -1 }).limit(limitNum).toArray()
    results = skills.map(s => ({
      skillId: s._id, skillName: s.name, category: s.category,
      avgDemandScore: s.demandScore, maxDemandScore: s.demandScore,
      growthRate: null, latestAt: null, regions: [], sectors: [],
    }))
  }

  res.json({ skills: results, count: results.length, filters: { sector: sector || null, region: region || null } })
}))

/**
 * GET /api/demand/skills/:skillId
 */
router.get('/skills/:skillId', asyncHandler(async (req, res) => {
  const db   = getDatabase()
  const skill = await db.collection('skills').findOne({ _id: req.params.skillId, isDeleted: { $ne: true } })
  if (!skill) { const e = new Error('Skill not found'); e.statusCode = 404; throw e }

  const demands = await db.collection('skill_demand')
    .find({ skillId: req.params.skillId })
    .sort({ recordedAt: -1 }).limit(24).toArray()

  const trends = await db.collection('skill_trends')
    .find({ skillId: req.params.skillId })
    .sort({ recordedAt: -1 }).limit(12).toArray()

  res.json({ skill: pub(skill), demandHistory: demands.map(pub), trends: trends.map(pub) })
}))

/**
 * GET /api/demand/trends?limit=20&region=&sector=
 */
router.get('/trends', asyncHandler(async (req, res) => {
  const { region, sector, limit: lm = '20' } = req.query
  const limitNum = Math.min(50, Math.max(1, parseInt(lm) || 20))

  const filter = {}
  if (region) filter.region = region
  if (sector) filter.sector = sector

  const pipeline = [
    { $match: filter },
    { $sort: { recordedAt: -1 } },
    { $group: { _id: '$skillId', growthRate: { $avg: '$growthRate' }, avgScore: { $avg: '$demandScore' }, dataPoints: { $sum: 1 }, latestScore: { $first: '$demandScore' } } },
    { $match: { growthRate: { $gt: 0 } } },
    { $sort: { growthRate: -1 } },
    { $limit: limitNum },
    { $lookup: { from: 'skills', localField: '_id', foreignField: '_id', as: 'skill' } },
    { $unwind: { path: '$skill', preserveNullAndEmptyArrays: true } },
    { $project: { skillId: '$_id', skillName: '$skill.name', category: '$skill.category', growthRate: 1, avgScore: 1, latestScore: 1, dataPoints: 1 } },
  ]

  let results = await getDatabase().collection('skill_demand').aggregate(pipeline).toArray()

  // Fallback to skills collection if no trend data
  if (results.length === 0) {
    const skills = await getDatabase().collection('skills')
      .find({ isDeleted: { $ne: true }, demandScore: { $gt: 0 } })
      .sort({ demandScore: -1 }).limit(limitNum).toArray()
    results = skills.map(s => ({
      skillId: s._id, skillName: s.name, category: s.category,
      growthRate: null, avgScore: s.demandScore, latestScore: s.demandScore, dataPoints: 0,
    }))
  }

  res.json({ trends: results, count: results.length })
}))

/**
 * GET /api/demand/emerging?limit=10&threshold=50
 * Skills where recent demandScore is significantly higher than 3-month average
 */
router.get('/emerging', asyncHandler(async (req, res) => {
  const { limit: lm = '10', threshold = '15' } = req.query
  const limitNum  = Math.min(50, Math.max(1, parseInt(lm)   || 10))
  const growthMin = parseFloat(threshold) || 15

  const pipeline = [
    { $sort: { recordedAt: -1 } },
    { $group: { _id: '$skillId', latestScore: { $first: '$demandScore' }, avgScore: { $avg: '$demandScore' }, growthRate: { $avg: '$growthRate' } } },
    { $addFields: { emergenceScore: { $subtract: ['$latestScore', '$avgScore'] } } },
    { $match: { $or: [ { emergenceScore: { $gte: growthMin } }, { growthRate: { $gte: growthMin } } ] } },
    { $sort: { emergenceScore: -1 } },
    { $limit: limitNum },
    { $lookup: { from: 'skills', localField: '_id', foreignField: '_id', as: 'skill' } },
    { $unwind: { path: '$skill', preserveNullAndEmptyArrays: true } },
    { $project: { skillId: '$_id', skillName: '$skill.name', category: '$skill.category', latestScore: 1, avgScore: 1, growthRate: 1, emergenceScore: 1 } },
  ]

  let results = await getDatabase().collection('skill_demand').aggregate(pipeline).toArray()

  // Fallback: top skills by demandScore
  if (results.length === 0) {
    const skills = await getDatabase().collection('skills')
      .find({ isDeleted: { $ne: true }, demandScore: { $gte: 70 } })
      .sort({ demandScore: -1 }).limit(limitNum).toArray()
    results = skills.map(s => ({
      skillId: s._id, skillName: s.name, category: s.category,
      latestScore: s.demandScore, avgScore: s.demandScore, growthRate: null, emergenceScore: 0,
    }))
  }

  res.json({ emergingSkills: results, count: results.length, threshold: growthMin })
}))

/**
 * GET /api/demand/shortages
 * High-demand skills with few training programs covering them
 */
router.get('/shortages', asyncHandler(async (req, res) => {
  const { region, limit: lm = '20', minDemandScore = '60' } = req.query
  const limitNum = Math.min(100, Math.max(1, parseInt(lm) || 20))
  const minScore = parseFloat(minDemandScore) || 60
  const db = getDatabase()

  // High-demand skills
  const highDemand = await db.collection('skills')
    .find({ isDeleted: { $ne: true }, demandScore: { $gte: minScore } })
    .sort({ demandScore: -1 }).limit(200).toArray()

  // For each, count training programs that cover it
  const results = await Promise.all(highDemand.map(async skill => {
    const trainingCount = await db.collection('curriculums').countDocuments({
      status: 'published',
      isDeleted: { $ne: true },
      $or: [
        { 'skillsCovered.skillId':   skill._id },
        { 'skillsCovered.skillName': { $regex: new RegExp(`^${skill.name}$`, 'i') } },
      ],
    })
    return {
      skillId:       skill._id,
      skillName:     skill.name,
      category:      skill.category,
      demandScore:   skill.demandScore,
      trainingCount,
      shortageScore: skill.demandScore - (trainingCount * 10),  // high = bigger shortage
      severity:      trainingCount === 0 ? 'critical' : trainingCount <= 2 ? 'high' : 'moderate',
    }
  }))

  const shortages = results
    .filter(r => r.trainingCount <= 3)
    .sort((a, b) => b.shortageScore - a.shortageScore)
    .slice(0, limitNum)

  res.json({ shortages, count: shortages.length, filters: { region: region || null, minDemandScore: minScore } })
}))

/**
 * GET /api/demand/by-role/:jobRoleId
 */
router.get('/by-role/:jobRoleId', asyncHandler(async (req, res) => {
  const role = await getDatabase().collection('job_roles')
    .findOne({ _id: req.params.jobRoleId, isDeleted: { $ne: true } })
  if (!role) { const e = new Error('Job role not found'); e.statusCode = 404; throw e }

  const skillIds = (role.requiredSkills || []).map(s => s.skillId).filter(Boolean)
  const skills   = skillIds.length
    ? await getDatabase().collection('skills').find({ _id: { $in: skillIds } }).toArray()
    : []

  const demandProfile = skills.map(s => ({
    skillId: s._id, skillName: s.name, category: s.category, demandScore: s.demandScore || 0,
    requirement: role.requiredSkills.find(r => r.skillId === s._id)?.requirement || 'required',
  })).sort((a, b) => b.demandScore - a.demandScore)

  const avgDemand = demandProfile.length
    ? Math.round(demandProfile.reduce((s, d) => s + d.demandScore, 0) / demandProfile.length)
    : 0

  res.json({ jobRole: pub(role), demandProfile, avgDemandScore: avgDemand, skillCount: demandProfile.length })
}))

/**
 * GET /api/demand/by-industry/:industryId
 */
router.get('/by-industry/:industryId', asyncHandler(async (req, res) => {
  const industry = await getDatabase().collection('industries')
    .findOne({ _id: req.params.industryId, isDeleted: { $ne: true } })
  if (!industry) { const e = new Error('Industry not found'); e.statusCode = 404; throw e }

  const roles = await getDatabase().collection('job_roles')
    .find({ industryId: req.params.industryId, status: 'active', isDeleted: { $ne: true } })
    .toArray()

  const skillMap = new Map()
  for (const role of roles) {
    for (const s of role.requiredSkills || []) {
      if (!s.skillId) continue
      const entry = skillMap.get(s.skillId) || { skillId: s.skillId, skillName: s.skillName, count: 0, roles: [] }
      entry.count++
      entry.roles.push(role.title)
      skillMap.set(s.skillId, entry)
    }
  }

  // Enrich with demandScores
  const skillIds = [...skillMap.keys()]
  const skillDocs = skillIds.length
    ? await getDatabase().collection('skills').find({ _id: { $in: skillIds } }).toArray()
    : []
  const demandMap = new Map(skillDocs.map(s => [s._id, s.demandScore || 0]))

  const demandProfile = [...skillMap.values()]
    .map(s => ({ ...s, demandScore: demandMap.get(s.skillId) || 0 }))
    .sort((a, b) => b.count - a.count || b.demandScore - a.demandScore)

  res.json({ industry: pub(industry), demandProfile, jobRoleCount: roles.length, uniqueSkillCount: demandProfile.length })
}))

// ── Protected writes ──────────────────────────────────────────────────────────
router.use(requireAuth)

/**
 * POST /api/demand/skills/:skillId
 * Record a demand signal for a skill.
 * Body: { demandScore, growthRate?, region?, sector?, notes? }
 */
router.post('/skills/:skillId', requireRole(...WRITE_ROLES), asyncHandler(async (req, res) => {
  const { demandScore, growthRate, region, sector, notes = '' } = req.body
  if (typeof demandScore !== 'number' || demandScore < 0 || demandScore > 100)
    throw bad('demandScore must be a number 0-100')

  const skill = await getDatabase().collection('skills')
    .findOne({ _id: req.params.skillId, isDeleted: { $ne: true } })
  if (!skill) { const e = new Error('Skill not found'); e.statusCode = 404; throw e }

  const now = new Date()
  const doc = {
    _id: randomUUID(), skillId: req.params.skillId, skillName: skill.name,
    demandScore, growthRate: growthRate || null, region: region || null,
    sector: sector || null, notes, recordedBy: req.user.id, recordedAt: now,
  }
  await getDatabase().collection('skill_demand').insertOne(doc)

  // Also update the canonical demandScore on the skill document
  await getDatabase().collection('skills').updateOne(
    { _id: req.params.skillId },
    { $set: { demandScore, updatedAt: now } },
  )

  res.status(201).json({ signal: pub(doc) })
}))

/**
 * POST /api/demand/bulk
 * Body: { signals: [{ skillId, demandScore, growthRate?, region?, sector? }] }
 */
router.post('/bulk', requireRole(...WRITE_ROLES), asyncHandler(async (req, res) => {
  const { signals } = req.body
  if (!Array.isArray(signals) || signals.length === 0) throw bad('signals must be a non-empty array')
  if (signals.length > 500) throw bad('signals must not exceed 500 per request')

  const db  = getDatabase()
  const now = new Date()
  let created = 0; const errors = []

  for (const [i, s] of signals.entries()) {
    try {
      if (!s.skillId) throw new Error('skillId required')
      if (typeof s.demandScore !== 'number' || s.demandScore < 0 || s.demandScore > 100)
        throw new Error('demandScore must be 0-100')
      const skill = await db.collection('skills').findOne({ _id: s.skillId, isDeleted: { $ne: true } })
      if (!skill) throw new Error(`Skill ${s.skillId} not found`)

      await db.collection('skill_demand').insertOne({
        _id: randomUUID(), skillId: s.skillId, skillName: skill.name,
        demandScore: s.demandScore, growthRate: s.growthRate || null,
        region: s.region || null, sector: s.sector || null, notes: s.notes || '',
        recordedBy: req.user.id, recordedAt: now,
      })
      await db.collection('skills').updateOne({ _id: s.skillId }, { $set: { demandScore: s.demandScore, updatedAt: now } })
      created++
    } catch (err) { errors.push({ index: i, error: err.message }) }
  }

  res.status(207).json({ created, errors, total: signals.length })
}))

export default router
