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

export default api
