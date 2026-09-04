const protectedRoutes = {
  '/student': 'learner',
  '/training': 'training',
  '/industry': 'industry',
  '/government': 'government',
}

export function canAccessRoute(pathname, role) {
  const requiredRole = protectedRoutes[pathname]
  return !requiredRole || requiredRole === role
}

export function routeForRole(role) {
  return { learner: '/student', training: '/training', industry: '/industry', government: '/government' }[role] || '/'
}
