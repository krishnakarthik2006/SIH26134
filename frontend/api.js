import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

// Attach the JWT from localStorage on every request if present
api.interceptors.request.use((config) => {
  const session = JSON.parse(localStorage.getItem('skillsync-session') || 'null')
  if (session?.token) {
    config.headers.Authorization = `Bearer ${session.token}`
  }
  return config
})

// ---------------------------------------------------------------------------
// General data endpoints
// ---------------------------------------------------------------------------
export const getOverview = () => api.get('/overview').then(({ data }) => data)
export const createSignal = (payload) => api.post('/signals', payload).then(({ data }) => data)
export const getReports = () => api.get('/reports').then(({ data }) => data)
export const generateReport = (payload) => api.post('/reports/generate', payload).then(({ data }) => data)
export const getNotifications = () => api.get('/notifications').then(({ data }) => data)
export const markNotificationRead = (id) => api.patch(`/notifications/${id}/read`).then(({ data }) => data)

// ---------------------------------------------------------------------------
// Auth endpoints
// ---------------------------------------------------------------------------
export const authRegister = (payload) => api.post('/auth/register', payload).then(({ data }) => data)
export const authLogin = (payload) => api.post('/auth/login', payload).then(({ data }) => data)
export const authMe = () => api.get('/auth/me').then(({ data }) => data)
export const authLogout = () => api.post('/auth/logout').then(({ data }) => data)

// ---------------------------------------------------------------------------
// Profile endpoints
//
// GET  /api/profiles/me              — resolve profile by current session role
// GET  /api/profiles/<role>          — fetch role-specific profile
// PATCH /api/profiles/<role>         — upsert role-specific profile
// ---------------------------------------------------------------------------

/** Fetch the profile for whichever role the current user has */
export const getMyProfile = () => api.get('/profiles/me').then(({ data }) => data)

// Student (learner)
export const getStudentProfile = () =>
  api.get('/profiles/student').then(({ data }) => data)
export const updateStudentProfile = (payload) =>
  api.patch('/profiles/student', payload).then(({ data }) => data)

// ---------------------------------------------------------------------------
// Student skill gap & readiness  (/api/student)
// ---------------------------------------------------------------------------

/** Fetch the learner's configured target job role. */
export const getStudentTargetRole = () =>
  api.get('/student/target-role').then(({ data }) => data)

/** Select a job role to use as the learner's readiness target. */
export const updateStudentTargetRole = (jobRoleId) =>
  api.patch('/student/target-role', { jobRoleId }).then(({ data }) => data)

/** Fetch the learner's saved current skills. */
export const getStudentCurrentSkills = () =>
  api.get('/student/current-skills').then(({ data }) => data)

/** Replace the learner's current skills (canonical IDs are resolved when known). */
export const updateStudentCurrentSkills = (currentSkills) =>
  api.patch('/student/current-skills', { currentSkills }).then(({ data }) => data)

/** Fetch all skills required by the learner's configured target role. */
export const getStudentRequiredSkills = () =>
  api.get('/student/required-skills').then(({ data }) => data)

/**
 * Get the complete B10 report: target/current/required skills, missing and
 * partial skills, strengths, skill-gap score, and job-readiness score.
 */
export const getStudentReadiness = () =>
  api.get('/student/readiness').then(({ data }) => data)

/** Recommend courses for the learner's missing and partial skills. */
export const getStudentRecommendations = (params = {}) =>
  api.get('/student/recommendations', { params }).then(({ data }) => data)

// Training provider
export const getTrainingProfile = () =>
  api.get('/profiles/training').then(({ data }) => data)
export const updateTrainingProfile = (payload) =>
  api.patch('/profiles/training', payload).then(({ data }) => data)

// Industry (employer)
export const getIndustryProfile = () =>
  api.get('/profiles/industry').then(({ data }) => data)
export const updateIndustryProfile = (payload) =>
  api.patch('/profiles/industry', payload).then(({ data }) => data)

// Government / policy
export const getGovernmentProfile = () =>
  api.get('/profiles/government').then(({ data }) => data)
export const updateGovernmentProfile = (payload) =>
  api.patch('/profiles/government', payload).then(({ data }) => data)

// ---------------------------------------------------------------------------
// Skills — Knowledge Base  (/api/skills)
//
// Public (no token needed):
//   getSkills(params)          — list with pagination + filters
//   searchSkills(params)       — full-text / prefix search
//   getSkillCategories()       — distinct categories with counts
//   getSkill(id)               — fetch one skill
//   getRelatedSkills(id)       — skills related to a skill
//
// Protected (industry | government):
//   createSkill(payload)       — create canonical skill
//   updateSkill(id, payload)   — partial update
//   addAliases(id, aliases[])  — append aliases
//   removeAlias(id, alias)     — remove one alias
//   addRelatedSkills(id, ids[])       — link related (bidirectional)
//   removeRelatedSkill(id, relatedId) — unlink (bidirectional)
//
// Protected (government only):
//   deleteSkill(id)            — soft delete
// ---------------------------------------------------------------------------

// ── Public reads ────────────────────────────────────────────────────────────

/**
 * List skills.
 * @param {object} params - category, type, level, tag, page, limit, sort, order
 */
export const getSkills = (params = {}) =>
  api.get('/skills', { params }).then(({ data }) => data)

/**
 * Full-text / prefix search.
 * @param {object} params - q (required), category, type, limit
 */
export const searchSkills = (params = {}) =>
  api.get('/skills/search', { params }).then(({ data }) => data)

/** All distinct categories with skill counts */
export const getSkillCategories = () =>
  api.get('/skills/categories').then(({ data }) => data)

/** Fetch one skill by id */
export const getSkill = (id) =>
  api.get(`/skills/${id}`).then(({ data }) => data)

/** Skills related to a given skill */
export const getRelatedSkills = (id) =>
  api.get(`/skills/${id}/related`).then(({ data }) => data)

// ── Protected writes ────────────────────────────────────────────────────────

/**
 * Create a new canonical skill.
 * @param {object} payload - name*, category*, type, description, aliases[], tags[],
 *                           demandLevel, demandScore, relatedSkillIds[]
 */
export const createSkill = (payload) =>
  api.post('/skills', payload).then(({ data }) => data)

/**
 * Partially update a skill (only provided fields change).
 * @param {string} id
 * @param {object} payload
 */
export const updateSkill = (id, payload) =>
  api.patch(`/skills/${id}`, payload).then(({ data }) => data)

/**
 * Soft-delete a skill (government only).
 * @param {string} id
 */
export const deleteSkill = (id) =>
  api.delete(`/skills/${id}`).then(({ data }) => data)

/**
 * Append one or more aliases to a skill.
 * @param {string}   id
 * @param {string[]} aliases
 */
export const addAliases = (id, aliases) =>
  api.post(`/skills/${id}/aliases`, { aliases }).then(({ data }) => data)

/**
 * Remove a single alias from a skill.
 * @param {string} id
 * @param {string} alias
 */
export const removeAlias = (id, alias) =>
  api.delete(`/skills/${id}/aliases`, { data: { alias } }).then(({ data }) => data)

/**
 * Link related skills (bidirectional).
 * @param {string}   id
 * @param {string[]} relatedSkillIds
 */
export const addRelatedSkills = (id, relatedSkillIds) =>
  api.post(`/skills/${id}/related`, { relatedSkillIds }).then(({ data }) => data)

/**
 * Unlink a related skill (bidirectional).
 * @param {string} id
 * @param {string} relatedId
 */
export const removeRelatedSkill = (id, relatedId) =>
  api.delete(`/skills/${id}/related/${relatedId}`).then(({ data }) => data)

// ---------------------------------------------------------------------------
// Industries  (/api/industries)
//
// Public:
//   getIndustries(params)        — list (sector, size, region, page, limit, sort, order)
//   searchIndustries(params)     — regex search on name/sector/description
//   getIndustry(id)              — fetch one industry
//   getIndustryJobs(id, params)  — job roles under an industry
//
// Protected (industry | government):
//   createIndustry(payload)      — create industry record
//   updateIndustry(id, payload)  — partial update (owner or government)
//
// Protected (government only):
//   deleteIndustry(id)           — soft-delete + cascade to job roles/descriptions
// ---------------------------------------------------------------------------

export const getIndustries = (params = {}) =>
  api.get('/industries', { params }).then(({ data }) => data)

export const searchIndustries = (params = {}) =>
  api.get('/industries/search', { params }).then(({ data }) => data)

export const getIndustry = (id) =>
  api.get(`/industries/${id}`).then(({ data }) => data)

export const getIndustryJobs = (id, params = {}) =>
  api.get(`/industries/${id}/jobs`, { params }).then(({ data }) => data)

export const createIndustry = (payload) =>
  api.post('/industries', payload).then(({ data }) => data)

export const updateIndustry = (id, payload) =>
  api.patch(`/industries/${id}`, payload).then(({ data }) => data)

export const deleteIndustry = (id) =>
  api.delete(`/industries/${id}`).then(({ data }) => data)

// ---------------------------------------------------------------------------
// Jobs — Roles, Descriptions, Required Skills  (/api/jobs)
//
// Public:
//   getJobs(params)                    — list (industryId, status, employmentType,
//                                         workMode, location, page, limit, sort, order)
//   searchJobs(params)                 — regex search across title/desc/skills/tags
//   getJob(id)                         — fetch one job role
//   getJobDescriptions(id, params)     — job descriptions for a role
//   getJobSkills(id)                   — required skills (enriched with skill details)
//
// Protected (industry | government):
//   createJob(payload)                 — create job role
//   updateJob(id, payload)             — partial update (owner or government)
//   deleteJob(id)                      — soft-delete + cascade descriptions
//   uploadJobDescription(id, payload)  — add a job description document
//   deleteJobDescription(id, descId)   — soft-delete one description
//   setJobSkills(id, skills[])         — upsert-merge required skills list
//   removeJobSkill(id, skillRef)       — remove one required skill by id or name
// ---------------------------------------------------------------------------

export const getJobs = (params = {}) =>
  api.get('/jobs', { params }).then(({ data }) => data)

export const searchJobs = (params = {}) =>
  api.get('/jobs/search', { params }).then(({ data }) => data)

export const getJob = (id) =>
  api.get(`/jobs/${id}`).then(({ data }) => data)

export const getJobDescriptions = (id, params = {}) =>
  api.get(`/jobs/${id}/descriptions`, { params }).then(({ data }) => data)

export const getJobSkills = (id) =>
  api.get(`/jobs/${id}/skills`).then(({ data }) => data)

export const createJob = (payload) =>
  api.post('/jobs', payload).then(({ data }) => data)

export const updateJob = (id, payload) =>
  api.patch(`/jobs/${id}`, payload).then(({ data }) => data)

export const deleteJob = (id) =>
  api.delete(`/jobs/${id}`).then(({ data }) => data)

/**
 * Upload a job description document.
 * @param {string} id       — job role id
 * @param {object} payload  — { content*, source, sourceUrl, rawTitle, notes }
 */
export const uploadJobDescription = (id, payload) =>
  api.post(`/jobs/${id}/descriptions`, payload).then(({ data }) => data)

export const deleteJobDescription = (id, descId) =>
  api.delete(`/jobs/${id}/descriptions/${descId}`).then(({ data }) => data)

/**
 * Set / upsert required skills on a job role.
 * @param {string}   id     — job role id
 * @param {object[]} skills — [{ skillId?, skillName*, level?, requirement? }]
 */
export const setJobSkills = (id, skills) =>
  api.post(`/jobs/${id}/skills`, { skills }).then(({ data }) => data)

/**
 * Remove a required skill from a job role.
 * @param {string} id        — job role id
 * @param {string} skillRef  — skillId UUID or skillName string
 */
export const removeJobSkill = (id, skillRef) =>
  api.delete(`/jobs/${id}/skills/${skillRef}`).then(({ data }) => data)

// ---------------------------------------------------------------------------
// Training Providers  (/api/training/providers)
//
// Public:
//   getProviders(params)            — list (type, district, region, accreditation, page, limit, sort, order)
//   searchProviders(params)         — regex search on name/type/district/description
//   getProvider(id)                 — fetch one provider
//   getProviderPrograms(id, params) — programs under a provider
//
// Protected (training | government):
//   createProvider(payload)         — create provider
//   updateProvider(id, payload)     — partial update (owner or government)
//
// Protected (government only):
//   deleteProvider(id)              — soft-delete + cascade programs + curriculums
// ---------------------------------------------------------------------------

export const getProviders = (params = {}) =>
  api.get('/training/providers', { params }).then(({ data }) => data)

export const searchProviders = (params = {}) =>
  api.get('/training/providers/search', { params }).then(({ data }) => data)

export const getProvider = (id) =>
  api.get(`/training/providers/${id}`).then(({ data }) => data)

export const getProviderPrograms = (id, params = {}) =>
  api.get(`/training/providers/${id}/programs`, { params }).then(({ data }) => data)

export const createProvider = (payload) =>
  api.post('/training/providers', payload).then(({ data }) => data)

export const updateProvider = (id, payload) =>
  api.patch(`/training/providers/${id}`, payload).then(({ data }) => data)

export const deleteProvider = (id) =>
  api.delete(`/training/providers/${id}`).then(({ data }) => data)

// ---------------------------------------------------------------------------
// Training Programs  (/api/training/programs)
//
// Public:
//   getPrograms(params)               — list (providerId, status, mode, tag, page, limit, sort, order)
//   searchPrograms(params)            — search (q, providerId, status, limit)
//   getProgram(id)                    — fetch one program
//   getProgramCurriculums(id, params) — curriculum versions for a program
//
// Protected (training | government):
//   createProgram(payload)            — create program
//   updateProgram(id, payload)        — partial update (owner or government)
//   deleteProgram(id)                 — soft-delete + cascade curriculums (owner or government)
// ---------------------------------------------------------------------------

export const getPrograms = (params = {}) =>
  api.get('/training/programs', { params }).then(({ data }) => data)

export const searchPrograms = (params = {}) =>
  api.get('/training/programs/search', { params }).then(({ data }) => data)

export const getProgram = (id) =>
  api.get(`/training/programs/${id}`).then(({ data }) => data)

export const getProgramCurriculums = (id, params = {}) =>
  api.get(`/training/programs/${id}/curriculums`, { params }).then(({ data }) => data)

export const createProgram = (payload) =>
  api.post('/training/programs', payload).then(({ data }) => data)

export const updateProgram = (id, payload) =>
  api.patch(`/training/programs/${id}`, payload).then(({ data }) => data)

export const deleteProgram = (id) =>
  api.delete(`/training/programs/${id}`).then(({ data }) => data)

// ---------------------------------------------------------------------------
// Curriculums  (/api/training/curriculums)
//
// Public:
//   getCurriculum(id)                 — fetch full curriculum (modules + skills)
//
// Protected (training | government):
//   createCurriculum(payload)         — create / upload curriculum
//   updateCurriculum(id, payload)     — update metadata (owner or government)
//   deleteCurriculum(id)              — soft-delete (owner or government)
//
//   addModules(id, modules[])                    — upsert-merge modules by title
//   updateModule(id, moduleId, payload)          — update one module
//   deleteModule(id, moduleId)                   — remove one module
//
//   setSkillsCovered(id, skillsCovered[])        — upsert-merge covered skills
//   removeSkillCovered(id, skillRef)             — remove one covered skill (by id or name)
// ---------------------------------------------------------------------------

export const getCurriculum = (id) =>
  api.get(`/training/curriculums/${id}`).then(({ data }) => data)

/**
 * Create / upload a curriculum.
 * @param {object} payload - trainingProgramId*, title*, version, status,
 *   description, content, learningObjectives[], totalHours,
 *   modules[], skillsCovered[]
 */
export const createCurriculum = (payload) =>
  api.post('/training/curriculums', payload).then(({ data }) => data)

export const updateCurriculum = (id, payload) =>
  api.patch(`/training/curriculums/${id}`, payload).then(({ data }) => data)

export const deleteCurriculum = (id) =>
  api.delete(`/training/curriculums/${id}`).then(({ data }) => data)

/**
 * Add / upsert modules to a curriculum (upserts by title).
 * @param {string}   id      — curriculum id
 * @param {object[]} modules — [{ title*, description, durationHours, order, topics[] }]
 */
export const addModules = (id, modules) =>
  api.post(`/training/curriculums/${id}/modules`, { modules }).then(({ data }) => data)

/**
 * Update a single module by its UUID.
 * @param {string} id       — curriculum id
 * @param {string} moduleId — module UUID
 * @param {object} payload  — { title, description, durationHours, order, topics[] }
 */
export const updateModule = (id, moduleId, payload) =>
  api.patch(`/training/curriculums/${id}/modules/${moduleId}`, payload).then(({ data }) => data)

/**
 * Remove a module by its UUID.
 */
export const deleteModule = (id, moduleId) =>
  api.delete(`/training/curriculums/${id}/modules/${moduleId}`).then(({ data }) => data)

/**
 * Set / upsert covered skills on a curriculum.
 * @param {string}   id            — curriculum id
 * @param {object[]} skillsCovered — [{ skillId?, skillName*, coverage?, proficiencyLevel? }]
 */
export const setSkillsCovered = (id, skillsCovered) =>
  api.post(`/training/curriculums/${id}/skills`, { skillsCovered }).then(({ data }) => data)

/**
 * Remove one covered skill by skillId UUID or skillName string.
 * @param {string} id        — curriculum id
 * @param {string} skillRef  — skillId or skillName
 */
export const removeSkillCovered = (id, skillRef) =>
  api.delete(`/training/curriculums/${id}/skills/${encodeURIComponent(skillRef)}`).then(({ data }) => data)

// ---------------------------------------------------------------------------
// Document Processing  (/api/process)
//
// All endpoints require authentication.
//
// Submit:
//   processResume(payload)         — extract skills from resume text
//   processJobDescription(payload) — extract skills from JD text
//   processCurriculum(payload)     — extract skills from curriculum text
//
// Poll & manage:
//   getProcessingJob(jobId)        — poll a specific extraction job
//   retryProcessingJob(jobId)      — retry a pending/failed job
//   getProcessingJobs(params)      — list own jobs (sourceType, status, page, limit)
//
// AI service status:
//   getAiServiceHealth()           — check if Python AI service is alive
// ---------------------------------------------------------------------------

/**
 * Submit a resume for skill extraction.
 * @param {object} payload
 * @param {string} payload.content        — plain text of the resume (≥ 50 chars)
 * @param {string} [payload.sourceId]     — student/user profile UUID
 * @param {string} [payload.candidateName]
 * @param {string} [payload.targetRole]
 *
 * Returns 200 (completed), 202 (pending — AI unavailable), or 422 (AI hard error).
 */
export const processResume = (payload) =>
  api.post('/process/resume', payload).then(({ data }) => data)

/**
 * Submit a job description for skill extraction.
 * @param {object} payload
 * @param {string} payload.content      — plain text of the JD (≥ 50 chars)
 * @param {string} [payload.sourceId]   — job_roles document UUID
 * @param {string} [payload.jobTitle]
 * @param {string} [payload.industryId]
 */
export const processJobDescription = (payload) =>
  api.post('/process/jd', payload).then(({ data }) => data)

/**
 * Submit a curriculum for skill extraction.
 * @param {object} payload
 * @param {string} payload.content               — plain text (≥ 50 chars)
 * @param {string} [payload.sourceId]            — curriculums document UUID
 * @param {string} [payload.programName]
 * @param {string} [payload.trainingProgramId]
 */
export const processCurriculum = (payload) =>
  api.post('/process/curriculum', payload).then(({ data }) => data)

/**
 * Poll a single extraction job by its ID.
 * @param {string} jobId
 */
export const getProcessingJob = (jobId) =>
  api.get(`/process/${jobId}`).then(({ data }) => data)

/**
 * Retry a pending or failed extraction job.
 * @param {string} jobId
 */
export const retryProcessingJob = (jobId) =>
  api.post(`/process/${jobId}/retry`).then(({ data }) => data)

/**
 * List extraction jobs submitted by the current user.
 * @param {object} params - sourceType, status, page, limit
 */
export const getProcessingJobs = (params = {}) =>
  api.get('/process', { params }).then(({ data }) => data)

/** Check whether the Python AI microservice is available. */
export const getAiServiceHealth = () =>
  api.get('/process/ai/health').then(({ data }) => data)

// ---------------------------------------------------------------------------
// Skill Normalization  (/api/normalize)
//
// Public:
//   normalizeSkills(terms[], opts?)       — batch-resolve raw strings to canonical skills
//
// Protected reads (any auth):
//   getNormalizationMappings(params)      — list admin-curated skill_mappings
//   getNormalizationMapping(id)           — get one mapping by id
//
// Protected writes (industry | government):
//   createMapping(payload)               — add one sourceTerm → skillId mapping
//   bulkUpsertMappings(mappings[], mode) — upsert up to 500 mappings (skip|replace)
//   updateMapping(id, payload)           — change a mapping's target skillId or notes
//   deleteMapping(id)                    — remove a mapping
// ---------------------------------------------------------------------------

/**
 * Batch-normalize raw skill strings to canonical skills.
 * Public — no token required.
 *
 * @param {string[]} terms             — raw skill strings (1-100)
 * @param {object}   [opts]
 * @param {boolean}  [opts.deduplicate=true]
 * @param {number}   [opts.maxEditDistance]    — 0-3
 * @param {number}   [opts.tokenOverlapThresh] — 0-1
 *
 * Response: { results: MatchResult[], summary: { total, matched, unmatched, byMatchType } }
 */
export const normalizeSkills = (terms, opts = {}) =>
  api.post('/normalize', { terms, ...opts }).then(({ data }) => data)

/** List all admin-curated skill_mappings (paginated). */
export const getNormalizationMappings = (params = {}) =>
  api.get('/normalize/mappings', { params }).then(({ data }) => data)

/** Fetch one mapping by id. */
export const getNormalizationMapping = (id) =>
  api.get(`/normalize/mappings/${id}`).then(({ data }) => data)

/**
 * Create a single sourceTerm → skillId mapping.
 * @param {{ sourceTerm: string, skillId: string, notes?: string }} payload
 */
export const createMapping = (payload) =>
  api.post('/normalize/mappings', payload).then(({ data }) => data)

/**
 * Bulk-upsert up to 500 mappings.
 * @param {Array<{ sourceTerm, skillId, notes? }>} mappings
 * @param {'skip'|'replace'} mode — behaviour on duplicate sourceTerm (default 'skip')
 * Returns 207 Multi-Status: { created, skipped, replaced, errors[] }
 */
export const bulkUpsertMappings = (mappings, mode = 'skip') =>
  api.post('/normalize/mappings/bulk', { mappings, mode }).then(({ data }) => data)

/**
 * Update a mapping's target skill or notes.
 * @param {string} id
 * @param {{ skillId?: string, notes?: string }} payload
 */
export const updateMapping = (id, payload) =>
  api.patch(`/normalize/mappings/${id}`, payload).then(({ data }) => data)

/** Delete a mapping by id. */
export const deleteMapping = (id) =>
  api.delete(`/normalize/mappings/${id}`).then(({ data }) => data)

// ---------------------------------------------------------------------------
// Skill Matching & Gap Analysis  (/api/match)
//
// All endpoints require authentication.
//
// Ad-hoc (not persisted):
//   matchSkillsAdHoc(requiredSkills, currentSkills)
//                  — instant match, result returned but not saved
//
// Persisted gap analysis:
//   analyzeGap(payload)
//                  — full gap analysis, saved to skill_gaps + readiness_scores
//   getGapResults(subjectType, subjectId, params?)
//                  — latest persisted readiness score + open gaps
//   getGapHistory(subjectType, subjectId, params?)
//                  — all historical readiness score records (paginated)
//
// Job-role shortcut:
//   matchAgainstJob(jobRoleId, currentSkills, opts?)
//                  — fetch job's requiredSkills from DB, then match
// ---------------------------------------------------------------------------

/**
 * Ad-hoc skill match — result returned, nothing saved to DB.
 *
 * @param {object[]} requiredSkills  [{ skillId?, skillName?, level?, requirement? }]
 * @param {object[]} currentSkills   [{ skillId?, skillName?, level?, selfRating? }]
 *
 * Response: { result: { readinessScore, gapSeverity, matched[], gaps[], surplus[], … } }
 */
export const matchSkillsAdHoc = (requiredSkills, currentSkills) =>
  api.post('/match', { requiredSkills, currentSkills }).then(({ data }) => data)

/**
 * Full gap analysis — result persisted to skill_gaps + readiness_scores.
 *
 * @param {object} payload
 * @param {string}   payload.subjectType    learner | training_program | team
 * @param {string}   payload.subjectId      UUID of the subject
 * @param {string}   payload.targetRole     target role label
 * @param {string}   [payload.jobRoleId]    optional job_roles UUID for enrichment
 * @param {object[]} payload.requiredSkills
 * @param {object[]} payload.currentSkills
 *
 * Response: { message, result, readinessScore, gapCount }
 */
export const analyzeGap = (payload) =>
  api.post('/match/gap', payload).then(({ data }) => data)

/**
 * Fetch the latest persisted gap results for a subject.
 *
 * @param {string} subjectType  learner | training_program | team
 * @param {string} subjectId    UUID of the subject
 * @param {object} [params]     { targetRole? }
 *
 * Response: { latest, readinessScores[], openGaps[] }
 */
export const getGapResults = (subjectType, subjectId, params = {}) =>
  api.get(`/match/gap/${subjectType}/${subjectId}`, { params }).then(({ data }) => data)

/**
 * Paginated history of all readiness score records for a subject.
 *
 * @param {string} subjectType
 * @param {string} subjectId
 * @param {object} [params]  { targetRole?, page?, limit? }
 */
export const getGapHistory = (subjectType, subjectId, params = {}) =>
  api.get(`/match/gap/${subjectType}/${subjectId}/history`, { params }).then(({ data }) => data)

/**
 * Match a learner's current skills against a specific job role.
 * Fetches the job role's requiredSkills from the DB automatically.
 *
 * @param {string}   jobRoleId
 * @param {object[]} currentSkills   [{ skillId?, skillName?, level?, selfRating? }]
 * @param {object}   [opts]
 * @param {boolean}  [opts.persist=false]   save results to DB
 * @param {string}   [opts.subjectType]     required if persist=true
 * @param {string}   [opts.subjectId]       required if persist=true
 */
export const matchAgainstJob = (jobRoleId, currentSkills, opts = {}) =>
  api.post(`/match/job/${jobRoleId}`, { currentSkills, ...opts }).then(({ data }) => data)

// ─── Phase B9 component aliases ───────────────────────────────────────────────
// Convenience re-exports used by SkillMatchingDashboard.jsx

/** Alias for normalizeSkills — batch-normalize raw terms */
export const normalizeTermsBatch = normalizeSkills

/** Alias for matchSkillsAdHoc — ad-hoc skill match (not persisted) */
export const adHocMatch = matchSkillsAdHoc

// ---------------------------------------------------------------------------
// Recommendation Engine  (/api/recommendations)
// ---------------------------------------------------------------------------

/** Ad-hoc preview — not persisted */
export const previewRecommendations = (gaps, opts = {}) =>
  api.post('/recommendations/preview', { gaps, ...opts }).then(({ data }) => data)

/** Generate + persist recommendations for a subject */
export const generateRecommendations = (payload) =>
  api.post('/recommendations/generate', payload).then(({ data }) => data)

/** Learner convenience: auto-fetch gaps + recommend */
export const getRecommendationsForMe = (opts = {}) =>
  api.post('/recommendations/for-me', opts).then(({ data }) => data)

/** Paginated list of recommendation sets for current learner */
export const getMyRecommendations = (params = {}) =>
  api.get('/recommendations/my', { params }).then(({ data }) => data)

/** Fetch one recommendation set (auto-marks as viewed) */
export const getRecommendation = (id) =>
  api.get(`/recommendations/${id}`).then(({ data }) => data)

/** Update recommendation status: viewed | enrolled | dismissed | completed */
export const updateRecommendationStatus = (id, status) =>
  api.patch(`/recommendations/${id}/status`, { status }).then(({ data }) => data)

/** Recommendations for any subject (government / training view) */
export const getSubjectRecommendations = (subjectType, subjectId, params = {}) =>
  api.get(`/recommendations/subject/${subjectType}/${subjectId}`, { params }).then(({ data }) => data)

/** Explain why a specific program is relevant to given gaps */
export const explainProgramRecommendation = (programId, gaps) =>
  api.get(`/recommendations/program/${programId}/explain`, { params: { gaps: JSON.stringify(gaps) } }).then(({ data }) => data)

export default api
