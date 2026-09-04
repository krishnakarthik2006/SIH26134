export function notFoundHandler(request, response) {
  response.status(404).json({
    error: 'Not found',
    path: request.originalUrl,
  })
}

export function errorHandler(error, _request, response, _next) {
  console.error(error)

  const statusCode = error.statusCode || 500
  response.status(statusCode).json({
    error: statusCode === 500 ? 'Internal server error' : error.message,
  })
}

export function asyncHandler(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next)
}
