import { Router } from 'express'
import { env } from '../config/env.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth)

async function callAnalyticsService(path, options = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), Math.max(env.aiServiceTimeout, 60000))
  try {
    const response = await fetch(`${env.aiServiceUrl}${path}`, {
      ...options,
      headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(env.aiServiceApiKey ? { 'X-Api-Key': env.aiServiceApiKey } : {}) },
      signal: controller.signal,
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      const error = new Error(data.detail || `Analytics service returned ${response.status}`)
      error.statusCode = response.status === 404 ? 404 : 502
      throw error
    }
    return data
  } catch (error) {
    if (error.name === 'AbortError') {
      throw Object.assign(new Error('Career analytics training timed out. Please retry.'), { statusCode: 504 })
    }
    if (error.statusCode) throw error
    throw Object.assign(new Error('Career analytics service is unavailable. Start the Python analytics service and retry.'), { statusCode: 503 })
  } finally {
    clearTimeout(timeout)
  }
}

router.get('/careers/overview', asyncHandler(async (_req, res) => {
  res.json(await callAnalyticsService('/analytics/careers/overview'))
}))

router.get('/careers/eda', asyncHandler(async (_req, res) => {
  res.json(await callAnalyticsService('/analytics/careers/eda'))
}))

router.post('/careers/predict', asyncHandler(async (req, res) => {
  const socCode = typeof req.body?.socCode === 'string' ? req.body.socCode.trim() : ''
  if (!/^\d{2}-\d{4}\.\d{2}$/.test(socCode)) {
    throw Object.assign(new Error('A valid occupation code is required'), { statusCode: 400 })
  }
  res.json(await callAnalyticsService('/analytics/careers/predict', {
    method: 'POST',
    body: JSON.stringify({ socCode }),
  }))
}))

export default router