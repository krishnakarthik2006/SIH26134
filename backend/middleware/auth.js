import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import { getDatabase } from '../db.js'
import { asyncHandler } from './errorHandler.js'

function unauthorized(message = 'Authentication required') {
  const error = new Error(message)
  error.statusCode = 401
  return error
}

export const requireAuth = asyncHandler(async (request, _response, next) => {
  const header = request.get('authorization')
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) throw unauthorized()

  let claims
  try {
    claims = jwt.verify(token, env.jwtSecret)
  } catch {
    throw unauthorized('Invalid or expired token')
  }

  const user = await getDatabase().collection('users').findOne({ _id: claims.sub, isActive: true })
  if (!user || user.tokenVersion !== claims.tokenVersion) throw unauthorized('Session is no longer active')

  request.user = { id: user._id, name: user.name, email: user.email, role: user.role }
  next()
})

export function requireRole(...roles) {
  return (request, _response, next) => {
    if (!request.user || !roles.includes(request.user.role)) {
      const error = new Error('You do not have permission to access this resource')
      error.statusCode = 403
      return next(error)
    }
    next()
  }
}
