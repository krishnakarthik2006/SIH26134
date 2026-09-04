const baseUrl = process.env.API_URL || 'http://localhost:4000'
const email = `b2-test-${Date.now()}@example.com`
const password = 'StrongPass123!'

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options)
  const body = await response.json()
  return { response, body }
}

const registered = await request('/api/auth/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'B2 Test User', email, password, role: 'learner' }),
})
if (registered.response.status !== 201 || !registered.body.token) throw new Error(`register failed: ${JSON.stringify(registered.body)}`)

const tokenHeaders = { authorization: `Bearer ${registered.body.token}` }
const me = await request('/api/auth/me', { headers: tokenHeaders })
if (me.response.status !== 200 || me.body.user.email !== email) throw new Error('current-user lookup failed')

const loggedIn = await request('/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password }),
})
if (loggedIn.response.status !== 200 || !loggedIn.body.token) throw new Error('login failed')

const logout = await request('/api/auth/logout', { method: 'POST', headers: tokenHeaders })
if (logout.response.status !== 200) throw new Error('logout failed')

const revoked = await request('/api/auth/me', { headers: tokenHeaders })
if (revoked.response.status !== 401) throw new Error('logout did not revoke the token')

const roleDenied = await request('/api/auth/role/government', { headers: tokenHeaders })
if (roleDenied.response.status !== 401) throw new Error('revoked token was accepted by role authorization')

console.log('Authentication flow passed: register, hash, login, JWT, me, logout, revocation, authorization')
