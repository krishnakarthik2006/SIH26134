const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'
const apiUrl = process.env.API_URL || 'http://localhost:4000'

async function expectOk(url, options = {}) {
  const response = await fetch(url, options)
  if (!response.ok) throw new Error(`${url} returned ${response.status}`)
  return response
}

// 1. Frontend home check
await expectOk(`${frontendUrl}/`)

// 2. API health check
const health = await (await expectOk(`${apiUrl}/api/health`)).json()
if (health.status !== 'ok') throw new Error('API health check did not return ok')

// 3. Register & Login test user to get Auth token
const email = `smoke-${Date.now()}@skillsync.test`
const regRes = await expectOk(`${apiUrl}/api/auth/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password: 'SmokeTestPass123!', name: 'Smoke Test User', role: 'learner' }),
})
const { token } = await regRes.json()

// 4. Authenticated reports check
const reportsRes = await (await expectOk(`${apiUrl}/api/reports`, {
  headers: { authorization: `Bearer ${token}` }
})).json()
if (!Array.isArray(reportsRes.reports || reportsRes)) throw new Error('Reports payload is not an array')

// 5. Intelligence overview check
const intel = await (await expectOk(`${apiUrl}/api/intelligence/overview`)).json()
if (!intel.overview) throw new Error('Intelligence overview payload is incomplete')

console.log('E2E smoke checks passed: frontend, health, auth, reports, intelligence overview')

