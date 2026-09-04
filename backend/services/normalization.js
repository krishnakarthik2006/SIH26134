/**
 * Skill Normalization Engine — Phase B9
 *
 * Resolves raw skill strings (e.g. "PowerBI", "Microsoft Power BI", "power bi")
 * to a single canonical skill document from the skills collection.
 *
 * Resolution pipeline (each step only runs if the previous step didn't match):
 *
 *   1. Token cleaning     — lowercase, strip punctuation noise, collapse whitespace
 *   2. Exact match        — cleaned term == skill.normalizedName
 *   3. Alias match        — cleaned term appears in skill.aliases[]
 *   4. Mapping lookup     — skill_mappings collection (admin-curated many-to-one table)
 *   5. Prefix match       — cleaned term is a prefix of normalizedName (≥4 chars)
 *   6. Token overlap      — shared token set similarity ≥ configured threshold
 *   7. Levenshtein fuzzy  — edit-distance ≤ configured max (short terms skipped)
 *
 * Each step returns a MatchResult:
 *   { canonicalId, canonicalName, normalizedName, confidence, matchType }
 *
 * Unresolved terms are returned with matchType: 'unmatched'.
 *
 * Public API:
 *   normalizeTerm(rawTerm, options?)  → MatchResult
 *   normalizeTerms(rawTerms[], options?) → MatchResult[]
 *   buildNormalizedTerm(raw)          → string   (cleaning only, no DB)
 */

import { getDatabase } from '../db.js'

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

/** Tokens that carry no skill meaning and should be stripped */
const NOISE_TOKENS = new Set([
  'microsoft', 'google', 'amazon', 'adobe', 'oracle', 'ibm', 'cisco', 'sap',
  'advanced', 'basic', 'fundamentals', 'foundation', 'essentials', 'core',
  'professional', 'certified', 'certification', 'associate', 'expert', 'specialist',
  'introduction', 'intro', 'intermediate', 'beginner',
  'for', 'and', 'or', 'with', 'using', 'in', 'on', 'the', 'a', 'an',
  'programming', 'language', 'framework', 'library', 'platform', 'tool', 'technology',
])

/** Minimum length for fuzzy / prefix matching to avoid false positives */
const MIN_FUZZY_LENGTH = 4

/** Default options for normalization */
const DEFAULTS = {
  maxEditDistance:    2,    // max Levenshtein distance for fuzzy match
  tokenOverlapThresh: 0.6,  // minimum Jaccard similarity for token-overlap match
  prefixMinLength:    4,    // minimum cleaned term length for prefix matching
  fuzzyMinLength:     5,    // minimum cleaned term length for Levenshtein matching
  includeUnmatched:   true, // always include terms even if no match
}

// ─── CLEANING ─────────────────────────────────────────────────────────────────

/**
 * Build the normalized form of a raw term.
 *  - Lowercase
 *  - Replace separators (_, -, .) with space
 *  - Strip short version numbers (e.g. "python 3"), while retaining long IDs
 *  - Collapse whitespace
 *  - Trim
 */
export function buildNormalizedTerm(raw) {
  return raw
    .toLowerCase()
    .replace(/[_\-.\/\\]+/g, ' ')       // separators → space
    // Keep long numeric identifiers (such as source IDs) intact. Treat short
    // integers and semantic versions as version noise instead.
    .replace(/\bv?(?:\d{1,4}(?:\.\d+)+|\d{1,4})\b/g, '')
    .replace(/[^a-z0-9 #+]/g, ' ')      // keep alphanumerics, #, +
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Build a cleaned token set for token-overlap matching.
 * Removes noise tokens so "Microsoft Power BI" → {"power", "bi"}
 */
function tokenSet(normalizedTerm) {
  return new Set(
    normalizedTerm.split(' ').filter(t => t.length >= 2 && !NOISE_TOKENS.has(t)),
  )
}

// ─── LEVENSHTEIN ─────────────────────────────────────────────────────────────

function levenshtein(a, b) {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  const matrix = Array.from({ length: b.length + 1 }, (_, i) => [i])
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = 1 + Math.min(matrix[i - 1][j], matrix[i][j - 1], matrix[i - 1][j - 1])
      }
    }
  }
  return matrix[b.length][a.length]
}

/** Jaccard similarity on token sets */
function jaccard(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 1
  const intersection = [...setA].filter(t => setB.has(t)).length
  const union        = new Set([...setA, ...setB]).size
  return union === 0 ? 0 : intersection / union
}

// ─── RESULT FACTORY ──────────────────────────────────────────────────────────

function makeMatch(skill, matchType, confidence) {
  return {
    canonicalId:    skill._id,
    canonicalName:  skill.name,
    normalizedName: skill.normalizedName,
    category:       skill.category || null,
    type:           skill.type     || null,
    matchType,
    confidence:     Math.round(confidence * 100) / 100,
    matched:        true,
  }
}

function makeUnmatched(rawTerm, cleanedTerm) {
  return {
    canonicalId:    null,
    canonicalName:  null,
    normalizedName: cleanedTerm,
    category:       null,
    type:           null,
    matchType:      'unmatched',
    confidence:     0,
    matched:        false,
  }
}

// ─── CORE RESOLUTION ─────────────────────────────────────────────────────────

/**
 * Normalize a single raw term against the skills + skill_mappings collections.
 *
 * @param {string} rawTerm
 * @param {object} [opts]   — override DEFAULTS
 * @returns {Promise<MatchResult & { rawTerm: string, cleanedTerm: string }>}
 */
export async function normalizeTerm(rawTerm, opts = {}) {
  const options     = { ...DEFAULTS, ...opts }
  const cleanedTerm = buildNormalizedTerm(rawTerm)
  const db          = getDatabase()
  const skillsCol   = db.collection('skills')
  const activeFilter = { isDeleted: { $ne: true } }

  // ── Step 2: Exact match on normalizedName ─────────────────────────────────
  const exact = await skillsCol.findOne({ normalizedName: cleanedTerm, ...activeFilter })
  if (exact) {
    return { rawTerm, cleanedTerm, ...makeMatch(exact, 'exact', 0.99) }
  }

  // ── Step 3: Alias match ───────────────────────────────────────────────────
  const aliasMatch = await skillsCol.findOne({ aliases: cleanedTerm, ...activeFilter })
  if (aliasMatch) {
    return { rawTerm, cleanedTerm, ...makeMatch(aliasMatch, 'alias', 0.97) }
  }

  // ── Step 4: skill_mappings lookup (admin-curated) ─────────────────────────
  const mapping = await db.collection('skill_mappings').findOne({ sourceTerm: cleanedTerm })
  if (mapping) {
    const mapped = await skillsCol.findOne({ _id: mapping.skillId, ...activeFilter })
    if (mapped) {
      return { rawTerm, cleanedTerm, ...makeMatch(mapped, 'mapping', 0.98) }
    }
  }

  // ── Steps 5-7: Load all active skills for in-memory matching ──────────────
  // Only load name, normalizedName, aliases, category, type — not full docs
  const candidates = await skillsCol.find(activeFilter, {
    projection: { _id: 1, name: 1, normalizedName: 1, aliases: 1, category: 1, type: 1 },
  }).toArray()

  // Compatibility for skills created before the shared canonical cleaner was
  // applied at write time. Their stored names or aliases can still contain
  // separators such as "_", "-", or ".".
  const legacyExact = candidates.find(skill =>
    buildNormalizedTerm(skill.normalizedName || skill.name || '') === cleanedTerm,
  )
  if (legacyExact) {
    return { rawTerm, cleanedTerm, ...makeMatch(legacyExact, 'exact', 0.99) }
  }

  const legacyAlias = candidates.find(skill =>
    (skill.aliases || []).some(alias => buildNormalizedTerm(alias) === cleanedTerm),
  )
  if (legacyAlias) {
    return { rawTerm, cleanedTerm, ...makeMatch(legacyAlias, 'alias', 0.97) }
  }

  const queryTokens = tokenSet(cleanedTerm)

  // ── Step 5: Prefix match ──────────────────────────────────────────────────
  if (cleanedTerm.length >= options.prefixMinLength) {
    for (const skill of candidates) {
      if (
        skill.normalizedName?.startsWith(cleanedTerm) ||
        cleanedTerm.startsWith(skill.normalizedName || '')
      ) {
        const longer  = Math.max(cleanedTerm.length, (skill.normalizedName || '').length)
        const shorter = Math.min(cleanedTerm.length, (skill.normalizedName || '').length)
        const conf    = 0.85 * (shorter / longer)
        return { rawTerm, cleanedTerm, ...makeMatch(skill, 'prefix', conf) }
      }
    }
  }

  // ── Step 6: Token overlap (Jaccard) ──────────────────────────────────────
  let bestOverlap     = null
  let bestOverlapScore = 0

  for (const skill of candidates) {
    const skillTokens = tokenSet(skill.normalizedName || '')
    const score       = jaccard(queryTokens, skillTokens)
    if (score >= options.tokenOverlapThresh && score > bestOverlapScore) {
      bestOverlapScore = score
      bestOverlap      = skill
    }
  }
  if (bestOverlap) {
    return { rawTerm, cleanedTerm, ...makeMatch(bestOverlap, 'token_overlap', 0.75 + bestOverlapScore * 0.15) }
  }

  // ── Step 7: Levenshtein fuzzy ─────────────────────────────────────────────
  if (cleanedTerm.length >= options.fuzzyMinLength) {
    let bestFuzzy = null
    let bestDist  = Infinity

    for (const skill of candidates) {
      const dist = levenshtein(cleanedTerm, skill.normalizedName || '')
      if (dist <= options.maxEditDistance && dist < bestDist) {
        bestDist  = dist
        bestFuzzy = skill
      }
    }
    if (bestFuzzy) {
      // Confidence decreases with edit distance
      const conf = 0.80 - bestDist * 0.15
      return { rawTerm, cleanedTerm, ...makeMatch(bestFuzzy, 'fuzzy', conf) }
    }
  }

  // ── No match ──────────────────────────────────────────────────────────────
  return { rawTerm, cleanedTerm, ...makeUnmatched(rawTerm, cleanedTerm) }
}

/**
 * Normalize a batch of raw terms.
 * Runs all resolutions and deduplicates by canonicalId
 * (multiple inputs that resolve to the same skill are merged).
 *
 * @param {string[]} rawTerms
 * @param {object}   [opts]
 * @returns {Promise<Array<MatchResult & { rawTerm, cleanedTerm }>>}
 */
export async function normalizeTerms(rawTerms, opts = {}) {
  const results = await Promise.all(rawTerms.map(t => normalizeTerm(t, opts)))
  return results
}

/**
 * Deduplicate a normalizeTerms() result set by canonicalId.
 * When two raw terms resolve to the same canonical skill, the one with
 * higher confidence is kept; the other is folded into a `rawTerms` list.
 *
 * @param {Array} results — output of normalizeTerms()
 * @returns {Array}
 */
export function deduplicateResults(results) {
  const seen   = new Map() // canonicalId → result
  const output = []

  for (const r of results) {
    if (!r.matched) {
      output.push({ ...r, rawTerms: [r.rawTerm] })
      continue
    }
    const existing = seen.get(r.canonicalId)
    if (!existing) {
      seen.set(r.canonicalId, { ...r, rawTerms: [r.rawTerm] })
    } else if (r.confidence > existing.confidence) {
      seen.set(r.canonicalId, { ...r, rawTerms: [...existing.rawTerms, r.rawTerm] })
    } else {
      existing.rawTerms.push(r.rawTerm)
    }
  }

  for (const r of seen.values()) output.push(r)
  return output.sort((a, b) => b.confidence - a.confidence)
}
