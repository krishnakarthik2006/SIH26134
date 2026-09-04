import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, BriefcaseBusiness, Check, GraduationCap, LockKeyhole, MapPinned, Sparkles, Users } from 'lucide-react'
import { canAccessRoute, routeForRole } from '../routePermissions.js'

const roles = [
  { id: 'industry', label: 'Industry partner', description: 'Publish roles and validate in-demand skills.', icon: BriefcaseBusiness, tone: 'coral' },
  { id: 'training', label: 'Training provider', description: 'Align courses with live employer demand.', icon: Users, tone: 'blue' },
  { id: 'learner', label: 'Learner', description: 'Build a pathway from your current skills.', icon: GraduationCap, tone: 'mint' },
  { id: 'government', label: 'Government & policy', description: 'See regional supply and demand signals.', icon: MapPinned, tone: 'yellow' },
]

export function AuthGate({ children }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [session, setSession] = useState(() => JSON.parse(localStorage.getItem('skillsync-session') || 'null'))

  useEffect(() => {
    if (!session && location.pathname !== '/login') navigate('/login', { replace: true })
    if (session && !canAccessRoute(location.pathname, session.role)) navigate('/', { replace: true })
  }, [location.pathname, navigate, session])

  if (session && !canAccessRoute(location.pathname, session.role)) return null
  if (session) return children
  return <AuthScreen onLogin={(user) => { localStorage.setItem('skillsync-session', JSON.stringify(user)); setSession(user); navigate(routeForRole(user.role), { replace: true }) }} />
}

function AuthScreen({ onLogin }) {
  const [selectedRole, setSelectedRole] = useState('industry')
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ defaultValues: { name: '', email: '' } })

  const submit = (values) => onLogin({ ...values, role: selectedRole })

  return (
    <main className="auth-page">
      <section className="auth-intro">
        <div className="brand auth-brand"><div className="brand-mark"><Sparkles size={17} strokeWidth={2.5} /></div><span>Skill<span>Sync</span></span></div>
        <div className="auth-hero-copy"><p className="eyebrow">MAHARASHTRA SKILL INTELLIGENCE</p><h1>Turn market signals into <em>better futures.</em></h1><p>One connected workspace for employers, educators, learners, and the people shaping what comes next.</p><div className="auth-loop"><span><i>01</i> Demand</span><ArrowRight size={15} /><span><i>02</i> Skills</span><ArrowRight size={15} /><span><i>03</i> Action</span></div></div>
        <small className="auth-footer">A shared intelligence layer for a changing workforce.</small>
      </section>
      <section className="auth-panel"><div className="auth-panel-inner"><div className="auth-heading"><p className="eyebrow">WELCOME BACK</p><h2>Enter your workspace</h2><p>Choose your role so we can shape the right view for you.</p></div><div className="role-grid">{roles.map((role) => { const IconComponent = role.icon; return <button type="button" key={role.id} className={`role-card ${selectedRole === role.id ? 'selected' : ''}`} onClick={() => setSelectedRole(role.id)}><span className={`role-icon ${role.tone}`}><IconComponent size={17} /></span><span><strong>{role.label}</strong><small>{role.description}</small></span>{selectedRole === role.id && <Check size={15} className="role-check" />}</button> })}</div><form onSubmit={handleSubmit(submit)} className="auth-form"><label className="form-label">Your name<input {...register('name', { required: true })} placeholder="e.g. Arjun Kulkarni" />{errors.name && <small>Please enter your name.</small>}</label><label className="form-label">Work email<input type="email" {...register('email', { required: true })} placeholder="you@organization.org" />{errors.email && <small>Please enter a valid email.</small>}</label><button className="primary-button auth-submit" type="submit" disabled={isSubmitting}>Continue to SkillSync <ArrowRight size={16} /></button></form><p className="auth-security"><LockKeyhole size={13} /> Your workspace access is role-scoped and private.</p></div></section>
    </main>
  )
}
