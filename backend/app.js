import cors from 'cors'
import express from 'express'
import authRouter from './routes/auth.js'
import apiRouter from './routes/api.js'
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js'

export function createApp() {
  const app = express()

  app.disable('x-powered-by')
  app.use(cors())
  app.use(express.json({ limit: '1mb' }))
  app.use('/api/auth', authRouter)
  app.use('/api', apiRouter)
  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
