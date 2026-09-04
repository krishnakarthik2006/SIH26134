import assert from 'node:assert/strict'
import test from 'node:test'
import { canAccessRoute, routeForRole } from '../frontend/routePermissions.js'

test('role permissions allow only the matching protected workspace', () => {
  assert.equal(canAccessRoute('/student', 'learner'), true)
  assert.equal(canAccessRoute('/student', 'industry'), false)
  assert.equal(canAccessRoute('/training', 'training'), true)
  assert.equal(canAccessRoute('/training', 'government'), false)
  assert.equal(canAccessRoute('/industry', 'industry'), true)
  assert.equal(canAccessRoute('/industry', 'learner'), false)
  assert.equal(canAccessRoute('/government', 'government'), true)
  assert.equal(canAccessRoute('/government', 'training'), false)
})

test('role landing destinations are deterministic', () => {
  assert.equal(routeForRole('learner'), '/student')
  assert.equal(routeForRole('training'), '/training')
  assert.equal(routeForRole('industry'), '/industry')
  assert.equal(routeForRole('government'), '/government')
  assert.equal(routeForRole('unknown'), '/')
})
