/**
 * B15 — Government Intelligence
 * Mounted at /api/intelligence
 *
 * GET /api/intelligence/regional-gaps          — skill gaps by region
 * GET /api/intelligence/supply-demand          — training supply vs industry demand
 * GET /api/intelligence/underserved-areas      — high-demand, low-training regions
 * GET /api/intelligence/overview               — top-level dashboard stats
 * GET /api/intelligence/skill-matrix           — skills × regions heat matrix
 * POST /api/intelligence/regional-gaps/record  — record regional gap data (govt)
 */

import { randomUUID } from 'node:crypto'
import { Router }     from 'express'
import { getDatabase }       from '../db.js'
import { asyncHandler }      from '../middleware/errorHandler.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

const router = Router()

const MAHARASHTRA_REGIONS = ['Mumbai', 'Pune', 'Nagpur', 'Nashik', 'Aurangabad', 'Solapur', 'Kolhapur', 'Vidarbha', 'Marathwada', 'Konkan']

function pub(doc) { if (!doc) return null; const { _id, ...r } = doc; return { id: _id, ...r } }

// ── Public reads ──────────────────────────────────────────────────────────────

router.get('/regional-gaps', asyncHandler(async (req, res) => {
  const { region, limit: lm = '20', minPriority } = req.query
  const limitNum = Math.min(100, parseInt(lm) || 20)
  const db = getDatabase()

  const filter = {}
  if (region)      filter.region   = region
  if (minPriority) filter.priority = { $gte: parseInt(minPriority) }

  // From stored regional_skill_gaps collection
  const stored = await db.collection('regional_skill_gaps')
    .find(filter).sort({ priority: -1, region: 1 }).limit(limitNum).toArray()

  // If no stored data, derive from skill_gaps collection grouped by region
  if (stored.length === 0) {
    const pipeline = [
      { $match: { status: 'open' } },
      { $group: { _id: { region: '$region', skillName: '$skillName', canonicalId: '$canonicalId' },
                  count: { $sum: 1 }, priority: { $max: '$priority' } } },
      { $sort: { priority: -1, count: -1 } },
      { $limit: limitNum },
      { $project: { region: '$_id.region', skillName: '$_id.skillName', canonicalId: '$_id.canonicalId', count: 1, priority: 1 } },
    ]
    const derived = await db.collection('skill_gaps').aggregate(pipeline).toArray()
    return res.json({ regionalGaps: derived, count: derived.length, source: 'derived' })
  }

  res.json({ regionalGaps: stored.map(pub), count: stored.length, source: 'stored' })
}))

router.get('/supply-demand', asyncHandler(async (req, res) => {
  const { region, sector, limit: lm = '20' } = req.query
  const limitNum = Math.min(50, parseInt(lm) || 20)
  const db = getDatabase()

  // High-demand skills
  const demandFilter = { isDeleted: { $ne: true }, demandScore: { $gt: 0 } }
  const highDemand = await db.collection('skills')
    .find(demandFilter).sort({ demandScore: -1 }).limit(limitNum).toArray()

  const result = await Promise.all(highDemand.map(async skill => {
    // Count active programs covering this skill
    const trainingSupply = await db.collection('curriculums').countDocuments({
      status: 'published',
      isDeleted: { $ne: true },
      $or: [
        { 'skillsCovered.skillId':   skill._id },
        { 'skillsCovered.skillName': { $regex: new RegExp(`^${skill.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } },
      ],
    })

    const gap = skill.demandScore - (trainingSupply * 15)
    return {
      skillId:       skill._id,
      skillName:     skill.name,
      category:      skill.category,
      demandScore:   skill.demandScore || 0,
      trainingSupply,
      supplyDemandGap: Math.max(0, gap),
      balanceLabel:  trainingSupply === 0 ? 'critical_shortage'
                   : gap > 50 ? 'high_shortage'
                   : gap > 20 ? 'moderate_shortage'
                   : gap > 0  ? 'slight_shortage' : 'balanced',
    }
  }))

  result.sort((a, b) => b.supplyDemandGap - a.supplyDemandGap)
  res.json({ supplyDemand: result, count: result.length, filters: { region: region || null, sector: sector || null } })
}))

router.get('/underserved-areas', asyncHandler(async (req, res) => {
  const db = getDatabase()

  // Regions with providers vs regions in Maharashtra
  const providersByRegion = await db.collection('training_providers')
    .aggregate([
      { $match: { isDeleted: { $ne: true } } },
      { $group: { _id: '$region', providerCount: { $sum: 1 }, districts: { $addToSet: '$district' } } },
    ]).toArray()

  const providerMap = new Map(providersByRegion.map(r => [r._id, r]))

  const areas = MAHARASHTRA_REGIONS.map(region => {
    const pData = providerMap.get(region) || { providerCount: 0, districts: [] }
    return {
      region,
      providerCount: pData.providerCount,
      districtsWithProviders: pData.districts.length,
      isUnderserved: pData.providerCount < 3,
      severity: pData.providerCount === 0 ? 'critical' : pData.providerCount <= 2 ? 'high' : 'moderate',
    }
  }).sort((a, b) => a.providerCount - b.providerCount)

  res.json({ underservedAreas: areas, count: areas.filter(a => a.isUnderserved).length, totalRegions: MAHARASHTRA_REGIONS.length })
}))

router.get('/overview', asyncHandler(async (req, res) => {
  const db = getDatabase()

  const [
    totalLearners, totalProviders, totalPrograms, totalIndustries,
    totalJobRoles, openGaps, avgReadiness, topGaps,
  ] = await Promise.all([
    db.collection('students').countDocuments(),
    db.collection('training_providers').countDocuments({ isDeleted: { $ne: true } }),
    db.collection('training_programs').countDocuments({ status: 'active', isDeleted: { $ne: true } }),
    db.collection('industries').countDocuments({ isDeleted: { $ne: true } }),
    db.collection('job_roles').countDocuments({ status: 'active', isDeleted: { $ne: true } }),
    db.collection('skill_gaps').countDocuments({ status: 'open' }),
    db.collection('readiness_scores').aggregate([{ $group: { _id: null, avg: { $avg: '$readinessScore' } } }]).toArray(),
    db.collection('skill_gaps').aggregate([
      { $match: { status: 'open' } },
      { $group: { _id: '$skillName', count: { $sum: 1 } } },
      { $sort: { count: -1 } }, { $limit: 5 },
    ]).toArray(),
  ])

  res.json({
    overview: {
      totalLearners,
      totalProviders,
      totalActivePrograms:   totalPrograms,
      totalIndustries,
      totalActiveJobRoles:   totalJobRoles,
      openSkillGaps:         openGaps,
      avgLearnerReadiness:   avgReadiness[0]?.avg ? Math.round(avgReadiness[0].avg) : null,
      topSkillGaps:          topGaps.map(g => ({ skillName: g._id, affectedLearners: g.count })),
    },
  })
}))

router.get('/skill-matrix', asyncHandler(async (req, res) => {
  const { limit: lm = '10' } = req.query
  const limitNum = Math.min(20, parseInt(lm) || 10)
  const db = getDatabase()

  // Top demanded skills
  const topSkills = await db.collection('skills')
    .find({ isDeleted: { $ne: true }, demandScore: { $gt: 0 } })
    .sort({ demandScore: -1 }).limit(limitNum).toArray()

  // For each skill × region, count training programs
  const matrix = await Promise.all(topSkills.map(async skill => {
    const regionData = await Promise.all(MAHARASHTRA_REGIONS.slice(0, 5).map(async region => {
      const count = await db.collection('training_providers').countDocuments({
        region, isDeleted: { $ne: true },
      })
      return { region, providerCount: count }
    }))
    return { skillId: skill._id, skillName: skill.name, category: skill.category, demandScore: skill.demandScore || 0, regions: regionData }
  }))

  res.json({ matrix, skills: topSkills.length, regions: MAHARASHTRA_REGIONS.slice(0, 5) })
}))

// ── Protected writes ──────────────────────────────────────────────────────────
router.use(requireAuth)

router.post('/regional-gaps/record', requireRole('government'), asyncHandler(async (req, res) => {
  const { region, skillName, canonicalId, priority = 1, demandScore, notes = '' } = req.body
  if (!region?.trim())    throw Object.assign(new Error('region is required'), { statusCode: 400 })
  if (!skillName?.trim()) throw Object.assign(new Error('skillName is required'), { statusCode: 400 })

  const db  = getDatabase()
  const now = new Date()
  const doc = {
    _id: randomUUID(), region, skillId: canonicalId || null, skillName,
    priority, demandScore: demandScore || null, notes,
    recordedBy: req.user.id, recordedAt: now, updatedAt: now,
  }
  await db.collection('regional_skill_gaps').insertOne(doc)
  res.status(201).json({ regionalGap: pub(doc) })
}))

export default router
