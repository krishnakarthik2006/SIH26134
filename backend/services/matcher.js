/**
 * Skill Matching Engine — Phase B9
 *
 * Given:
 *   requiredSkills[]  — skills a job role demands
 *   currentSkills[]   — skills a learner currently has
 *
 * Produces:
 *   matched[]         — skills the learner has that satisfy a requirement
 *   gaps[]            — required skills the learner is missing or under-proficient in
 *   surplus[]         — learner skills not required by the role
 *   readinessScore    — 0-100 overall match percentage
 *   gapSeverity       — critical | moderate | low  (based on gap count + priority)
 *
 * ─── Skill representation accepted ──────────────────────────────────────────
 * Both input arrays accept items in any of these shapes:
 *
 *   { skillId }                         — canonical UUID only
 *   { skillName }                       — raw name string (will be normalized)
 *   { skillId, skillName }              — preferred: id used, name as fallback
 *   { skillId, skillName, level }       — with proficiency level
 *   { skillId, skillName, level, requirement }  — full job-side descriptor
 *   { skillId, skillName, level, selfRating }   — full learner-side descriptor
 *
 * Level values (proficiency):  beginner | intermediate | advanced | expert
 * Requirement values:          required | preferred | nice-to-have
 *
 * ─── Matching algorithm ──────────────────────────────────────────────────────
 * For each required skill R:
 *   1. Find the canonical ID for R  (via normalizeTerms if only name given)
 *   2. Look for a learner skill C where canonicalId(C) === canonicalId(R)
 *   3. If found → MATCHED, compute level gap (requiredLevel - learnerLevel)
 *   4. If not found → GAP, assign priority based on requirement field
 *
 * Readiness score formula:
 *   base  = matchedCount / totalRequired  (0–1)
 *   bonus = sum(levelBonuses) / totalRequired
 *   score = round((base * 0.85 + bonus * 0.15) * 100)
 *
 * Level gap:
 *   positive → learner is under-proficient (gap)
 *   zero     → exact level match
 *   negative → learner exceeds requirement
 */

import { normalizeTerms } from './normalization.js'
import { getDatabase }    from '../db.js'

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

export const LEVEL_ORDER = { beginner: 1, intermediate: 2, advanced: 3, expert: 4 }
export const LEVEL_NAMES = Object.keys(LEVEL_ORDER)
export const REQ_PRIORITY = { required: 3, preferred: 2, 'nice-to-have': 1 }

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/** Numeric level value, or 0 if null/unknown */
function levelNum(level) {
  return LEVEL_ORDER[level?.toLowerCase()] || 0
}

/** Classify overall gap severity from gaps array */
function computeGapSeverity(gaps) {
  if (gaps.length === 0) return 'none'
  const criticalCount  = gaps.filter(g => g.requirement === 'required').length
  const totalRequired  = gaps.length
  const ratio          = criticalCount / totalRequired
  if (criticalCount >= 3 || ratio >= 0.5) return 'critical'
  if (criticalCount >= 1 || totalRequired >= 3) return 'moderate'
  return 'low'
}

/** Resolve a skill item to its canonical skill ID.
 *  Uses skillId if present and valid, otherwise normalizes skillName. */
async function resolveCanonicalId(item, normCache) {
  // If the item already provides a skillId, trust it
  if (item.skillId) return item.skillId

  // Normalize by name
  const name = item.skillName || item.name || ''
  if (!name.trim()) return null

  if (!normCache.has(name)) {
    const results = await normalizeTerms([name])
    normCache.set(name, results[0]?.canonicalId || null)
  }
  return normCache.get(name)
}

// ─── MAIN MATCH FUNCTION ─────────────────────────────────────────────────────

/**
 * matchSkills — core matching function
 *
 * @param {object[]} requiredSkills  — job-side skill list
 * @param {object[]} currentSkills   — learner-side skill list
 * @returns {Promise<MatchResult>}
 */
export async function matchSkills(requiredSkills, currentSkills) {
  if (!Array.isArray(requiredSkills) || !Array.isArray(currentSkills)) {
    throw Object.assign(new Error('requiredSkills and currentSkills must be arrays'), { statusCode: 400 })
  }

  const normCache = new Map()  // name → canonicalId cache to avoid duplicate DB calls

  // Resolve all canonical IDs in parallel batches
  const resolvedRequired = await Promise.all(
    requiredSkills.map(async (s) => ({
      ...s,
      _canonicalId: await resolveCanonicalId(s, normCache),
      _displayName: s.skillName || s.name || s.skillId || 'Unknown',
      _level:       levelNum(s.level),
      _requirement: s.requirement || 'required',
    })),
  )

  const resolvedCurrent = await Promise.all(
    currentSkills.map(async (s) => ({
      ...s,
      _canonicalId: await resolveCanonicalId(s, normCache),
      _displayName: s.skillName || s.name || s.skillId || 'Unknown',
      _level:       levelNum(s.level || s.selfRating),
    })),
  )

  // Build a fast lookup: canonicalId → current skill entry
  const currentMap = new Map()
  for (const cs of resolvedCurrent) {
    if (cs._canonicalId) currentMap.set(cs._canonicalId, cs)
  }

  const matched = []
  const gaps    = []
  let   bonusSum = 0

  for (const req of resolvedRequired) {
    const learnerSkill = req._canonicalId ? currentMap.get(req._canonicalId) : undefined

    if (learnerSkill) {
      // ── MATCHED ────────────────────────────────────────────────────────────
      const levelGap   = req._level - learnerSkill._level  // positive = under-proficient
      const levelBonus = levelGap <= 0 ? 1 : Math.max(0, 1 - levelGap * 0.25)
      bonusSum += levelBonus

      matched.push({
        canonicalId:      req._canonicalId,
        skillName:        req._displayName,
        requiredLevel:    req.level    || null,
        learnerLevel:     learnerSkill.level || learnerSkill.selfRating || null,
        levelGap,                                  // ≤0 means learner meets/exceeds
        levelGapLabel:    levelGap <= 0
          ? (levelGap < 0 ? 'exceeds_requirement' : 'exact_match')
          : (levelGap === 1 ? 'one_level_below' : 'significantly_below'),
        requirement:      req._requirement,
        confidence:       learnerSkill._canonicalId ? 0.99 : 0.85,
      })
    } else {
      // ── GAP ───────────────────────────────────────────────────────────────
      gaps.push({
        canonicalId:   req._canonicalId,
        skillName:     req._displayName,
        requiredLevel: req.level || null,
        requirement:   req._requirement,
        priority:      REQ_PRIORITY[req._requirement] || 1,
        priorityLabel: req._requirement,
      })
    }
  }

  // ── SURPLUS (learner skills not required) ──────────────────────────────────
  const requiredIds = new Set(resolvedRequired.map(r => r._canonicalId).filter(Boolean))
  const surplus     = resolvedCurrent
    .filter(cs => cs._canonicalId && !requiredIds.has(cs._canonicalId))
    .map(cs => ({
      canonicalId: cs._canonicalId,
      skillName:   cs._displayName,
      level:       cs.level || cs.selfRating || null,
    }))

  // ── READINESS SCORE ────────────────────────────────────────────────────────
  const totalRequired = resolvedRequired.length
  const baseScore     = totalRequired === 0 ? 1 : matched.length / totalRequired
  const bonusScore    = totalRequired === 0 ? 0 : bonusSum / totalRequired
  const readinessScore = Math.round((baseScore * 0.85 + bonusScore * 0.15) * 100)

  // ── GAP SEVERITY ──────────────────────────────────────────────────────────
  const gapSeverity = computeGapSeverity(gaps)

  // Sort gaps: required first, then preferred, then nice-to-have
  gaps.sort((a, b) => b.priority - a.priority)

  return {
    readinessScore,
    gapSeverity,
    totalRequired,
    matchedCount:   matched.length,
    gapCount:       gaps.length,
    surplusCount:   surplus.length,
    matched,
    gaps,
    surplus,
    calculatedAt:   new Date().toISOString(),
  }
}

// ─── GAP ANALYSIS (with persistence) ─────────────────────────────────────────

/**
 * computeAndPersistGap
 *
 * Runs matchSkills() and persists results to:
 *   skill_gaps collection      — one doc per gap entry
 *   readiness_scores collection — one upserted summary doc
 *
 * @param {object} params
 * @param {string} params.subjectType   — 'learner' | 'training_program' | 'team'
 * @param {string} params.subjectId     — UUID of the subject (e.g. student._id)
 * @param {string} params.targetRole    — human-readable role name
 * @param {string} [params.jobRoleId]   — UUID of job_roles document
 * @param {object[]} params.requiredSkills
 * @param {object[]} params.currentSkills
 * @param {string} params.computedBy    — user ID who triggered the analysis
 * @returns {Promise<{ matchResult, readinessDoc, gapDocs }>}
 */
export async function computeAndPersistGap({
  subjectType, subjectId, targetRole, jobRoleId = null,
  requiredSkills, currentSkills, computedBy,
}) {
  const result = await matchSkills(requiredSkills, currentSkills)
  const db     = getDatabase()
  const now    = new Date()

  // ── Persist individual gap records ────────────────────────────────────────
  const gapDocs = result.gaps.map(gap => ({
    _id:          newId(),
    subjectType,
    subjectId,
    targetRole,
    jobRoleId,
    canonicalId:   gap.canonicalId,
    skillName:     gap.skillName,
    requiredLevel: gap.requiredLevel,
    requirement:   gap.requirement,
    priority:      gap.priority,
    status:        'open',
    identifiedAt:  now,
    updatedAt:     now,
  }))

  // Remove old open gaps for this subject/role before inserting new ones
  await db.collection('skill_gaps').deleteMany({ subjectType, subjectId, targetRole, status: 'open' })
  if (gapDocs.length > 0) await db.collection('skill_gaps').insertMany(gapDocs)

  // ── Upsert readiness score ─────────────────────────────────────────────────
  const readinessDoc = {
    subjectType,
    subjectId,
    targetRole,
    jobRoleId,
    readinessScore:  result.readinessScore,
    gapSeverity:     result.gapSeverity,
    totalRequired:   result.totalRequired,
    matchedCount:    result.matchedCount,
    gapCount:        result.gapCount,
    surplusCount:    result.surplusCount,
    matchedSkills:   result.matched,
    gaps:            result.gaps,
    surplusSkills:   result.surplus,
    computedBy,
    calculatedAt:    now,
    updatedAt:       now,
  }

  await db.collection('readiness_scores').findOneAndUpdate(
    { subjectType, subjectId, targetRole },
    {
      $set:         readinessDoc,
      $setOnInsert: { _id: newId(), createdAt: now },
    },
    { upsert: true, returnDocument: 'after' },
  )

  const savedReadiness = await db.collection('readiness_scores').findOne({ subjectType, subjectId, targetRole })

  return { matchResult: result, readinessDoc: savedReadiness, gapDocs }
}

import { randomUUID } from 'node:crypto'

/** Thin wrapper so internal code stays readable */
function newId() { return randomUUID() }
