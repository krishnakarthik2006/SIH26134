import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import { closeDatabase, connectToDatabase, domainCollections, getDatabase, getDatabaseName, isDatabaseConnected } from './db.js'

const app = express()
const port = process.env.PORT || 4000

app.use(cors())
app.use(express.json())

const overview = {
  activeDemandSignals: 1248,
  skillsTracked: 486,
  learnersInPathways: 12536,
  ecosystemAlignment: 68,
  demandPulse: [
    { month: 'Mar', demand: 55, supply: 33 },
    { month: 'Apr', demand: 68, supply: 46 },
    { month: 'May', demand: 74, supply: 52 },
    { month: 'Jun', demand: 61, supply: 39 },
    { month: 'Jul', demand: 83, supply: 61 },
    { month: 'Aug', demand: 77, supply: 55 },
    { month: 'Sep', demand: 92, supply: 70 },
  ],
}

const reports = [
  { id: 'report-q3-demand', title: 'Q3 talent demand report', type: 'Industry demand', updated: 'Today', rows: 184, status: 'Ready' },
  { id: 'report-regional-gaps', title: 'Regional skill gap brief', type: 'Regional analytics', updated: 'Yesterday', rows: 32, status: 'Ready' },
  { id: 'report-training-alignment', title: 'Training alignment summary', type: 'Supply vs demand', updated: '28 Aug 2026', rows: 84, status: 'Ready' },
]

const notifications = [
  { id: 'notification-1', title: 'New skill gap detected', text: 'Cloud security demand rose 18% in Vidarbha.', severity: 'high', read: false, time: '12 min ago' },
  { id: 'notification-2', title: 'Report is ready', text: 'Your Q3 talent demand report finished generating.', severity: 'info', read: false, time: '1 hr ago' },
  { id: 'notification-3', title: 'Alignment improved', text: 'Training coverage increased by 6 points this month.', severity: 'success', read: true, time: 'Yesterday' },
]

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok', service: 'skillsync-api', mongodb: isDatabaseConnected() ? 'connected' : 'disconnected', database: getDatabaseName(), collections: domainCollections })
})

app.get('/api/overview', (_request, response) => {
  response.json(overview)
})

app.post('/api/signals', (request, response) => {
  const { title, source } = request.body

  if (!title || !source) {
    return response.status(400).json({ error: 'title and source are required' })
  }

  const signal = {
    id: `signal-${Date.now()}`,
    title,
    source,
    status: 'queued-for-normalization',
    createdAt: new Date(),
  }

  getDatabase().collection('job_descriptions').insertOne({ ...signal, sourceType: 'manual-signal' }).catch((error) => {
    console.error('Failed to persist signal:', error.message)
  })

  response.status(201).json(signal)
})

app.get('/api/reports', (_request, response) => {
  response.json(reports)
})

app.post('/api/reports/generate', (request, response) => {
  const { type = 'Ecosystem overview', format = 'PDF' } = request.body
  response.status(201).json({ id: `report-${Date.now()}`, title: `${type} report`, format, status: 'ready', generatedAt: new Date().toISOString() })
})

app.get('/api/notifications', (_request, response) => {
  response.json(notifications)
})

app.patch('/api/notifications/:id/read', (request, response) => {
  const notification = notifications.find((item) => item.id === request.params.id)
  if (!notification) return response.status(404).json({ error: 'notification not found' })
  notification.read = true
  response.json(notification)
})

async function startServer() {
  try {
    await connectToDatabase()
    console.log('MongoDB connected')
    app.listen(port, () => {
      console.log(`SkillSync API listening on http://localhost:${port}`)
    })
  } catch (error) {
    console.error('MongoDB connection failed:', error.message)
    process.exitCode = 1
  }
}

process.on('SIGINT', async () => {
  await closeDatabase()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  await closeDatabase()
  process.exit(0)
})

startServer()
