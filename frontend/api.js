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

export default api
