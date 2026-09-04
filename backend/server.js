import { createApp } from './app.js'
import { closeDatabase, connectToDatabase } from './db.js'
import { env } from './config/env.js'

const app = createApp()
let server

async function startServer() {
  try {
    await connectToDatabase()
    console.log(`MongoDB connected to ${env.mongodbDbName}`)
    server = app.listen(env.port, () => {
      console.log(`SkillSync API listening on http://localhost:${env.port}`)
    })
  } catch (error) {
    console.error('MongoDB connection failed:', error.message)
    process.exitCode = 1
  }
}

async function shutdown(signal) {
  console.log(`${signal} received; shutting down`)
  if (server) await new Promise((resolve) => server.close(resolve))
  await closeDatabase()
  process.exit(0)
}

process.once('SIGINT', () => shutdown('SIGINT'))
process.once('SIGTERM', () => shutdown('SIGTERM'))

startServer()
