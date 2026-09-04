import cors from 'cors'
import express from 'express'
import authRouter from './routes/auth.js'
import profilesRouter from './routes/profiles.js'
import skillsRouter from './routes/skills.js'
import industryRouter from './routes/industry.js'
import jobsRouter from './routes/jobs.js'
import trainingRouter from './routes/training.js'
import processRouter from './routes/process.js'
import normalizeRouter from './routes/normalize.js'
import matchRouter from './routes/match.js'
import recommendationsRouter from './routes/recommendations.js'
import studentReadinessRouter from './routes/studentReadiness.js'
import apiRouter from './routes/api.js'
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js'

export function createApp() {
  const app = express()

  app.disable('x-powered-by')
  app.use(cors())
  app.use(express.json({ limit: '5mb' }))
  app.use('/api/auth', authRouter)
  app.use('/api/profiles', profilesRouter)
  app.use('/api/skills', skillsRouter)
  app.use('/api/industries', industryRouter)
  app.use('/api/jobs', jobsRouter)
  app.use('/api/training', trainingRouter)
  app.use('/api/process', processRouter)
  app.use('/api/normalize', normalizeRouter)
  app.use('/api/match', matchRouter)
  app.use('/api/recommendations', recommendationsRouter)
  app.use('/api/student', studentReadinessRouter)
  app.use('/api', apiRouter)
  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
