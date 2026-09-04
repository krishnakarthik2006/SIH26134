/**
 * AI Service Client — Phase B7
 *
 * Wraps all HTTP communication with the Python AI microservice.
 *
 * Design decisions:
 *  - Every call goes through `callAiService()` which owns timeout, auth header,
 *    and error normalisation.
 *  - If the AI service is unreachable (network error, timeout, 5xx), the call
 *    returns `{ available: false, error }` instead of throwing.  The route layer
 *    then persists the job as `status: "pending"` and returns 202 Accepted to the
 *    client.  A retry endpoint lets clients re-trigger processing later.
 *  - 4xx responses from the AI service (bad payload, unsupported format) are
 *    treated as hard errors and surfaced to the client as 422.
 *  - All payloads sent to the AI service are plain JSON — no multipart/binary.
 *    Callers pass text content that has already been extracted from uploaded files.
 *
 * Endpoints expected on the Python side:
 *   POST /extract/resume      → ExtractionResult
 *   POST /extract/jd          → ExtractionResult
 *   POST /extract/curriculum  → ExtractionResult
 *   GET  /health              → { status: "ok" }
 *
 * ExtractionResult shape (returned by Python service):
 *   {
 *     extractedSkills: [{ name, normalizedName, confidence, category?, level? }],
 *     entities:        { names[], emails[], phones[], urls[], organizations[] },
 *     summary:         string,
 *     language:        string,
 *     wordCount:       number,
 *     processingMs:    number,
 *     modelVersion:    string,
 *   }
 */

import { env } from '../config/env.js'

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
export const AI_ENDPOINTS = {
  resume:     '/extract/resume',
  jd:         '/extract/jd',
  curriculum: '/extract/curriculum',
  health:     '/health',
}

// ─── CORE HTTP CALLER ─────────────────────────────────────────────────────────

/**
 * Send a POST request to the AI service.
 *
 * @param {string} path      — AI service path e.g. '/extract/resume'
 * @param {object} payload   — JSON body to send
 * @returns {{ available: boolean, data?: object, error?: string, statusCode?: number }}
 */
export async function callAiService(path, payload) {
  const url        = `${env.aiServiceUrl}${path}`
  const controller = new AbortController()
  const timer      = setTimeout(() => controller.abort(), env.aiServiceTimeout)

  const headers = {
    'Content-Type': 'application/json',
    'Accept':       'application/json',
  }
  if (env.aiServiceApiKey) headers['X-Api-Key'] = env.aiServiceApiKey

  try {
    const response = await fetch(url, {
      method:  'POST',
      headers,
      body:    JSON.stringify(payload),
      signal:  controller.signal,
    })

    clearTimeout(timer)

    // 4xx — bad request, unsupported format etc. — hard error
    if (response.status >= 400 && response.status < 500) {
      let detail = ''
      try { detail = (await response.json()).detail || (await response.text()) } catch { /* noop */ }
      return { available: true, error: detail || `AI service returned ${response.status}`, statusCode: response.status }
    }

    // 5xx — service error — treat as unavailable
    if (response.status >= 500) {
      return { available: false, error: `AI service internal error (${response.status})` }
    }

    const data = await response.json()
    return { available: true, data }

  } catch (err) {
    clearTimeout(timer)

    // AbortError means we hit our timeout
    if (err.name === 'AbortError') {
      return { available: false, error: `AI service timed out after ${env.aiServiceTimeout}ms` }
    }

    // Network-level failure (ECONNREFUSED, DNS, etc.)
    return { available: false, error: `AI service unreachable: ${err.message}` }
  }
}

/**
 * Check whether the AI service is alive.
 * @returns {{ alive: boolean, latencyMs?: number, error?: string }}
 */
export async function pingAiService() {
  const url        = `${env.aiServiceUrl}${AI_ENDPOINTS.health}`
  const controller = new AbortController()
  const timer      = setTimeout(() => controller.abort(), 5000)
  const start      = Date.now()

  try {
    const response = await fetch(url, {
      method:  'GET',
      headers: { Accept: 'application/json' },
      signal:  controller.signal,
    })
    clearTimeout(timer)
    const latencyMs = Date.now() - start
    if (response.ok) return { alive: true, latencyMs }
    return { alive: false, error: `Health check returned ${response.status}`, latencyMs }
  } catch (err) {
    clearTimeout(timer)
    const latencyMs = Date.now() - start
    if (err.name === 'AbortError') return { alive: false, error: 'Health check timed out', latencyMs }
    return { alive: false, error: err.message, latencyMs }
  }
}

// ─── TYPED EXTRACTORS ────────────────────────────────────────────────────────

/**
 * Extract skills and entities from a resume.
 *
 * @param {object} params
 * @param {string} params.content        — plain text of the resume
 * @param {string} [params.candidateName]
 * @param {string} [params.targetRole]
 * @param {string} [params.sourceId]     — UUID of the student/user document
 */
export function extractResume({ content, candidateName = '', targetRole = '', sourceId = '' }) {
  return callAiService(AI_ENDPOINTS.resume, {
    content,
    metadata: { candidateName, targetRole, sourceId, sourceType: 'resume' },
  })
}

/**
 * Extract required skills from a job description.
 *
 * @param {object} params
 * @param {string} params.content       — plain text of the JD
 * @param {string} [params.jobTitle]
 * @param {string} [params.industryId]
 * @param {string} [params.jobRoleId]   — UUID of the job_roles document
 */
export function extractJobDescription({ content, jobTitle = '', industryId = '', jobRoleId = '' }) {
  return callAiService(AI_ENDPOINTS.jd, {
    content,
    metadata: { jobTitle, industryId, jobRoleId, sourceType: 'job_description' },
  })
}

/**
 * Extract skills and topics covered from a curriculum.
 *
 * @param {object} params
 * @param {string} params.content              — plain text of the curriculum
 * @param {string} [params.programName]
 * @param {string} [params.trainingProgramId]  — UUID of the training_programs document
 * @param {string} [params.curriculumId]       — UUID of the curriculums document
 */
export function extractCurriculum({ content, programName = '', trainingProgramId = '', curriculumId = '' }) {
  return callAiService(AI_ENDPOINTS.curriculum, {
    content,
    metadata: { programName, trainingProgramId, curriculumId, sourceType: 'curriculum' },
  })
}
