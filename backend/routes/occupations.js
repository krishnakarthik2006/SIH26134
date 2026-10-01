import { Router } from 'express'
import { getDatabase } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'

const router = Router()

function badRequest(message) {
  return Object.assign(new Error(message), { statusCode: 400 })
}

function publicOccupation(doc, summary = false) {
  if (!doc) return null
  const { _id, ...occupation } = doc
  const result = { id: _id, ...occupation }
  if (summary) {
    result.essentialSkills = (doc.essentialSkills || []).slice(0, 8)
    result.softwareSkills = (doc.softwareSkills || []).slice(0, 6)
    result.education = (doc.education || []).slice(0, 4)
    result.relatedOccupations = (doc.relatedOccupations || []).slice(0, 5)
  }
  return result
}

router.get('/', asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1)
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20))
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  const filter = {}

  if (query) {
    const safeQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = new RegExp(safeQuery, 'i')
    filter.$or = [
      { socCode: match },
      { title: match },
      { description: match },
      { 'essentialSkills.name': match },
      { 'softwareSkills.name': match },
    ]
  }
  if (req.query.hotOnly === 'true') filter['softwareSkills.hotTechnology'] = true

  const collection = getDatabase().collection('occupations')
  const total = await collection.countDocuments(filter)
  const docs = await collection.find(filter)
    .project({ socCode: 1, title: 1, description: 1, essentialSkills: 1, softwareSkills: 1, education: 1, relatedOccupations: 1, source: 1 })
    .sort({ title: 1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .toArray()

  res.json({
    occupations: docs.map((doc) => publicOccupation(doc, true)),
    pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    source: 'Career reference data',
  })
}))

router.get('/:socCode', asyncHandler(async (req, res) => {
  if (!/^\d{2}-\d{4}\.\d{2}$/.test(req.params.socCode)) throw badRequest('socCode must use the standard occupation code format')
  const occupation = await getDatabase().collection('occupations').findOne({ socCode: req.params.socCode })
  if (!occupation) return res.status(404).json({ error: 'Occupation not found' })
  res.json({ occupation: publicOccupation(occupation), source: 'Career reference data' })
}))

export default router