/**
 * Recommendation Engine — Phase B11
 *
 * Given a learner's skill gaps and a catalogue of courses, this engine:
 *   1. Finds courses that cover at least one missing skill
 *   2. Scores each course on five weighted dimensions
 *   3. Generates a plain-English explanation plus structured reasons
 *   4. Ranks critical (required) skill coverage ahead of nicer-to-have skills
 *
 * ─── Scoring dimensions ──────────────────────────────────────────────────────
 *
 *  gapCoverage   (40 %)
 *    Fraction of gap priority-weight covered by this course
 *    (required=3, preferred=2, nice-to-have=1).
 *
 *  demandWeight  (25 %)
 *    Employer demand of the missing skills this course actually closes,
 *    blended with overall course demand.
 *
 *  levelFit      (20 %)
 *    How well course proficiency matches the required level.
 *    Exact → 1.0, one level off → 0.7, two → 0.4, else 0.1.
 *
 *  providerQuality (10 %)
 *    Accreditation + certificationOffered + affiliated university.
 *
 *  freshness     (5 %)
 *    Recency of the published curriculum.
 *
 *  relevanceScore = round(sum(dimension * weight) * 100)   (0 – 100)
 */

import { getDatabase } from '../db.js'
import { LEVEL_ORDER } from './matcher.js'

export const SCORING_WEIGHTS = {
  gapCoverage:     0.40,
  demandWeight:    0.25,
  levelFit:        0.20,
  providerQuality: 0.10,
  freshness:       0.05,
}

const W = SCORING_WEIGHTS

const PRIORITY_WEIGHT = { required: 3, preferred: 2, 'nice-to-have': 1 }

const PRIORITY_FROM_LABEL = {
  required: 'required',
  preferred: 'preferred',
  'nice-to-have': 'nice-to-have',
  critical: 'required',
  high: 'preferred',
  medium: 'nice-to-have',
  low: 'nice-to-have',
}

function levelNum(level) {
  return LEVEL_ORDER[level?.toLowerCase()] ?? 0
}

function daysSince(date) {
  if (!date) return Infinity
  return (Date.now() - new Date(date).getTime()) / 86_400_000
}

function freshnessScore(date) {
  const d = daysSince(date)
  if (d <= 30)  return 1.0
  if (d <= 90)  return 0.8
  if (d <= 180) return 0.6
  if (d <= 365) return 0.4
  return 0.2
}

function levelFitScore(courseProficiency, requiredLevel) {
  if (!courseProficiency || !requiredLevel) return 0.5
  const diff = Math.abs(levelNum(courseProficiency) - levelNum(requiredLevel))
  if (diff === 0) return 1.0
  if (diff === 1) return 0.7
  if (diff === 2) return 0.4
  return 0.1
}

function providerQualityScore(provider, program) {
  let score = 0.4
  if (provider?.accreditation) score += 0.3
  if (program?.certificationOffered) score += 0.2
  if (provider?.affiliatedUniversity) score += 0.1
  return Math.min(1.0, score)
}

function round2(n) {
  return Math.round(n * 100) / 100
}

/**
 * Accept matcher gaps, B10 missingSkills (priority: critical|high|medium),
 * and ad-hoc { skillId, skillName, requirement } payloads.
 */
export function normalizeGaps(rawGaps = []) {
  return rawGaps.map((gap) => {
    const requirement = PRIORITY_FROM_LABEL[gap.requirement]
      || PRIORITY_FROM_LABEL[gap.priority]
      || PRIORITY_FROM_LABEL[gap.priorityLabel]
      || 'required'
    return {
      canonicalId:   gap.canonicalId || gap.skillId || null,
      skillName:     gap.skillName || gap.name || null,
      requiredLevel: gap.requiredLevel || gap.level || null,
      requirement,
    }
  }).filter(g => g.canonicalId || g.skillName)
}

function skillKeysFromGaps(gaps) {
  const skillIds = []
  const skillNames = []
  for (const gap of gaps) {
    if (gap.canonicalId) skillIds.push(gap.canonicalId)
    if (gap.skillName) {
      skillNames.push(gap.skillName)
      skillNames.push(gap.skillName.toLowerCase())
    }
  }
  return {
    skillIds: [...new Set(skillIds)],
    skillNames: [...new Set(skillNames.filter(Boolean))],
  }
}

function programCoversGap(coveredIds, coveredNames, gap) {
  if (gap.canonicalId && coveredIds.has(gap.canonicalId)) return true
  const name = (gap.skillName || '').toLowerCase()
  return Boolean(name && coveredNames.has(name))
}

/**
 * Load active training programs whose latest published curriculum covers
 * at least one of the supplied skill ids / names.
 */
export async function loadEnrichedPrograms(skillKeys) {
  const db = getDatabase()
  const skillIds = skillKeys instanceof Set
    ? [...skillKeys].filter(k => typeof k === 'string' && k.length >= 32)
    : (skillKeys.skillIds || [])
  const skillNames = skillKeys instanceof Set
    ? [...skillKeys].filter(k => typeof k === 'string' && k.length < 32)
    : (skillKeys.skillNames || [])

  const or = []
  if (skillIds.length) or.push({ 'skillsCovered.skillId': { $in: skillIds } })
  if (skillNames.length) {
    or.push({ 'skillsCovered.skillName': { $in: skillNames } })
  }
  if (or.length === 0) return []

  const allRelevantCurriculums = await db.collection('curriculums').find({
    status:    'published',
    isDeleted: { $ne: true },
    $or: or,
  }).toArray()

  if (allRelevantCurriculums.length === 0) return []

  const latestByProgram = new Map()
  for (const cur of allRelevantCurriculums) {
    const existing = latestByProgram.get(cur.trainingProgramId)
    if (!existing || cur.updatedAt > existing.updatedAt) {
      latestByProgram.set(cur.trainingProgramId, cur)
    }
  }

  const programIds = [...latestByProgram.keys()]
  const programs = await db.collection('training_programs').find({
    _id:       { $in: programIds },
    status:    'active',
    isDeleted: { $ne: true },
  }).toArray()

  if (programs.length === 0) return []

  const providerIds = [...new Set(programs.map(p => p.providerId).filter(Boolean))]
  const providers   = providerIds.length
    ? await db.collection('training_providers').find({
        _id: { $in: providerIds }, isDeleted: { $ne: true },
      }).toArray()
    : []
  const providerMap = new Map(providers.map(p => [p._id, p]))

  const allSkillIds = new Set()
  for (const cur of latestByProgram.values()) {
    for (const s of cur.skillsCovered || []) {
      if (s.skillId) allSkillIds.add(s.skillId)
    }
  }
  const skillDocs = allSkillIds.size
    ? await db.collection('skills').find(
        { _id: { $in: [...allSkillIds] }, isDeleted: { $ne: true } },
        { projection: { _id: 1, demandScore: 1, name: 1 } },
      ).toArray()
    : []
  const demandBySkillId = Object.fromEntries(skillDocs.map(s => [s._id, s.demandScore ?? 0]))

  return programs.map(prog => {
    const curriculum = latestByProgram.get(prog._id)
    const provider   = providerMap.get(prog.providerId) || null
    const covered    = curriculum?.skillsCovered || []
    const demands    = covered.map(s => demandBySkillId[s.skillId] ?? 0)
    const avgDemand  = demands.length
      ? demands.reduce((a, b) => a + b, 0) / demands.length
      : 0

    return {
      program: prog,
      curriculum,
      provider,
      skillsCovered: covered,
      avgDemandScore: avgDemand,
      demandBySkillId,
      providerQuality: providerQualityScore(provider, prog),
      freshness: freshnessScore(curriculum?.updatedAt || prog.updatedAt),
    }
  })
}

export function scoreProgram(ep, gaps) {
  const coveredIds   = new Set(ep.skillsCovered.map(s => s.skillId).filter(Boolean))
  const coveredNames = new Set(
    ep.skillsCovered.map(s => (s.skillName || '').toLowerCase()).filter(Boolean),
  )

  const coveredGaps = gaps.filter(gap => programCoversGap(coveredIds, coveredNames, gap))

  if (coveredGaps.length === 0) {
    return { scores: null, coveredGaps: [], uncoveredGaps: gaps, relevanceScore: 0 }
  }

  const uncoveredGaps = gaps.filter(gap => !programCoversGap(coveredIds, coveredNames, gap))

  const totalPriorityWeight = gaps.reduce((s, g) => s + (PRIORITY_WEIGHT[g.requirement] || 1), 0)
  const coveredPriorityWeight = coveredGaps.reduce((s, g) => s + (PRIORITY_WEIGHT[g.requirement] || 1), 0)
  const gapCoverage = totalPriorityWeight > 0 ? coveredPriorityWeight / totalPriorityWeight : 0

  const coveredDemands = coveredGaps.map(g => {
    if (g.canonicalId && ep.demandBySkillId?.[g.canonicalId] != null) {
      return ep.demandBySkillId[g.canonicalId]
    }
    return ep.avgDemandScore
  })
  const gapDemand = coveredDemands.length
    ? coveredDemands.reduce((a, b) => a + b, 0) / coveredDemands.length
    : ep.avgDemandScore
  const demandWeight = ((gapDemand * 0.7) + (ep.avgDemandScore * 0.3)) / 100

  let levelFitTotal = 0
  for (const gap of coveredGaps) {
    const coveredSkill = ep.skillsCovered.find(
      s => (s.skillId && s.skillId === gap.canonicalId) ||
           (s.skillName || '').toLowerCase() === (gap.skillName || '').toLowerCase(),
    )
    levelFitTotal += levelFitScore(coveredSkill?.proficiencyLevel || null, gap.requiredLevel)
  }
  const levelFit = coveredGaps.length > 0 ? levelFitTotal / coveredGaps.length : 0.5

  const providerQuality = ep.providerQuality
  const freshness       = ep.freshness

  const rawScore =
    gapCoverage     * W.gapCoverage     +
    demandWeight    * W.demandWeight    +
    levelFit        * W.levelFit        +
    providerQuality * W.providerQuality +
    freshness       * W.freshness

  const relevanceScore = Math.round(rawScore * 100)

  const scores = {
    gapCoverage:     round2(gapCoverage),
    demandWeight:    round2(demandWeight),
    levelFit:        round2(levelFit),
    providerQuality: round2(providerQuality),
    freshness:       round2(freshness),
  }

  return { scores, coveredGaps, uncoveredGaps, relevanceScore }
}

export function buildReasons(ep, coveredGaps, uncoveredGaps, scores, relevanceScore) {
  const reasons = []
  const criticalCovered  = coveredGaps.filter(g => g.requirement === 'required')
  const preferredCovered = coveredGaps.filter(g => g.requirement === 'preferred')
  const niceToHave       = coveredGaps.filter(g => g.requirement === 'nice-to-have')
  const uncoveredCritical = (uncoveredGaps || []).filter(g => g.requirement === 'required')

  if (criticalCovered.length === 1) {
    reasons.push({
      type: 'critical_skill',
      label: 'Critical skill',
      text: `Closes the critical missing skill ${criticalCovered[0].skillName}.`,
    })
  } else if (criticalCovered.length > 1) {
    reasons.push({
      type: 'critical_skill',
      label: 'Critical skills',
      text: `Closes ${criticalCovered.length} critical missing skills: ${criticalCovered.map(g => g.skillName).join(', ')}.`,
    })
  }

  if (preferredCovered.length > 0) {
    reasons.push({
      type: 'preferred_skill',
      label: 'Preferred skills',
      text: preferredCovered.length === 1
        ? `Also covers the preferred skill ${preferredCovered[0].skillName}.`
        : `Also covers preferred skills: ${preferredCovered.map(g => g.skillName).join(', ')}.`,
    })
  }

  if (niceToHave.length > 0 && criticalCovered.length === 0 && preferredCovered.length === 0) {
    reasons.push({
      type: 'supplementary',
      label: 'Supplementary',
      text: `Covers supplementary skills: ${niceToHave.map(g => g.skillName).join(', ')}.`,
    })
  }

  if (scores.demandWeight >= 0.7) {
    reasons.push({ type: 'demand', label: 'High demand', text: 'Skills taught are in very high employer demand.' })
  } else if (scores.demandWeight >= 0.4) {
    reasons.push({ type: 'demand', label: 'Market demand', text: 'Skills taught are in moderate employer demand.' })
  }

  if (scores.levelFit >= 0.9) {
    reasons.push({ type: 'level', label: 'Level match', text: 'Course level is an exact match for your target proficiency.' })
  } else if (scores.levelFit >= 0.6) {
    reasons.push({ type: 'level', label: 'Level fit', text: 'Course level is close to your required proficiency.' })
  } else if (scores.levelFit > 0 && scores.levelFit < 0.4) {
    reasons.push({ type: 'level', label: 'Level mismatch', text: 'Course level differs from your target proficiency.' })
  }

  if (ep.provider?.accreditation) {
    reasons.push({
      type: 'provider',
      label: 'Accredited',
      text: `Offered by ${ep.provider.name}, an accredited provider (${ep.provider.accreditation}).`,
    })
  } else if (ep.provider?.name) {
    reasons.push({ type: 'provider', label: 'Provider', text: `Offered by ${ep.provider.name}.` })
  }

  if (ep.program.certificationOffered) {
    reasons.push({
      type: 'certification',
      label: 'Certification',
      text: 'Includes an industry-recognised certification on completion.',
    })
  }

  if (uncoveredCritical.length > 0 && criticalCovered.length > 0) {
    reasons.push({
      type: 'remaining_gaps',
      label: 'Still missing',
      text: `Does not cover remaining critical skills: ${uncoveredCritical.map(g => g.skillName).join(', ')}.`,
    })
  }

  const tier = relevanceScore >= 80 ? 'highly relevant'
             : relevanceScore >= 55 ? 'relevant'
             : relevanceScore >= 35 ? 'moderately relevant'
             : 'supplementary'
  reasons.push({
    type: 'relevance',
    label: 'Relevance',
    text: `Overall relevance: ${relevanceScore}/100 (${tier}).`,
  })

  return reasons
}

export function buildExplanation(ep, coveredGaps, scores, relevanceScore, uncoveredGaps = []) {
  const reasons = buildReasons(ep, coveredGaps, uncoveredGaps, scores, relevanceScore)
  const parts = reasons.filter(r => r.type !== 'remaining_gaps' && r.type !== 'relevance').map(r => r.text)

  const details = []
  if (ep.program.deliveryMode)  details.push(ep.program.deliveryMode)
  if (ep.program.durationWeeks) details.push(`${ep.program.durationWeeks} weeks`)
  if (ep.program.fees !== null && ep.program.fees !== undefined) {
    details.push(ep.program.fees === 0 ? 'free' : `₹${ep.program.fees.toLocaleString('en-IN')}`)
  }
  if (details.length > 0) parts.push(`Format: ${details.join(' · ')}.`)

  const remaining = reasons.find(r => r.type === 'remaining_gaps')
  const relevance = reasons.find(r => r.type === 'relevance')
  if (remaining) parts.push(remaining.text)
  if (relevance) parts.push(relevance.text)

  return parts.join(' ')
}

function publicGap(gap) {
  return {
    canonicalId:   gap.canonicalId,
    skillName:     gap.skillName,
    requiredLevel: gap.requiredLevel,
    requirement:   gap.requirement,
  }
}

export async function recommendForGaps(rawGaps, options = {}) {
  const {
    limit            = 10,
    minRelevance     = 10,
    prioritizeCritical = true,
    excludeProgramIds  = [],
  } = options

  const gaps = normalizeGaps(rawGaps)
  if (gaps.length === 0) return []

  const enrichedPrograms = await loadEnrichedPrograms(skillKeysFromGaps(gaps))
  const results = []

  for (const ep of enrichedPrograms) {
    if (excludeProgramIds.includes(ep.program._id)) continue

    const { scores, coveredGaps, uncoveredGaps, relevanceScore } = scoreProgram(ep, gaps)
    if (relevanceScore < minRelevance) continue

    const explanation = buildExplanation(ep, coveredGaps, scores, relevanceScore, uncoveredGaps)
    const reasons = buildReasons(ep, coveredGaps, uncoveredGaps, scores, relevanceScore)

    const criticalCoveredCount = coveredGaps.filter(g => g.requirement === 'required').length
    const hasCriticalGap = criticalCoveredCount > 0
    const hasPreferred   = coveredGaps.some(g => g.requirement === 'preferred')
    const priority       = hasCriticalGap ? 'critical' : hasPreferred ? 'high' : 'medium'

    results.push({
      programId:      ep.program._id,
      programName:    ep.program.name,
      providerId:     ep.provider?._id  || null,
      providerName:   ep.provider?.name || null,
      curriculumId:   ep.curriculum?._id || null,
      deliveryMode:   ep.program.deliveryMode || null,
      durationWeeks:  ep.program.durationWeeks || null,
      fees:           ep.program.fees ?? null,
      certificationOffered: ep.program.certificationOffered || false,
      language:       ep.program.language || 'English',
      relevanceScore,
      priority,
      scores,
      coveredGaps:    coveredGaps.map(publicGap),
      coveredGapCount: coveredGaps.length,
      criticalCoveredCount,
      uncoveredCritical: uncoveredGaps.filter(g => g.requirement === 'required').map(publicGap),
      reasons,
      explanation,
    })
  }

  results.sort((a, b) => {
    if (prioritizeCritical) {
      const pa = a.priority === 'critical' ? 0 : a.priority === 'high' ? 1 : 2
      const pb = b.priority === 'critical' ? 0 : b.priority === 'high' ? 1 : 2
      if (pa !== pb) return pa - pb
      if (a.criticalCoveredCount !== b.criticalCoveredCount) {
        return b.criticalCoveredCount - a.criticalCoveredCount
      }
    }
    return b.relevanceScore - a.relevanceScore
  })

  return results.slice(0, limit)
}
