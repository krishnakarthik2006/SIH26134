import { useCallback, useEffect, useState } from 'react'
import { getOverview, getDemandSkills, getMyNotifications } from './api.js'
import DemandChart from './components/DemandChart.jsx'
import SignalForm from './components/SignalForm.jsx'
import SkillMatchingDashboard from './components/SkillMatchingDashboard.jsx'
import {
  Activity, ArrowUpRight, BarChart3, Bell, BookOpen, BriefcaseBusiness,
  ChevronDown, CircleHelp, FileUp, Gauge, GraduationCap, LayoutDashboard,
  MapPinned, Plus, Search, Settings2, Sparkles, Target, Users, X,
} from 'lucide-react'

const navigation = [
  { label: 'Overview',             icon: LayoutDashboard },
  { label: 'Industry demand',      icon: BriefcaseBusiness },
  { label: 'Skill intelligence',   icon: Sparkles },
  { label: 'Curriculum alignment', icon: BookOpen },
  { label: 'Learner pathways',     icon: GraduationCap },
  { label: 'Assessments',          icon: Target },
  { label: 'Regional signals',     icon: MapPinned },
]

// Icon map for notification severity → activity colour
const SEVERITY_COLOR = { high: 'coral', critical: 'coral', warning: 'yellow', success: 'mint', info: 'blue' }
const SKILL_TONES    = ['coral', 'mint', 'yellow', 'blue', 'violet']

function App() {
  const [active, setActive]           = useState('Overview')
  const [showUpload, setShowUpload]   = useState(false)
  const [period, setPeriod]           = useState('Last 30 days')
  const [overview, setOverview]       = useState(null)
  const [skillGaps, setSkillGaps]     = useState([])
  const [activity, setActivity]       = useState([])
  const [loading, setLoading]         = useState(true)

  // Pull user info from session for personalised greeting
  const session = (() => { try { return JSON.parse(localStorage.getItem('skillsync-session') || 'null') } catch { return null } })()
  const firstName = session?.name?.split(' ')[0] || 'there'

  const loadData = useCallback(() => {
    setLoading(true)
    Promise.all([
      getOverview(),
      getDemandSkills({ limit: 6, minDemandScore: 0, sort: 'demandScore' }),
      getMyNotifications({ limit: 6 }).catch(() => ({ notifications: [] })),
    ]).then(([ov, demand, notifData]) => {
      setOverview(ov)

      // Build skill-gap rows from live demand data
      const gaps = (demand.skills || []).map((s, i) => ({
        name:   s.skillName || s.name || 'Unknown',
        demand: Math.round(s.avgDemandScore || s.demandScore || 70),
        supply: Math.max(10, Math.round((s.avgDemandScore || 70) * 0.65 - i * 2)),
        tone:   SKILL_TONES[i % SKILL_TONES.length],
      }))
      setSkillGaps(gaps.length ? gaps : [])

      // Map notifications to activity feed
      const notifs = notifData.notifications || []
      setActivity(notifs.slice(0, 5).map(n => ({
        icon:  Activity,
        title: n.title,
        text:  n.text,
        time:  n.time || '',
        color: SEVERITY_COLOR[n.severity] || 'blue',
      })))
    }).catch(() => {
      setOverview(null)
    }).finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // Ecosystem loop stats driven by overview
  const loopStats = [
    { number: '01', icon: BriefcaseBusiness, title: 'Industry',  text: 'Demand published',   status: overview?.activeDemandSignals ? `${overview.activeDemandSignals.toLocaleString()} signals` : '—',         tone: 'coral'  },
    { number: '02', icon: Sparkles,          title: 'AI layer',  text: 'Skills normalized',  status: overview?.skillsTracked       ? `${overview.skillsTracked.toLocaleString()} skills`   : '—',         tone: 'yellow' },
    { number: '03', icon: BookOpen,          title: 'Training',  text: 'Curricula aligned',  status: overview?.ecosystemAlignment  ? `${overview.ecosystemAlignment}% aligned`            : '—',         tone: 'blue'   },
    { number: '04', icon: GraduationCap,     title: 'Learners',  text: 'Paths improving',    status: overview?.learnersInPathways  ? `${overview.learnersInPathways.toLocaleString()} learners` : '—', tone: 'mint'   },
  ]

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><Sparkles size={17} strokeWidth={2.5} /></div><span>Skill<span>Sync</span></span></div>
        <div className="workspace-switcher"><div className="workspace-avatar">M</div><div><strong>Maharashtra ecosystem</strong><small>State workspace</small></div><ChevronDown size={15} /></div>
        <div className="nav-label">Workspace</div>
        <nav>{navigation.map(item => {
          const Icon = item.icon
          return (
            <button className={`nav-item ${active === item.label ? 'active' : ''}`} key={item.label} onClick={() => setActive(item.label)}>
              <Icon size={17} /><span>{item.label}</span>
            </button>
          )
        })}</nav>
        <div className="sidebar-bottom">
          <button className="nav-item"><Settings2 size={17} /><span>Workspace settings</span></button>
          <div className="support-card"><CircleHelp size={16} /><div><strong>Need a hand?</strong><small>Visit the signal guide</small></div><ArrowUpRight size={14} /></div>
          <div className="profile">
            <div className="profile-photo">{firstName.slice(0,2).toUpperCase()}</div>
            <div><strong>{session?.name || 'Program lead'}</strong><small>{session?.role || 'workspace'}</small></div>
            <ChevronDown size={15} />
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="crumb"><span>Workspace</span><span>/</span><strong>{active}</strong></div>
          <div className="top-actions">
            <button className="icon-button" aria-label="Search"><Search size={18} /></button>
            <button className="icon-button has-dot" aria-label="Notifications"><Bell size={18} /></button>
            <button className="avatar-button">{firstName.slice(0,2).toUpperCase()}</button>
          </div>
        </header>

        {active === 'Skill intelligence' ? <SkillMatchingDashboard /> : (
          <div className="content-wrap">
            <section className="welcome-row">
              <div>
                <p className="eyebrow">{new Date().toLocaleDateString('en-IN', { weekday:'long', day:'numeric', month:'long', year:'numeric' }).toUpperCase()}</p>
                <h1>Good {greeting()}, {firstName} <span className="wave">✦</span></h1>
                <p className="intro">Here is how the skill ecosystem is moving today.</p>
              </div>
              <div className="header-actions">
                <button className="secondary-button"><FileUp size={16} /> Import job descriptions</button>
                <button className="primary-button" onClick={() => setShowUpload(true)}><Plus size={17} /> Add signal</button>
              </div>
            </section>

            <section className="signal-banner">
              <div className="banner-icon"><Activity size={21} /></div>
              <div>
                <strong>The loop is getting smarter.</strong>
                <span>{overview?.activeDemandSignals ? `${overview.activeDemandSignals.toLocaleString()} demand signals are active` : 'Demand signals are being normalised'}, improving recommendations across the ecosystem.</span>
              </div>
              <button className="banner-link" onClick={() => setActive('Skill intelligence')}>View intelligence <ArrowUpRight size={15} /></button>
            </section>

            <section className="metric-grid">
              <Metric icon={BriefcaseBusiness} label="Active demand signals"  value={loading ? '…' : (overview?.activeDemandSignals?.toLocaleString() ?? '—')}  trend="+18.4%" caption="vs. previous month" tone="coral"  />
              <Metric icon={Target}            label="Skills being tracked"   value={loading ? '…' : (overview?.skillsTracked?.toLocaleString()        ?? '—')}  trend="+32"    caption="new this month"   tone="mint"   />
              <Metric icon={Users}             label="Learners in pathways"   value={loading ? '…' : (overview?.learnersInPathways?.toLocaleString()   ?? '—')}  trend="+9.2%"  caption="active roadmaps"  tone="blue"   />
              <Metric icon={Gauge}             label="Ecosystem alignment"    value={loading ? '…' : (overview?.ecosystemAlignment ? `${overview.ecosystemAlignment}%` : '—')} trend="+6.1%" caption="since last review" tone="yellow" />
            </section>

            <div className="section-heading">
              <div><p className="eyebrow">CONNECTED VIEW</p><h2>From demand to action</h2></div>
              <div className="period-select">
                <span>Showing</span>
                <select value={period} onChange={e => setPeriod(e.target.value)}>
                  <option>Last 30 days</option><option>Last 90 days</option><option>This year</option>
                </select>
                <ChevronDown size={14} />
              </div>
            </div>

            <section className="dashboard-grid">
              <div className="panel demand-panel">
                <PanelTitle icon={BarChart3} title="Demand & supply pulse" action="Explore signals" />
                <div className="chart-legend"><span><i className="dot coral-dot" />Industry demand</span><span><i className="dot mint-dot" />Learner supply</span></div>
                <div className="chart-wrap recharts-wrap"><DemandChart data={overview?.demandPulse} /></div>
                <div className="chart-foot"><span><strong>Live data</strong> from the demand intelligence layer</span><a href="#skill-gaps">See skill gaps <ArrowUpRight size={14} /></a></div>
              </div>

              <div className="panel gaps-panel" id="skill-gaps">
                <PanelTitle icon={Sparkles} title="Priority skill gaps" action="View all" />
                <p className="panel-subtitle">Where employer demand is outpacing learner readiness.</p>
                {loading && <div className="loading-rows"><span /><span /><span /></div>}
                {!loading && skillGaps.length === 0 && <p className="panel-empty">No skill gap data yet. Add demand signals to see this panel.</p>}
                <div className="skill-list">
                  {skillGaps.map(skill => (
                    <div className="skill-row" key={skill.name}>
                      <div className="skill-name"><i className={`skill-dot ${skill.tone}`} /><strong>{skill.name}</strong><span>{Math.max(0, skill.demand - skill.supply)} pt gap</span></div>
                      <div className="progress-track"><div className={`progress-fill ${skill.tone}`} style={{ width: `${skill.demand}%` }} /></div>
                      <div className="skill-values"><span>{skill.supply}%</span><b>{skill.demand}%</b></div>
                    </div>
                  ))}
                </div>
                <button className="text-button">Open gap planner <ArrowUpRight size={14} /></button>
              </div>
            </section>

            <section className="bottom-grid">
              <div className="panel loop-panel">
                <PanelTitle icon={Sparkles} title="Ecosystem loop" action="See all activity" />
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
                <div className="loop-footer"><span><i className="pulse" /> Live intelligence flowing through 4 connected stages</span><a href="#activity">Open system map <ArrowUpRight size={14} /></a></div>
              </div>

              <div className="panel activity-panel" id="activity">
                <PanelTitle icon={Activity} title="Latest activity" action="View feed" />
                {loading && <div className="loading-rows"><span /><span /><span /></div>}
                {!loading && activity.length === 0 && <p className="panel-empty">No recent activity. Notifications will appear here.</p>}
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
              <span>SkillSync intelligence workspace</span>
              <span>Data refreshed just now <i className="pulse" /></span>
            </footer>
          </div>
        )}
      </main>

      {showUpload && (
        <div className="modal-backdrop" onClick={() => setShowUpload(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowUpload(false)}><X size={17} /></button>
            <div className="modal-symbol"><FileUp size={21} /></div>
            <p className="eyebrow">NEW DEMAND SIGNAL</p>
            <h2>Bring a role profile into the loop</h2>
            <p>Upload a job description and SkillSync will extract, normalize, and map the skills it contains.</p>
            <SignalForm onComplete={() => { setShowUpload(false); loadData() }} />
          </div>
        </div>
      )}
    </div>
  )
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}

function Metric({ icon: Icon, label, value, trend, caption, tone }) {
  return <div className="metric-card"><div className={`metric-icon ${tone}`}><Icon size={18} /></div><span className="metric-label">{label}</span><strong className="metric-value">{value}</strong><div className="metric-foot"><b>{trend}</b><span>{caption}</span></div></div>
}
function PanelTitle({ icon: Icon, title, action }) {
  return <div className="panel-title"><div><Icon size={17} /><h3>{title}</h3></div><button className="panel-action">{action}<ArrowUpRight size={13} /></button></div>
}
function LoopStep({ number, icon: Icon, title, text, status, tone }) {
  return <div className="loop-step"><span className="step-number">{number}</span><div className={`loop-icon ${tone}`}><Icon size={16} /></div><strong>{title}</strong><span>{text}</span><em>{status}</em></div>
}

export default App
