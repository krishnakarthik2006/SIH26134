import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { getDatabase } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

const router = Router()

// All profile routes require authentication
router.use(requireAuth)

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function validationError(message) {
  const error = new Error(message)
  error.statusCode = 400
  return error
}

function notFoundError(message) {
  const error = new Error(message)
  error.statusCode = 404
  return error
}

/** Strip MongoDB internal fields before sending to the client */
function publicProfile(doc) {
  // eslint-disable-next-line no-unused-vars
  const { _id, ...rest } = doc
  return { id: _id, ...rest }
}

// ---------------------------------------------------------------------------
// Student profile  (/api/profiles/student)
// ---------------------------------------------------------------------------

/**
 * GET /api/profiles/student
 * Returns the learner profile for the authenticated user.
 * If no profile exists yet a 404 is returned — the client should POST to create.
 */
router.get(
  '/student',
  requireRole('learner'),
  asyncHandler(async (request, response) => {
    const profile = await getDatabase()
      .collection('students')
      .findOne({ userId: request.user.id })

    if (!profile) throw notFoundError('Student profile not found')
    response.json({ profile: publicProfile(profile) })
  }),
)

/**
 * PATCH /api/profiles/student
 * Upsert the learner profile for the authenticated user.
 *
 * Accepted fields:
 *   targetRole, currentSkills[], educationLevel, location,
 *   bio, linkedinUrl, resumeUrl, preferredLearningMode
 */
router.patch(
  '/student',
  requireRole('learner'),
  asyncHandler(async (request, response) => {
    const allowedFields = [
      'targetRole',
      'currentSkills',
      'educationLevel',
      'location',
      'bio',
      'linkedinUrl',
      'resumeUrl',
      'preferredLearningMode',
    ]

    const update = {}
    for (const field of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(request.body, field)) {
        update[field] = request.body[field]
      }
    }

    if (Object.keys(update).length === 0) throw validationError('No valid fields provided')

    if (update.currentSkills !== undefined && !Array.isArray(update.currentSkills)) {
      throw validationError('currentSkills must be an array')
    }

    const allowedLearningModes = ['online', 'offline', 'hybrid']
    if (update.preferredLearningMode && !allowedLearningModes.includes(update.preferredLearningMode)) {
      throw validationError(`preferredLearningMode must be one of: ${allowedLearningModes.join(', ')}`)
    }

    const db = getDatabase()
    const now = new Date()

    const result = await db.collection('students').findOneAndUpdate(
      { userId: request.user.id },
      {
        $set: { ...update, updatedAt: now },
        $setOnInsert: {
          _id: randomUUID(),
          userId: request.user.id,
          createdAt: now,
        },
      },
      { upsert: true, returnDocument: 'after' },
    )

    response.json({ profile: publicProfile(result) })
  }),
)

// ---------------------------------------------------------------------------
// Training provider profile  (/api/profiles/training)
// ---------------------------------------------------------------------------

/**
 * GET /api/profiles/training
 * Returns the training provider profile for the authenticated user.
 */
router.get(
  '/training',
  requireRole('training'),
  asyncHandler(async (request, response) => {
    const profile = await getDatabase()
      .collection('training_providers')
      .findOne({ userId: request.user.id })

    if (!profile) throw notFoundError('Training provider profile not found')
    response.json({ profile: publicProfile(profile) })
  }),
)

/**
 * PATCH /api/profiles/training
 * Upsert the training provider profile for the authenticated user.
 *
 * Accepted fields:
 *   organizationName, type, affiliatedUniversity, accreditation,
 *   website, location, district, focusAreas[], contactEmail, contactPhone, bio
 */
router.patch(
  '/training',
  requireRole('training'),
  asyncHandler(async (request, response) => {
    const allowedFields = [
      'organizationName',
      'type',
      'affiliatedUniversity',
      'accreditation',
      'website',
      'location',
      'district',
      'focusAreas',
      'contactEmail',
      'contactPhone',
      'bio',
    ]

    const update = {}
    for (const field of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(request.body, field)) {
        update[field] = request.body[field]
      }
    }

    if (Object.keys(update).length === 0) throw validationError('No valid fields provided')

    if (update.focusAreas !== undefined && !Array.isArray(update.focusAreas)) {
      throw validationError('focusAreas must be an array')
    }

    if (update.contactEmail) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(update.contactEmail)) {
        throw validationError('contactEmail must be a valid email address')
      }
    }

    const db = getDatabase()
    const now = new Date()

    const result = await db.collection('training_providers').findOneAndUpdate(
      { userId: request.user.id },
      {
        $set: { ...update, updatedAt: now },
        $setOnInsert: {
          _id: randomUUID(),
          userId: request.user.id,
          createdAt: now,
        },
      },
      { upsert: true, returnDocument: 'after' },
    )

    response.json({ profile: publicProfile(result) })
  }),
)

// ---------------------------------------------------------------------------
// Industry profile  (/api/profiles/industry)
// ---------------------------------------------------------------------------

/**
 * GET /api/profiles/industry
 * Returns the industry (employer) profile for the authenticated user.
 */
router.get(
  '/industry',
  requireRole('industry'),
  asyncHandler(async (request, response) => {
    const profile = await getDatabase()
      .collection('industries')
      .findOne({ userId: request.user.id })

    if (!profile) throw notFoundError('Industry profile not found')
    response.json({ profile: publicProfile(profile) })
  }),
)

/**
 * PATCH /api/profiles/industry
 * Upsert the industry profile for the authenticated user.
 *
 * Accepted fields:
 *   companyName, sector, subSector, companySize, headquarters,
 *   operatingRegions[], website, contactEmail, contactPhone,
 *   hiringVolume, bio
 */
router.patch(
  '/industry',
  requireRole('industry'),
  asyncHandler(async (request, response) => {
    const allowedFields = [
      'companyName',
      'sector',
      'subSector',
      'companySize',
      'headquarters',
      'operatingRegions',
      'website',
      'contactEmail',
      'contactPhone',
      'hiringVolume',
      'bio',
    ]

    const update = {}
    for (const field of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(request.body, field)) {
        update[field] = request.body[field]
      }
    }

    if (Object.keys(update).length === 0) throw validationError('No valid fields provided')

    if (update.operatingRegions !== undefined && !Array.isArray(update.operatingRegions)) {
      throw validationError('operatingRegions must be an array')
    }

    const allowedCompanySizes = ['1-50', '51-200', '201-500', '501-1000', '1000+']
    if (update.companySize && !allowedCompanySizes.includes(update.companySize)) {
      throw validationError(`companySize must be one of: ${allowedCompanySizes.join(', ')}`)
    }

    if (update.contactEmail) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(update.contactEmail)) {
        throw validationError('contactEmail must be a valid email address')
      }
    }

    const db = getDatabase()
    const now = new Date()

    const result = await db.collection('industries').findOneAndUpdate(
      { userId: request.user.id },
      {
        $set: { ...update, updatedAt: now },
        $setOnInsert: {
          _id: randomUUID(),
          userId: request.user.id,
          createdAt: now,
        },
      },
      { upsert: true, returnDocument: 'after' },
    )

    response.json({ profile: publicProfile(result) })
  }),
)

// ---------------------------------------------------------------------------
// Government / Admin profile  (/api/profiles/government)
// ---------------------------------------------------------------------------

/**
 * GET /api/profiles/government
 * Returns the government / policy officer profile for the authenticated user.
 */
router.get(
  '/government',
  requireRole('government'),
  asyncHandler(async (request, response) => {
    // Government users are stored in a dedicated 'government_profiles' collection.
    // Using a separate collection keeps the existing 'industries' and other domain
    // collections clean, and the collection is auto-created via ensureCollection().
    const profile = await getDatabase()
      .collection('government_profiles')
      .findOne({ userId: request.user.id })

    if (!profile) throw notFoundError('Government profile not found')
    response.json({ profile: publicProfile(profile) })
  }),
)

/**
 * PATCH /api/profiles/government
 * Upsert the government profile for the authenticated user.
 *
 * Accepted fields:
 *   designation, department, ministry, jurisdiction, district,
 *   region, officeAddress, contactEmail, contactPhone, bio
 */
router.patch(
  '/government',
  requireRole('government'),
  asyncHandler(async (request, response) => {
    const allowedFields = [
      'designation',
      'department',
      'ministry',
      'jurisdiction',
      'district',
      'region',
      'officeAddress',
      'contactEmail',
      'contactPhone',
      'bio',
    ]

    const update = {}
    for (const field of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(request.body, field)) {
        update[field] = request.body[field]
      }
    }

    if (Object.keys(update).length === 0) throw validationError('No valid fields provided')

    if (update.contactEmail) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(update.contactEmail)) {
        throw validationError('contactEmail must be a valid email address')
      }
    }

    const db = getDatabase()
    const now = new Date()

    const result = await db.collection('government_profiles').findOneAndUpdate(
      { userId: request.user.id },
      {
        $set: { ...update, updatedAt: now },
        $setOnInsert: {
          _id: randomUUID(),
          userId: request.user.id,
          createdAt: now,
        },
      },
      { upsert: true, returnDocument: 'after' },
    )

    response.json({ profile: publicProfile(result) })
  }),
)

// ---------------------------------------------------------------------------
// Generic "my profile" shortcut  (/api/profiles/me)
// ---------------------------------------------------------------------------

/**
 * GET /api/profiles/me
 * Returns the profile document for the currently authenticated user,
 * regardless of role.  Delegates to the correct collection automatically.
 */
router.get(
  '/me',
  asyncHandler(async (request, response) => {
    const { role, id } = request.user

    const collectionMap = {
      learner: 'students',
      training: 'training_providers',
      industry: 'industries',
      government: 'government_profiles',
    }

    const collectionName = collectionMap[role]
    if (!collectionName) {
      const error = new Error('Unknown role — cannot resolve profile collection')
      error.statusCode = 500
      throw error
    }

    const profile = await getDatabase().collection(collectionName).findOne({ userId: id })
    if (!profile) throw notFoundError('Profile not found — complete your profile setup first')

    response.json({ profile: publicProfile(profile), role })
  }),
)

export default router
