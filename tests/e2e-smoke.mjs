const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'
const apiUrl = process.env.API_URL || 'http://localhost:4000'

async function expectOk(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} returned ${response.status}`)
  return response
}

await expectOk(`${frontendUrl}/`)
const health = await (await expectOk(`${apiUrl}/api/health`)).json()
if (health.status !== 'ok') throw new Error('API health check did not return ok')

const overview = await (await expectOk(`${apiUrl}/api/overview`)).json()
if (!overview.activeDemandSignals || !overview.demandPulse?.length) throw new Error('Overview payload is incomplete')

const reports = await (await expectOk(`${apiUrl}/api/reports`)).json()
if (!Array.isArray(reports) || reports.length === 0) throw new Error('Reports payload is empty')

const generated = await fetch(`${apiUrl}/api/reports/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'Ecosystem overview', format: 'CSV' }) })
if (generated.status !== 201) throw new Error(`Report generation returned ${generated.status}`)

console.log('E2E smoke checks passed: frontend, health, overview, reports, generation')
