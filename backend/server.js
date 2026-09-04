import 'dotenv/config'
import cors from 'cors'
import express from 'express'

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

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok', service: 'skillsync-api' })
})

app.get('/api/overview', (_request, response) => {
  response.json(overview)
})

app.post('/api/signals', (request, response) => {
  const { title, source } = request.body

  if (!title || !source) {
    return response.status(400).json({ error: 'title and source are required' })
  }

  response.status(201).json({
    id: `signal-${Date.now()}`,
    title,
    source,
    status: 'queued-for-normalization',
  })
})

app.listen(port, () => {
  console.log(`SkillSync API listening on http://localhost:${port}`)
})
