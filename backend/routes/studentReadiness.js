/**
 * Phase B10 — Student Skill Gap & Job Readiness
 * Mounted at /api/student
 *
 * Learner-only endpoints:
 *   GET/PATCH /target-role       — selected target job role
 *   GET/PATCH /current-skills    — learner's current skill inventory
 *   GET       /required-skills   — requirements for the selected role
 *   GET       /readiness         — complete skill-gap and readiness report
 */

import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { getDatabase } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { LEVEL_NAMES, matchSkills } from '../services/matcher.js'
import { normalizeTerms } from '../services/normalization.js'

const router = Router()
router.use(requireAuth, requireRole('learner'))

const MAX_SKILLS = 200

function bad(message) {
  return Object.assign(new Error(message), { statusCode: 400 })
}

function notFound(message) {
  return Object.assign(new Error(message), { statusCode: 404 })
}

function publicJobRole(role) {
  if (!role) return null
  return {
    id: role._id,
    title: role.title,
    industryId: role.industryId,
    status: role.status,
    location: role.location || null,
  }
}

async function findStudent(userId) {
  return getDatabase().collection('students').findOne({ userId })
}

async function findTargetRole(student) {
  const roles = getDatabase().collection('job_roles')

  if (student.targetJobRoleId) {
    return roles.findOne({ _id: student.targetJobRoleId, isDeleted: { $ne: true } })
  }

  // Profiles created before B10 may contain only the human-readable role title.
  if (typeof student.targetRole === 'string' && student.targetRole.trim()) {
    const escaped = student.targetRole.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return roles.findOne({
      title: { $regex: new RegExp(`^${escaped}$`, 'i') },
      isDeleted: { $ne: true },
    })
  }

  return null
}

async function requireStudentWithTargetRole(userId) {
  const student = await findStudent(userId)
  if (!student) throw notFound('Student profile not found')

  const role = await findTargetRole(student)
  if (!role) {
    throw bad('No valid target job role is configured. Set one with PATCH /api/student/target-role')
  }

  return { student, role }
}

function validateCurrentSkills(currentSkills) {
  if (!Array.isArray(currentSkills)) throw bad('currentSkills must be an array')
  if (currentSkills.length > MAX_SKILLS) throw bad(`currentSkills must not exceed ${MAX_SKILLS} items`)

  for (const [index, skill] of currentSkills.entries()) {
    if (!skill || typeof skill !== 'object') throw bad(`currentSkills[${index}] must be an object`)
    if (!skill.skillId && !skill.skillName && !skill.name) {
      throw bad(`currentSkills[${index}] must include skillId or skillName`)
    }
    if (skill.skillId !== undefined && (typeof skill.skillId !== 'string' || !skill.skillId.trim())) {
      throw bad(`currentSkills[${index}].skillId must be a non-empty string`)
    }
    for (const field of ['skillName', 'name']) {
      if (skill[field] !== undefined && (typeof skill[field] !== 'string' || !skill[field].trim())) {
        throw bad(`currentSkills[${index}].${field} must be a non-empty string`)
      }
    }
    const level = skill.level || skill.selfRating
    if (level && !LEVEL_NAMES.includes(level)) {
      throw bad(`currentSkills[${index}].level must be one of: ${LEVEL_NAMES.join(', ')}`)
    }
  }
}

/**
 * Resolve name-only current skills before persisting them. Unrecognized terms
 * are retained as entered so a learner never loses data while the catalogue is
 * still being curated.
 */
async function canonicalizeCurrentSkills(currentSkills) {
  validateCurrentSkills(currentSkills)

  const db = getDatabase()
  const ids = [...new Set(currentSkills.map(skill => skill.skillId).filter(Boolean))]
  const docs = ids.length
    ? await db.collection('skills').find({ _id: { $in: ids }, isDeleted: { $ne: true } }).toArray()
    : []
  const skillsById = new Map(docs.map(skill => [skill._id, skill]))

  if (docs.length !== ids.length) throw bad('One or more current skillIds do not exist')

  const nameOnly = currentSkills
    .map((skill, index) => ({ index, name: skill.skillName || skill.name || '' }))
    .filter(item => !currentSkills[item.index].skillId && item.name.trim())
  const normalized = nameOnly.length ? await normalizeTerms(nameOnly.map(item => item.name.trim())) : []
  const normalizedByIndex = new Map(nameOnly.map((item, index) => [item.index, normalized[index]]))

  return currentSkills.map((skill, index) => {
    const providedName = (skill.skillName || skill.name || '').trim()
    const canonical = skill.skillId
      ? skillsById.get(skill.skillId)
      : normalizedByIndex.get(index)

    return {
      skillId: skill.skillId || canonical?.canonicalId || null,
      skillName: canonical?.name || canonical?.canonicalName || providedName,
      level: skill.level || skill.selfRating || null,
    }
  })
}

function severity(requirement = 'required') {
  if (requirement === 'required') return 'critical'
  if (requirement === 'preferred') return 'high'
  return 'medium'
}

function gapItem(gap) {
  return {
    canonicalId: gap.canonicalId,
    skillName: gap.skillName,
    requiredLevel: gap.requiredLevel,
    requirement: gap.requirement,
    priority: severity(gap.requirement),
  }
}

function buildReadinessReport(student, role, match) {
  const partialSkills = match.matched
    .filter(skill => skill.levelGap > 0)
    .map(skill => ({
      canonicalId: skill.canonicalId,
      skillName: skill.skillName,
      currentLevel: skill.learnerLevel,
      requiredLevel: skill.requiredLevel,
      levelGap: skill.levelGap,
      requirement: skill.requirement,
      priority: severity(skill.requirement),
    }))

  const strengths = match.matched
    .filter(skill => skill.levelGap <= 0)
    .map(skill => ({
      canonicalId: skill.canonicalId,
      skillName: skill.skillName,
      currentLevel: skill.learnerLevel,
      requiredLevel: skill.requiredLevel,
      status: skill.levelGap < 0 ? 'exceeds_requirement' : 'meets_requirement',
    }))

  return {
    targetJobRole: publicJobRole(role),
    currentSkills: student.currentSkills || [],
    requiredSkills: role.requiredSkills || [],
    missingSkills: match.gaps.map(gapItem),
    partialSkills,
    strengths,
    skillGapScore: Math.max(0, 100 - match.readinessScore),
    jobReadinessScore: match.readinessScore,
    gapSeverity: match.gapSeverity,
    summary: {
      totalRequired: match.totalRequired,
      missingCount: match.gapCount,
      partialCount: partialSkills.length,
      strengthCount: strengths.length,
      surplusCount: match.surplusCount,
    },
    calculatedAt: match.calculatedAt,
  }
}

// ---------------------------------------------------------------------------
// Target job role
// ---------------------------------------------------------------------------

router.get('/target-role', asyncHandler(async (req, res) => {
  const student = await findStudent(req.user.id)
  if (!student) throw notFound('Student profile not found')

  const targetJobRole = await findTargetRole(student)
  res.json({ targetJobRole: publicJobRole(targetJobRole), targetRole: student.targetRole || null })
}))

router.patch('/target-role', asyncHandler(async (req, res) => {
  const { jobRoleId } = req.body
  if (typeof jobRoleId !== 'string' || !jobRoleId.trim()) throw bad('jobRoleId is required')

  const role = await getDatabase().collection('job_roles')
    .findOne({ _id: jobRoleId.trim(), isDeleted: { $ne: true } })
  if (!role) throw notFound('Target job role not found')

  const now = new Date()
  await getDatabase().collection('students').findOneAndUpdate(
    { userId: req.user.id },
    {
      $set: { targetJobRoleId: role._id, targetRole: role.title, updatedAt: now },
      $setOnInsert: { _id: randomUUID(), userId: req.user.id, currentSkills: [], createdAt: now },
    },
    { upsert: true },
  )

  res.json({ targetJobRole: publicJobRole(role) })
}))

// ---------------------------------------------------------------------------
// Current and required skills
// ---------------------------------------------------------------------------

router.get('/current-skills', asyncHandler(async (req, res) => {
  const student = await findStudent(req.user.id)
  if (!student) throw notFound('Student profile not found')
  const currentSkills = student.currentSkills || []
  res.json({ currentSkills, count: currentSkills.length })
}))

router.patch('/current-skills', asyncHandler(async (req, res) => {
  const currentSkills = await canonicalizeCurrentSkills(req.body.currentSkills)
  const now = new Date()

  await getDatabase().collection('students').findOneAndUpdate(
    { userId: req.user.id },
    {
      $set: { currentSkills, updatedAt: now },
      $setOnInsert: { _id: randomUUID(), userId: req.user.id, createdAt: now },
    },
    { upsert: true },
  )

  res.json({ currentSkills, count: currentSkills.length })
}))

router.get('/required-skills', asyncHandler(async (req, res) => {
  const { role } = await requireStudentWithTargetRole(req.user.id)
  const requiredSkills = role.requiredSkills || []
  res.json({ targetJobRole: publicJobRole(role), requiredSkills, count: requiredSkills.length })
}))

// ---------------------------------------------------------------------------
// Complete gap and readiness report
// ---------------------------------------------------------------------------

router.get('/readiness', asyncHandler(async (req, res) => {
  const { student, role } = await requireStudentWithTargetRole(req.user.id)
  const currentSkills = student.currentSkills || []
  validateCurrentSkills(currentSkills)
  const match = await matchSkills(role.requiredSkills || [], currentSkills)
  res.json({ report: buildReadinessReport(student, role, match) })
}))

export default router
