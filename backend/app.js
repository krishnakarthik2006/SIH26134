import cors from 'cors'
import express from 'express'

// ─── Auth & Profiles ──────────────────────────────────────────────────────────
import authRouter            from './routes/auth.js'
import profilesRouter        from './routes/profiles.js'
// ─── Skill Knowledge Base ─────────────────────────────────────────────────────
import skillsRouter          from './routes/skills.js'
import normalizeRouter       from './routes/normalize.js'
// ─── Industry & Jobs ─────────────────────────────────────────────────────────
import industryRouter        from './routes/industry.js'
import jobsRouter            from './routes/jobs.js'
// ─── Training ────────────────────────────────────────────────────────────────
import trainingRouter        from './routes/training.js'
// ─── AI Processing ───────────────────────────────────────────────────────────
import processRouter         from './routes/process.js'
// ─── Matching & Gaps ─────────────────────────────────────────────────────────
import matchRouter           from './routes/match.js'
// ─── Student Readiness (B10) ─────────────────────────────────────────────────
import studentReadinessRouter from './routes/studentReadiness.js'
// ─── Recommendations (B11) ───────────────────────────────────────────────────
import recommendationsRouter from './routes/recommendations.js'
// ─── B12: Learning Roadmap ────────────────────────────────────────────────────
import roadmapRouter         from './routes/roadmap.js'
// ─── B13: Training Alignment ──────────────────────────────────────────────────
import alignmentRouter       from './routes/alignment.js'
// ─── B14: Industry Demand ─────────────────────────────────────────────────────
import demandRouter          from './routes/demand.js'
// ─── B15: Government Intelligence ────────────────────────────────────────────
import govIntelligenceRouter from './routes/govIntelligence.js'
// ─── B16: Assessments ────────────────────────────────────────────────────────
import assessmentsRouter     from './routes/assessments.js'
// ─── B17: Reports & Notifications ────────────────────────────────────────────
import { reportsRouter, notificationsRouter } from './routes/reportsNotifications.js'
// ─── Legacy static API (overview, health, signals) ───────────────────────────
import apiRouter             from './routes/api.js'

import { errorHandler, notFoundHandler } from './middleware/errorHandler.js'

export function createApp() {
  const app = express()

  app.disable('x-powered-by')
  app.use(cors())
  app.use(express.json({ limit: '5mb' }))

  // Auth & Profiles
  app.use('/api/auth',       authRouter)
  app.use('/api/profiles',   profilesRouter)

  // Skills
  app.use('/api/skills',     skillsRouter)
  app.use('/api/normalize',  normalizeRouter)

  // Industry & Jobs
  app.use('/api/industries', industryRouter)
  app.use('/api/jobs',       jobsRouter)

  // Training
  app.use('/api/training',   trainingRouter)

  // AI Processing
  app.use('/api/process',    processRouter)

  // Matching & Gaps
  app.use('/api/match',      matchRouter)

  // Student Readiness (B10)
  app.use('/api/student',    studentReadinessRouter)

  // Recommendations (B11)
  app.use('/api/recommendations', recommendationsRouter)

  // B12 — Learning Roadmap
  app.use('/api/roadmap',    roadmapRouter)

  // B13 — Training Alignment
  app.use('/api/alignment',  alignmentRouter)

  // B14 — Industry Demand & Emerging Skills
  app.use('/api/demand',     demandRouter)

  // B15 — Government Intelligence
  app.use('/api/intelligence', govIntelligenceRouter)

  // B16 — Assessments
  app.use('/api/assessments', assessmentsRouter)

  // B17 — Reports & Notifications (these override the static ones in api.js)
  app.use('/api/reports',        reportsRouter)
  app.use('/api/notifications',  notificationsRouter)

  // Legacy static API (health, overview, signals — kept for backwards compat)
  app.use('/api', apiRouter)

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
