import { useEffect, useState } from 'react'
import { getOverview } from './api.js'
import DemandChart from './components/DemandChart.jsx'
import SignalForm from './components/SignalForm.jsx'
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  Bell,
  BookOpen,
  BriefcaseBusiness,
  ChevronDown,
  CircleHelp,
  FileUp,
  Gauge,
  GraduationCap,
  LayoutDashboard,
  MapPinned,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Target,
  Users,
  X,
} from 'lucide-react'

const navigation = [
  { label: 'Overview', icon: LayoutDashboard },
  { label: 'Industry demand', icon: BriefcaseBusiness, badge: '12' },
  { label: 'Skill intelligence', icon: Sparkles },
  { label: 'Curriculum alignment', icon: BookOpen },
  { label: 'Learner pathways', icon: GraduationCap },
  { label: 'Assessments', icon: Target },
  { label: 'Regional signals', icon: MapPinned },
]

const skills = [
  { name: 'Python', demand: 92, supply: 67, tone: 'mint' },
  { name: 'Data storytelling', demand: 78, supply: 41, tone: 'coral' },
  { name: 'Cloud fundamentals', demand: 74, supply: 52, tone: 'yellow' },
  { name: 'SQL', demand: 69, supply: 81, tone: 'blue' },
]

const actions = [
  { icon: BriefcaseBusiness, title: 'New industry signal', text: 'Tata Digital uploaded 3 role profiles', time: '18 min ago', color: 'coral' },
  { icon: Target, title: 'Assessment completed', text: '184 learners updated their skill levels', time: '2 hr ago', color: 'mint' },
  { icon: BookOpen, title: 'Curriculum at risk', text: '2 modules need a refresh before July', time: 'Yesterday', color: 'yellow' },
]

function App() {
  const [active, setActive] = useState('Overview')
  const [showUpload, setShowUpload] = useState(false)
  const [period, setPeriod] = useState('Last 30 days')
  const [overview, setOverview] = useState(null)

  useEffect(() => {
    getOverview().then(setOverview).catch(() => setOverview(null))
  }, [])

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><Sparkles size={17} strokeWidth={2.5} /></div><span>Skill<span>Sync</span></span></div>
        <div className="workspace-switcher"><div className="workspace-avatar">M</div><div><strong>Maharashtra ecosystem</strong><small>State workspace</small></div><ChevronDown size={15} /></div>
        <div className="nav-label">Workspace</div>
        <nav>{navigation.map((item) => { const IconComponent = item.icon; return <button className={`nav-item ${active === item.label ? 'active' : ''}`} key={item.label} onClick={() => setActive(item.label)}><IconComponent size={17} /><span>{item.label}</span>{item.badge && <em>{item.badge}</em>}</button> })}</nav>
        <div className="sidebar-bottom"><button className="nav-item"><Settings2 size={17} /><span>Workspace settings</span></button><div className="support-card"><CircleHelp size={16} /><div><strong>Need a hand?</strong><small>Visit the signal guide</small></div><ArrowUpRight size={14} /></div><div className="profile"><div className="profile-photo">AK</div><div><strong>Arjun Kulkarni</strong><small>Program lead</small></div><ChevronDown size={15} /></div></div>
      </aside>

      <main className="main-content">
        <header className="topbar"><div className="crumb"><span>Workspace</span><span>/</span><strong>{active}</strong></div><div className="top-actions"><button className="icon-button" aria-label="Search"><Search size={18} /></button><button className="icon-button has-dot" aria-label="Notifications"><Bell size={18} /></button><button className="avatar-button">AK</button></div></header>
        <div className="content-wrap">
          <section className="welcome-row"><div><p className="eyebrow">THURSDAY, 04 SEPTEMBER 2026</p><h1>Good morning, Arjun <span className="wave">✦</span></h1><p className="intro">Here is how the skill ecosystem is moving today.</p></div><div className="header-actions"><button className="secondary-button"><FileUp size={16} /> Import job descriptions</button><button className="primary-button" onClick={() => setShowUpload(true)}><Plus size={17} /> Add signal</button></div></section>
          <section className="signal-banner"><div className="banner-icon"><Activity size={21} /></div><div><strong>The loop is getting smarter.</strong><span>1,248 new demand signals have been normalized this month, improving recommendations across the ecosystem.</span></div><button className="banner-link" onClick={() => setActive('Skill intelligence')}>View intelligence <ArrowUpRight size={15} /></button></section>
          <section className="metric-grid"><Metric icon={BriefcaseBusiness} label="Active demand signals" value={overview?.activeDemandSignals?.toLocaleString() || '1,248'} trend="+18.4%" caption="vs. previous month" tone="coral" /><Metric icon={Target} label="Skills being tracked" value={overview?.skillsTracked?.toLocaleString() || '486'} trend="+32" caption="new this month" tone="mint" /><Metric icon={Users} label="Learners in pathways" value={overview?.learnersInPathways?.toLocaleString() || '12,536'} trend="+9.2%" caption="across 84 programs" tone="blue" /><Metric icon={Gauge} label="Ecosystem alignment" value={`${overview?.ecosystemAlignment || 68}%`} trend="+6.1%" caption="since last review" tone="yellow" /></section>
          <div className="section-heading"><div><p className="eyebrow">CONNECTED VIEW</p><h2>From demand to action</h2></div><div className="period-select"><span>Showing</span><select value={period} onChange={(event) => setPeriod(event.target.value)}><option>Last 30 days</option><option>Last 90 days</option><option>This year</option></select><ChevronDown size={14} /></div></div>
          <section className="dashboard-grid"><div className="panel demand-panel"><PanelTitle icon={BarChart3} title="Demand & supply pulse" action="Explore signals" /><div className="chart-legend"><span><i className="dot coral-dot" />Industry demand</span><span><i className="dot mint-dot" />Learner supply</span></div><div className="chart-wrap recharts-wrap"><DemandChart data={overview?.demandPulse} /></div><div className="chart-foot"><span><strong>+18%</strong> more roles needing digital skills</span><a href="#skill-gaps">See skill gaps <ArrowUpRight size={14} /></a></div></div><div className="panel gaps-panel" id="skill-gaps"><PanelTitle icon={Sparkles} title="Priority skill gaps" action="View all" /><p className="panel-subtitle">Where employer demand is outpacing learner readiness.</p><div className="skill-list">{skills.map((skill) => <div className="skill-row" key={skill.name}><div className="skill-name"><i className={`skill-dot ${skill.tone}`} /><strong>{skill.name}</strong><span>{skill.demand - skill.supply} pt gap</span></div><div className="progress-track"><div className={`progress-fill ${skill.tone}`} style={{ width: `${skill.demand}%` }} /></div><div className="skill-values"><span>{skill.supply}%</span><b>{skill.demand}%</b></div></div>)}</div><button className="text-button">Open gap planner <ArrowUpRight size={14} /></button></div></section>
          <section className="bottom-grid"><div className="panel loop-panel"><PanelTitle icon={Sparkles} title="Ecosystem loop" action="See all activity" /><div className="loop-steps"><LoopStep number="01" icon={BriefcaseBusiness} title="Industry" text="Demand published" status="1,248 signals" tone="coral" /><div className="connector" /><LoopStep number="02" icon={Sparkles} title="AI layer" text="Skills normalized" status="486 skills" tone="yellow" /><div className="connector" /><LoopStep number="03" icon={BookOpen} title="Training" text="Curricula aligned" status="84 programs" tone="blue" /><div className="connector" /><LoopStep number="04" icon={GraduationCap} title="Learners" text="Paths improving" status="12.5k learners" tone="mint" /></div><div className="loop-footer"><span><i className="pulse" /> Live intelligence flowing through 4 connected stages</span><a href="#activity">Open system map <ArrowUpRight size={14} /></a></div></div><div className="panel activity-panel" id="activity"><PanelTitle icon={Activity} title="Latest activity" action="View feed" /><div className="activity-list">{actions.map((action) => { const ActionIcon = action.icon; return <div className="activity-item" key={action.title}><div className={`activity-icon ${action.color}`}><ActionIcon size={15} /></div><div><strong>{action.title}</strong><p>{action.text}</p></div><time>{action.time}</time></div> })}</div></div></section>
          <section className="regional-strip"><div className="regional-copy"><div className="regional-icon"><MapPinned size={19} /></div><div><p className="eyebrow">REGIONAL SIGNAL</p><h3>Vidarbha needs a stronger cloud talent pipeline</h3><p>Demand is up 24% while local course coverage sits at 51%. A targeted intervention could unlock 3,200 roles.</p></div></div><button className="secondary-button">Open regional view <ArrowUpRight size={16} /></button></section>
          <footer className="footer"><span>SkillSync intelligence workspace</span><span>Data refreshed 6 minutes ago <i className="pulse" /></span></footer>
        </div>
      </main>
      {showUpload && <div className="modal-backdrop" onClick={() => setShowUpload(false)}><div className="modal" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setShowUpload(false)}><X size={17} /></button><div className="modal-symbol"><FileUp size={21} /></div><p className="eyebrow">NEW DEMAND SIGNAL</p><h2>Bring a role profile into the loop</h2><p>Upload a job description and SkillSync will extract, normalize, and map the skills it contains.</p><SignalForm onComplete={() => setShowUpload(false)} /></div></div>}
    </div>
  )
}

function Metric({ icon: IconComponent, label, value, trend, caption, tone }) { return <div className="metric-card"><div className={`metric-icon ${tone}`}><IconComponent size={18} /></div><span className="metric-label">{label}</span><strong className="metric-value">{value}</strong><div className="metric-foot"><b>{trend}</b><span>{caption}</span></div></div> }
function PanelTitle({ icon: IconComponent, title, action }) { return <div className="panel-title"><div><IconComponent size={17} /><h3>{title}</h3></div><button className="panel-action">{action}<ArrowUpRight size={13} /></button></div> }
function LoopStep({ number, icon: IconComponent, title, text, status, tone }) { return <div className="loop-step"><span className="step-number">{number}</span><div className={`loop-icon ${tone}`}><IconComponent size={16} /></div><strong>{title}</strong><span>{text}</span><em>{status}</em></div> }

export default App
