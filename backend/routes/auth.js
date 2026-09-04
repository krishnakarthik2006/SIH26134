import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { Router } from 'express'
import { env } from '../config/env.js'
import { getDatabase } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

const router = Router()
const allowedRoles = new Set(['industry', 'training', 'learner', 'government'])
const publicUser = (user) => ({ id: user._id, name: user.name, email: user.email, role: user.role })

function validationError(message) {
  const error = new Error(message)
  error.statusCode = 400
  return error
}

function issueToken(user) {
  return jwt.sign({ role: user.role, tokenVersion: user.tokenVersion }, env.jwtSecret, { subject: user._id, expiresIn: env.jwtExpiresIn })
}

router.post('/register', asyncHandler(async (request, response) => {
  const { name, email, password, role = 'learner' } = request.body
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : ''

  if (!name?.trim() || !normalizedEmail || !password) throw validationError('name, email, and password are required')
  if (password.length < 8) throw validationError('password must be at least 8 characters')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw validationError('email must be valid')
  if (!allowedRoles.has(role)) throw validationError('role is not supported')

  const users = getDatabase().collection('users')
  const passwordHash = await bcrypt.hash(password, 12)
  const user = { _id: randomUUID(), name: name.trim(), email: normalizedEmail, passwordHash, role, tokenVersion: 0, isActive: true, createdAt: new Date() }

  try {
    await users.insertOne(user)
  } catch (error) {
    if (error.code === 11000) {
      const duplicate = new Error('an account with this email already exists')
      duplicate.statusCode = 409
      throw duplicate
    }
    throw error
  }

  response.status(201).json({ user: publicUser(user), token: issueToken(user) })
}))

router.post('/login', asyncHandler(async (request, response) => {
  const { email, password } = request.body
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : ''
  if (!normalizedEmail || !password) throw validationError('email and password are required')

  const user = await getDatabase().collection('users').findOne({ email: normalizedEmail, isActive: true })
  const validPassword = user ? await bcrypt.compare(password, user.passwordHash) : false
  if (!validPassword) {
    const error = new Error('invalid email or password')
    error.statusCode = 401
    throw error
  }

  await getDatabase().collection('users').updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } })
  response.json({ user: publicUser(user), token: issueToken(user) })
}))

router.get('/me', requireAuth, (request, response) => {
  response.json({ user: request.user })
})

router.post('/logout', requireAuth, asyncHandler(async (request, response) => {
  await getDatabase().collection('users').updateOne({ _id: request.user.id }, { $inc: { tokenVersion: 1 } })
  response.json({ message: 'logged out successfully' })
}))

router.get('/role/:role', requireAuth, requireRole('government'), (request, response) => {
  response.json({ role: request.params.role, authorized: allowedRoles.has(request.params.role) })
})

export default router
