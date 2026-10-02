import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getOverview, getDemandSkills, getMyNotifications, searchOccupations } from './api.js'
import DemandChart from './components/DemandChart.jsx'
import SignalForm from './components/SignalForm.jsx'
import SkillMatchingDashboard from './components/SkillMatchingDashboard.jsx'
import {
  Activity, ArrowUpRight, BarChart3, Bell, BookOpen, BriefcaseBusiness,
  ChartNoAxesCombined, ChevronRight, FileUp, Gauge, GraduationCap,
  LayoutDashboard, LogOut, MapPinned, Plus, Search, Sparkles, Target,
  Users, X, Database, Briefcase,
} from 'lucide-react'

const NAV = [
  { label: 'Overview',             icon: LayoutDashboard },
  { label: 'Career analytics',     icon: ChartNoAxesCombined },
  { label: 'Industry demand',      icon: BriefcaseBusiness },
  { label: 'Skill intelligence',   icon: Sparkles },
  { label: 'Curriculum alignment', icon: BookOpen },
  { label: 'Learner pathways',     icon: GraduationCap },
  { label: 'Regional signals',     icon: MapPinned },
]

const ROUTES = {
  'Industry demand':      '/industry',
  'Curriculum alignment': '/training',
  'Learner pathways':     '/student',
  'Regional signals':     '/government',
  'Career analytics':     '/career-analytics',
}

const SKILL_TONES    = ['coral', 'mint', 'yellow', 'blue', 'violet']
const SEVERITY_COLOR = { high: 'coral', critical: 'coral', warning: 'yellow', success: 'mint', info: 'blue' }

// ── Session helper ────────────────────────────────────────────────────────────
function getSession() {
  try { return JSON.parse(localStorage.getItem('careeriq-session') || 'null') }
  catch { return null }
}

function signOut() {
  localStorage.removeItem('careeriq-session')
  window.location.href = '/login'
}

// ── Main App ──────────────────────────────────────────────────────────────────
function App() {
  const navigate = useNavigate()
  const [active, setActive]         = useState('Overview')
  const [showUpload, setShowUpload] = useState(false)
  const [overview, setOverview]     = useState(null)
  const [skillGaps, setSkillGaps]   = useState([])
  const [activity, setActivity]     = useState([])
  const [loading, setLoading]       = useState(true)

  // Dataset panel state
  const [occupations, setOccupations]   = useState([])
  const [occSearch, setOccSearch]       = useState('')
  const [occLoading, setOccLoading]     = useState(false)
  const [occTotal, setOccTotal]         = useState(0)

  const session   = getSession()
  const firstName = session?.name?.split(' ')[0] || 'there'
  const initials  = firstName.slice(0, 2).toUpperCase()

  // ── Overview data load ──────────────────────────────────────────────────────
  const loadData = useCallback(() => {
    setLoading(true)
    Promise.all([
      getOverview(),
      getDemandSkills({ limit: 6, minDemandScore: 0, sort: 'demandScore' }),
      getMyNotifications({ limit: 6 }).catch(() => ({ notifications: [] })),
    ]).then(([ov, demand, notifData]) => {
      setOverview(ov)
      const gaps = (demand.skills || []).map((s, i) => {
        const score = s.avgDemandScore ?? s.demandScore
        if (score == null || !Number.isFinite(Number(score))) return null
        return { name: s.skillName || s.name || 'Unknown', demand: Math.round(Number(score)), tone: SKILL_TONES[i % SKILL_TONES.length] }
      }).filter(Boolean)
      setSkillGaps(gaps)
      const notifs = notifData.notifications || []
      setActivity(notifs.slice(0, 5).map(n => ({
        icon: Activity, title: n.title, text: n.text, time: n.time || '', color: SEVERITY_COLOR[n.severity] || 'blue',
      })))
    }).catch(() => setOverview(null))
    .finally(() => setLoading(false))
  }, [])

  // ── Career library (occupation dataset) load ────────────────────────────────
  const loadOccupations = useCallback((q = '') => {
    setOccLoading(true)
    searchOccupations({ q, limit: 9, page: 1 })
      .then(r => { setOccupations(r.occupations || []); setOccTotal(r.pagination?.total || 0) })
      .catch(() => {})
      .finally(() => setOccLoading(false))
  }, [])

  useEffect(() => { loadData() }, [loadData])
  useEffect(() => {
    if (active === 'Overview') loadOccupations(occSearch)
  }, [active, occSearch, loadOccupations])

  // ── Navigation handler ──────────────────────────────────────────────────────
  const openWorkspace = (label) => {
    if (label === 'Skill intelligence') { setActive(label); return }
    if (label === 'Overview')           { setActive(label); navigate('/'); return }
    navigate(ROUTES[label] || '/')
  }

  // KPI loop stats
  const loopStats = [
    { number: '01', icon: BriefcaseBusiness, title: 'Industry',  text: 'Demand published',  status: overview?.activeDemandSignals ? `${overview.activeDemandSignals.toLocaleString()} signals` : '—', tone: 'coral'  },
    { number: '02', icon: Sparkles,          title: 'AI layer',  text: 'Skills normalized', status: overview?.skillsTracked ? `${overview.skillsTracked.toLocaleString()} skills` : '—',             tone: 'yellow' },
    { number: '03', icon: BookOpen,          title: 'Training',  text: 'Curricula aligned', status: overview?.ecosystemAlignment ? `${overview.ecosystemAlignment}% aligned` : '—',                   tone: 'blue'   },
    { number: '04', icon: GraduationCap,     title: 'Learners',  text: 'Paths improving',   status: overview?.learnersInPathways ? `${overview.learnersInPathways.toLocaleString()} learners` : '—',  tone: 'mint'   },
  ]

  return (
    <div className="app-shell">

      {/* ── Sidebar ── */}
      <aside className="sidebar">
        {/* Brand */}
        <div className="brand">
          <div className="brand-mark"><ChartNoAxesCombined size={16} strokeWidth={2.5} /></div>
          <span>Career<span>IQ</span></span>
        </div>

        {/* Navigation */}
        <div className="nav-label">Navigation</div>
        <nav>
          {NAV.map(item => {
            const Icon = item.icon
            return (
              <button
                className={`nav-item ${active === item.label ? 'active' : ''}`}
                key={item.label}
                onClick={() => openWorkspace(item.label)}
              >
                <Icon size={16} /><span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        {/* Profile + sign-out at bottom */}
        <div className="sidebar-bottom">
          <div className="profile">
            <div className="profile-photo">{initials}</div>
            <div>
              <strong>{session?.name || 'User'}</strong>
              <small>{session?.role || '—'}</small>
            </div>
            <button
              className="signout-btn"
              onClick={signOut}
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="main-content">
        <header className="topbar">
          <div className="crumb"><span>Workspace</span><span>/</span><strong>{active}</strong></div>
          <div className="top-actions">
            <button className="icon-button has-dot" aria-label="Notifications"><Bell size={18} /></button>
            <button className="avatar-button">{initials}</button>
          </div>
        </header>

        {/* ── Skill intelligence inline view ── */}
        {active === 'Skill intelligence' ? <SkillMatchingDashboard /> : (

          <div className="content-wrap">

            {/* Welcome row */}
            <section className="welcome-row">
              <div>
                <p className="eyebrow">{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase()}</p>
                <h1>Good {greeting()}, {firstName}</h1>
                <p className="intro">Your workforce intelligence overview for today.</p>
              </div>
              <div className="header-actions">
                <button className="primary-button" onClick={() => setShowUpload(true)}>
                  <Plus size={16} /> Add signal
                </button>
              </div>
            </section>

            {/* KPI metrics */}
            <section className="metric-grid">
              <Metric icon={BriefcaseBusiness} label="Active demand signals" value={loading ? '…' : (overview?.activeDemandSignals?.toLocaleString() ?? '—')} caption="Currently active" tone="coral" />
              <Metric icon={Target}            label="Skills tracked"         value={loading ? '…' : (overview?.skillsTracked?.toLocaleString() ?? '—')} caption="In skill catalogue" tone="mint" />
              <Metric icon={Users}             label="Learners in pathways"   value={loading ? '…' : (overview?.learnersInPathways?.toLocaleString() ?? '—')} caption="Active roadmaps" tone="blue" />
              <Metric icon={Gauge}             label="Ecosystem alignment"    value={loading ? '…' : (overview?.ecosystemAlignment != null ? `${overview.ecosystemAlignment}%` : '—')} caption="Program alignment avg" tone="yellow" />
            </section>

            {/* Demand chart + skill gaps */}
            <div className="section-heading">
              <div><p className="eyebrow">LIVE DATA</p><h2>Demand and skill gaps</h2></div>
            </div>

            <section className="dashboard-grid">
              <div className="panel demand-panel">
                <PanelTitle icon={BarChart3} title="Demand over time" />
                <div className="chart-legend"><span><i className="dot coral-dot" />Demand score</span></div>
                {overview?.demandPulse?.length
                  ? <div className="chart-wrap recharts-wrap"><DemandChart data={overview.demandPulse} /></div>
                  : <p className="panel-empty">No monthly demand history recorded yet.</p>}
                <div className="chart-foot"><span><strong>Live</strong> from demand layer</span></div>
              </div>

              <div className="panel gaps-panel">
                <PanelTitle icon={Sparkles} title="Top skill demand scores" />
                <p className="panel-subtitle">Skills ranked by recorded employer demand.</p>
                {loading && <div className="loading-rows"><span /><span /><span /></div>}
                {!loading && skillGaps.length === 0 && <p className="panel-empty">No skill data yet. Add demand signals to populate this panel.</p>}
                <div className="skill-list">
                  {skillGaps.map(skill => (
                    <div className="skill-row" key={skill.name}>
                      <div className="skill-name">
                        <i className={`skill-dot ${skill.tone}`} />
                        <strong>{skill.name}</strong>
                        <span>Demand {skill.demand}%</span>
                      </div>
                      <div className="progress-track">
                        <div className={`progress-fill ${skill.tone}`} style={{ width: `${skill.demand}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
                {skillGaps.length > 0 && (
                  <button className="text-button" onClick={() => openWorkspace('Skill intelligence')}>
                    Open skill intelligence <ArrowUpRight size={14} />
                  </button>
                )}
              </div>
            </section>

            {/* ── Career Library — live occupation dataset ── */}
            <div className="section-heading" style={{ marginTop: 28 }}>
              <div>
                <p className="eyebrow">CAREER DATASET · {occTotal > 0 ? `${occTotal.toLocaleString()} OCCUPATIONS` : 'LOADING…'}</p>
                <h2>Career library</h2>
              </div>
              <button className="secondary-button" onClick={() => navigate('/career-analytics')}>
                View analytics <ArrowUpRight size={14} />
              </button>
            </div>

            <div className="occ-search-row">
              <div className="occ-search">
                <Search size={14} />
                <input
                  value={occSearch}
                  onChange={e => setOccSearch(e.target.value)}
                  placeholder="Search occupations by title, skill, or code…"
                />
                {occSearch && (
                  <button className="occ-clear" onClick={() => setOccSearch('')} aria-label="Clear">
                    <X size={13} />
                  </button>
                )}
              </div>
              <span className="occ-count">
                {occTotal > 0 ? `Showing ${occupations.length} of ${occTotal.toLocaleString()}` : ''}
              </span>
            </div>

            {occLoading ? (
              <div className="occ-grid">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="occ-card occ-skeleton">
                    <div className="occ-sk-title" />
                    <div className="occ-sk-code" />
                    <div className="occ-sk-line" />
                    <div className="occ-sk-line occ-sk-short" />
                  </div>
                ))}
              </div>
            ) : occupations.length > 0 ? (
              <div className="occ-grid">
                {occupations.map(occ => (
                  <OccupationCard key={occ.id || occ.socCode} occ={occ} onAnalyse={() => navigate('/career-analytics')} />
                ))}
              </div>
            ) : (
              <div className="occ-empty">
                <Database size={28} />
                <strong>No occupations found</strong>
                <span>
                  {occSearch
                    ? 'Try a different search term.'
                    : 'Run npm run seed:datasets to import the career library.'}
                </span>
                {!occSearch && (
                  <code className="occ-cmd">npm run seed:datasets</code>
                )}
              </div>
            )}

            {/* Ecosystem loop */}
            <div className="section-heading" style={{ marginTop: 28 }}>
              <div><p className="eyebrow">PIPELINE</p><h2>How the ecosystem works</h2></div>
            </div>

            <section className="bottom-grid">
              <div className="panel loop-panel">
                <PanelTitle icon={Sparkles} title="Ecosystem loop" />
                <div className="loop-steps">
                  {loopStats.map((step, i) => {
                    const Icon = step.icon
                    return (
                      <span key={step.title}>
                        <LoopStep number={step.number} icon={Icon} title={step.title} text={step.text} status={step.status} tone={step.tone} />
                        {i < loopStats.length - 1 && <div className="connector" />}
                      </span>
                    )
                  })}
                </div>
                <div className="loop-footer">
                  <span><i className="pulse" /> Live intelligence across 4 connected stages</span>
                </div>
              </div>

              <div className="panel activity-panel">
                <PanelTitle icon={Activity} title="Latest activity" action="View feed" />
                {loading && <div className="loading-rows"><span /><span /><span /></div>}
                {!loading && activity.length === 0 && (
                  <p className="panel-empty">No recent activity. Notifications will appear here.</p>
                )}
                <div className="activity-list">
                  {activity.map((item, i) => {
                    const Icon = item.icon
                    return (
                      <div className="activity-item" key={i}>
                        <div className={`activity-icon ${item.color}`}><Icon size={15} /></div>
                        <div><strong>{item.title}</strong><p>{item.text}</p></div>
                        <time>{item.time}</time>
                      </div>
                    )
                  })}
                </div>
              </div>
            </section>

            <footer className="footer">
              <span>Career Intelligence Workspace</span>
              <span>Data refreshed just now <i className="pulse" /></span>
            </footer>
          </div>
        )}
      </main>

      {/* ── Add signal modal ── */}
      {showUpload && (
        <div className="modal-backdrop" onClick={() => setShowUpload(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowUpload(false)}><X size={17} /></button>
            <div className="modal-symbol"><FileUp size={21} /></div>
            <p className="eyebrow">NEW DEMAND SIGNAL</p>
            <h2>Add a role profile</h2>
            <p>Upload a job description to extract, normalise, and map its skill requirements.</p>
            <SignalForm onComplete={() => { setShowUpload(false); loadData() }} />
          </div>
        </div>
      )}
    </div>
  )
}

// ── Occupation card ───────────────────────────────────────────────────────────
function OccupationCard({ occ, onAnalyse }) {
  const topSkills = (occ.essentialSkills || []).slice(0, 3)
  const hotTools  = (occ.softwareSkills  || []).filter(s => s.hotTechnology).slice(0, 2)

  return (
    <div className="occ-card">
      <div className="occ-card-head">
        <div className="occ-icon"><Briefcase size={15} /></div>
        <div>
          <strong className="occ-title">{occ.title}</strong>
          <span className="occ-code">{occ.socCode}</span>
        </div>
      </div>
      <p className="occ-desc">{occ.description ? occ.description.slice(0, 90) + (occ.description.length > 90 ? '…' : '') : '—'}</p>
      {topSkills.length > 0 && (
        <div className="occ-skills">
          {topSkills.map(s => (
            <span key={s.name} className="occ-skill-tag" title={`Importance ${s.importance?.toFixed(1) ?? '?'}`}>
              {s.name}
            </span>
          ))}
          {hotTools.map(t => (
            <span key={t.name} className="occ-skill-tag occ-hot-tag" title="Hot technology">
              {t.name}
            </span>
          ))}
        </div>
      )}
      <button className="occ-analyse-btn" onClick={onAnalyse}>
        View analytics <ChevronRight size={12} />
      </button>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'
}

function Metric({ icon: Icon, label, value, caption, tone }) {
  return (
    <div className="metric-card">
      <div className={`metric-icon ${tone}`}><Icon size={18} /></div>
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value}</strong>
      <div className="metric-foot"><span>{caption}</span></div>
    </div>
  )
}

function PanelTitle({ icon: Icon, title, action }) {
  return (
    <div className="panel-title">
      <div><Icon size={17} /><h3>{title}</h3></div>
      {action && <button className="panel-action">{action}<ArrowUpRight size={13} /></button>}
    </div>
  )
}

function LoopStep({ number, icon: Icon, title, text, status, tone }) {
  return (
    <div className="loop-step">
      <span className="step-number">{number}</span>
      <div className={`loop-icon ${tone}`}><Icon size={16} /></div>
      <strong>{title}</strong>
      <span>{text}</span>
      <em>{status}</em>
    </div>
  )
}

export default App
