import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, BriefcaseBusiness, Check, Eye, EyeOff, GraduationCap, LockKeyhole, MapPinned, Sparkles, Users } from 'lucide-react'
import { canAccessRoute, routeForRole } from '../routePermissions.js'
import { authLogin, authRegister } from '../api.js'

const ROLES = [
  { id: 'industry',    label: 'Industry partner',     description: 'Publish roles and validate in-demand skills.', icon: BriefcaseBusiness, tone: 'coral'  },
  { id: 'training',    label: 'Training provider',    description: 'Align courses with live employer demand.',     icon: Users,             tone: 'blue'   },
  { id: 'learner',     label: 'Learner',              description: 'Build a pathway from your current skills.',    icon: GraduationCap,     tone: 'mint'   },
  { id: 'government',  label: 'Government & policy',  description: 'See regional supply and demand signals.',      icon: MapPinned,         tone: 'yellow' },
]

// ─── AuthGate ─────────────────────────────────────────────────────────────────
export function AuthGate({ children }) {
  const location = useLocation()
  const navigate  = useNavigate()
  const [session, setSession] = useState(() => {
    try { return JSON.parse(localStorage.getItem('skillsync-session') || 'null') }
    catch { return null }
  })

  const handleLogin = (user) => {
    localStorage.setItem('skillsync-session', JSON.stringify(user))
    setSession(user)
    navigate(routeForRole(user.role), { replace: true })
  }

  if (session && location.pathname === '/login') return <Navigate to={routeForRole(session.role)} replace />
  if (session && !canAccessRoute(location.pathname, session.role)) return <Navigate to={routeForRole(session.role)} replace />
  if (session) return children
  return <AuthScreen onLogin={handleLogin} />
}

// ─── AuthScreen ───────────────────────────────────────────────────────────────
function AuthScreen({ onLogin }) {
  const [mode, setMode]           = useState('login')   // 'login' | 'register'
  const [selectedRole, setRole]   = useState('learner')
  const [serverError, setError]   = useState('')
  const [showPwd, setShowPwd]     = useState(false)

  const { register, handleSubmit, formState: { errors, isSubmitting }, reset } = useForm({
    defaultValues: { name: '', email: '', password: '' },
  })

  const switchMode = (m) => { setMode(m); setError(''); reset() }

  const submit = async (values) => {
    setError('')
    try {
      let result
      if (mode === 'register') {
        result = await authRegister({ name: values.name, email: values.email, password: values.password, role: selectedRole })
      } else {
        result = await authLogin({ email: values.email, password: values.password })
      }
      // Persist token + user into session
      const session = { ...result.user, token: result.token }
      onLogin(session)
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || 'Something went wrong. Try again.'
      setError(msg)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-intro">
        <div className="brand auth-brand"><div className="brand-mark"><Sparkles size={17} strokeWidth={2.5} /></div><span>Skill<span>Sync</span></span></div>
        <div className="auth-hero-copy">
          <p className="eyebrow">MAHARASHTRA SKILL INTELLIGENCE</p>
          <h1>Turn market signals into <em>better futures.</em></h1>
          <p>One connected workspace for employers, educators, learners, and the people shaping what comes next.</p>
          <div className="auth-loop">
            <span><i>01</i> Demand</span><ArrowRight size={15} />
            <span><i>02</i> Skills</span><ArrowRight size={15} />
            <span><i>03</i> Action</span>
          </div>
        </div>
        <small className="auth-footer">A shared intelligence layer for a changing workforce.</small>
      </section>

      <section className="auth-panel">
        <div className="auth-panel-inner">
          <div className="auth-heading">
            <p className="eyebrow">{mode === 'login' ? 'WELCOME BACK' : 'CREATE ACCOUNT'}</p>
            <h2>{mode === 'login' ? 'Enter your workspace' : 'Join the ecosystem'}</h2>
            <p>{mode === 'login' ? 'Sign in to your SkillSync account.' : 'Choose your role to get started.'}</p>
          </div>

          {/* Role selector — only shown on register */}
          {mode === 'register' && (
            <div className="role-grid">
              {ROLES.map((role) => {
                const Icon = role.icon
                return (
                  <button type="button" key={role.id}
                    className={`role-card ${selectedRole === role.id ? 'selected' : ''}`}
                    onClick={() => setRole(role.id)}>
                    <span className={`role-icon ${role.tone}`}><Icon size={17} /></span>
                    <span><strong>{role.label}</strong><small>{role.description}</small></span>
                    {selectedRole === role.id && <Check size={15} className="role-check" />}
                  </button>
                )
              })}
            </div>
          )}

          <form onSubmit={handleSubmit(submit)} className="auth-form">
            {mode === 'register' && (
              <label className="form-label">
                Your name
                <input {...register('name', { required: mode === 'register' })} placeholder="e.g. Arjun Kulkarni" />
                {errors.name && <small>Please enter your name.</small>}
              </label>
            )}

            <label className="form-label">
              Work email
              <input type="email" {...register('email', { required: true })} placeholder="you@organization.org" />
              {errors.email && <small>Please enter a valid email.</small>}
            </label>

            <label className="form-label">
              Password
              <div className="password-wrap">
                <input
                  type={showPwd ? 'text' : 'password'}
                  {...register('password', { required: true, minLength: { value: 8, message: 'At least 8 characters' } })}
                  placeholder={mode === 'register' ? 'Min 8 characters' : '••••••••'}
                />
                <button type="button" className="pwd-toggle" onClick={() => setShowPwd(v => !v)} aria-label="Toggle password">
                  {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              {errors.password && <small>{errors.password.message || 'Password is required.'}</small>}
            </label>

            {serverError && <p className="auth-error" role="alert">{serverError}</p>}

            <button className="primary-button auth-submit" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Please wait…' : mode === 'login' ? 'Sign in to SkillSync' : 'Create account'}
              {!isSubmitting && <ArrowRight size={16} />}
            </button>
          </form>

          <p className="auth-switch">
            {mode === 'login'
              ? <>Don't have an account? <button type="button" onClick={() => switchMode('register')}>Create one</button></>
              : <>Already have an account? <button type="button" onClick={() => switchMode('login')}>Sign in</button></>
            }
          </p>

          <p className="auth-security"><LockKeyhole size={13} /> Your workspace access is role-scoped and encrypted.</p>
        </div>
      </section>
    </main>
  )
}
