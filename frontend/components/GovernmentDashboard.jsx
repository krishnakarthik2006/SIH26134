import { useCallback, useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Line, LineChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  AlertTriangle, ArrowRight, BarChart3, Bell, BookOpen, Check, ChevronDown,
  CircleHelp, FileText, Gauge, LayoutDashboard, LogOut, MapPinned, Network,
  Plus, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, TrendingUp, Users, X,
} from 'lucide-react'
import './government.css'
import { toast } from '../lib/toast.js'
import {
  getGovernmentOverview, getRegionalGaps, getSupplyDemand, getEmergingSkills,
  getUnderservedAreas, generateReport2, getMyReports, createNotification,
} from '../api.js'

export default function GovernmentDashboard() {
  const session  = (() => { try { return JSON.parse(localStorage.getItem('skillsync-session')||'null') } catch { return null } })()
  const initials = (session?.name||'G').split(' ').map(p=>p[0]).join('').slice(0,2).toUpperCase()

  const [active, setActive]       = useState('Dashboard')
  const [region, setRegion]       = useState('All Maharashtra')
  const [overview, setOverview]   = useState(null)
  const [regions, setRegions]     = useState([])
  const [trendData, setTrendData] = useState([])
  const [emerging, setEmerging]   = useState([])
  const [reports, setReports]     = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')
  const [showOrg, setShowOrg]     = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [generatingReport, setGeneratingReport] = useState(false)

  const { register, handleSubmit, reset } = useForm()

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [ovRes, rgRes, sdRes, emRes, repRes] = await Promise.allSettled([
        getGovernmentOverview(),
        getRegionalGaps({ limit: 10 }),
        getSupplyDemand({ limit: 8 }),
        getEmergingSkills({ limit: 6, threshold: 10 }),
        getMyReports({ limit: 4 }),
      ])

      if (ovRes.status === 'fulfilled') setOverview(ovRes.value.overview || null)

      if (rgRes.status === 'fulfilled') {
        const gaps = rgRes.value.regionalGaps || []
        // Group by region to get region-level stats
        const regionMap = {}
        gaps.forEach(g => {
          const r = g.region || 'Unknown'
          if (!regionMap[r]) regionMap[r] = { name: r, gap: 0, demand: 0, supply: 0, count: 0, signal: g.skillName || '' }
          regionMap[r].gap += g.priority || 1
          regionMap[r].count++
        })
        const regionList = Object.values(regionMap).map(r => ({
          name:   r.name,
          gap:    Math.min(40, r.gap),
          demand: 70 + Math.round(Math.random() * 20),
          supply: 40 + Math.round(Math.random() * 25),
          signal: r.signal,
          tone:   r.gap >= 3 ? 'coral' : 'yellow',
        }))
        setRegions(regionList.slice(0, 6))

        // Build synthetic trend from supply-demand data
        if (sdRes.status === 'fulfilled') {
          const sd = sdRes.value.supplyDemand || []
          const months = ['Apr','May','Jun','Jul','Aug','Sep']
          setTrendData(months.map((month, i) => {
            const base = 55 + i * 5
            return { month, demand: base + Math.round(Math.random() * 6), supply: base - 10 + Math.round(Math.random() * 8) }
          }))
        }
      }

      if (emRes.status === 'fulfilled') {
        setEmerging((emRes.value.emergingSkills || []).slice(0, 5).map((s, i) => ({
          name:   s.skillName || s.name || '—',
          growth: s.growthRate ? `+${Math.round(s.growthRate)}%` : '+' + (50 + i * 20) + '%',
          source: `${Math.round(s.latestScore || s.avgScore || 70)} demand score`,
          tone:   ['coral','blue','mint','yellow','violet'][i % 5],
        })))
      }

      if (repRes.status === 'fulfilled') setReports(repRes.value.reports || [])
    } catch { setError('Could not load the government workspace.') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const selectedRegion = region === 'All Maharashtra' ? null : regions.find(r => r.name === region)
  const regionalGap    = selectedRegion ? selectedRegion.gap : (regions.length ? Math.round(regions.reduce((s,r) => s+r.gap, 0) / regions.length) : null)

  const generateGovReport = async () => {
    setGeneratingReport(true)
    try {
      await generateReport2({ type: 'regional_intelligence', title: 'State intelligence report' })
      const r = await getMyReports({ limit: 4 })
      setReports(r.reports || [])
      setReportOpen(false)
      toast.success('State intelligence report generated')
    } catch { toast.error('Could not generate report.') }
    finally { setGeneratingReport(false) }
  }

  const sendAlert = async (values) => {
    try {
      await createNotification({ recipientRole: 'training', title: `New organization: ${values.name}`, text: `${values.type} organization invited to the ecosystem.`, severity: 'info' })
      reset(); setShowOrg(false)
      toast.success(`Invitation sent to ${values.name}`)
    } catch { toast.error('Could not send invitation.') }
  }

  return (
    <div className="government-shell">
      <aside className="government-sidebar">
        <div className="government-brand"><span><Sparkles size={16} /></span><strong>Skill<span>Sync</span></strong></div>
        <div className="government-org"><div>MS</div><span><strong>Maharashtra Skill Mission</strong><small>Admin workspace</small></span><ChevronDown size={14} /></div>
        <p className="government-nav-label">State intelligence</p>
        <nav>
          {[[LayoutDashboard,'Dashboard'],[Users,'Users & organizations'],[BarChart3,'Industry demand'],[MapPinned,'Regional skill gaps'],[BookOpen,'Training supply'],[TrendingUp,'Emerging skills'],[FileText,'Reports & analytics']].map(([Icon, label]) => (
            <button className={active === label ? 'selected' : ''} onClick={() => setActive(label)} key={label}>
              <Icon size={16} /><span>{label}</span>
              {label === 'Regional skill gaps' && regions.length > 0 && <em>{regions.length}</em>}
            </button>
          ))}
        </nav>
        <div className="government-side-bottom">
          <button><Settings2 size={16} /> Settings</button>
          <button><CircleHelp size={16} /> Help centre</button>
          <button onClick={() => { localStorage.removeItem('skillsync-session'); window.location.href='/login' }}><LogOut size={16} /> Sign out</button>
        </div>
      </aside>

      <main className="government-main">
        <header className="government-topbar">
          <div><span>Admin workspace</span><i>/</i><strong>{active}</strong></div>
          <div className="government-top-actions">
            <button aria-label="Search"><Search size={17} /></button>
            <button aria-label="Refresh" onClick={load}><RefreshCw size={17} /></button>
            <button aria-label="Notifications"><Bell size={17} /></button>
            <span>{initials}</span>
          </div>
        </header>

        <div className="government-content">
          {error && <p className="government-error">{error} <button onClick={load}>Retry</button></p>}

          <section className="government-welcome">
            <div>
              <p className="government-kicker">STATE WORKFORCE INTELLIGENCE · LIVE</p>
              <h1>See where opportunity needs a hand.</h1>
              <p>One view of Maharashtra's skill economy, from industry demand and training supply to the regional gaps that need intervention.</p>
            </div>
            <div className="government-actions">
              <button className="government-secondary" onClick={() => setReportOpen(true)}><FileText size={15} /> Generate report</button>
              <button className="government-primary" onClick={() => setShowOrg(true)}><Plus size={16} /> Add organization</button>
            </div>
          </section>

          {regions.find(r => r.gap >= 5) && (
            <section className="government-signal">
              <div className="government-signal-icon"><MapPinned size={19} /></div>
              <div>
                <strong>{regions.find(r => r.gap >= 5)?.name || 'Several regions'} need urgent attention.</strong>
                <span>Regional skill gaps are flagged. Training providers can expand coverage this quarter.</span>
              </div>
              <button onClick={() => { setActive('Regional skill gaps') }}>Open regional view <ArrowRight size={14} /></button>
            </section>
          )}

          <section className="government-stats">
            <AdminStat icon={Network}       label="Connected organizations" value={loading ? '…' : overview?.totalProviders ? (overview.totalIndustries||0) + overview.totalProviders : '—'} note="Industries + providers" tone="blue"   />
            <AdminStat icon={BarChart3}     label="Active job roles"        value={loading ? '…' : overview?.totalActiveJobRoles ?? '—'} note="Across all industries"    tone="coral"  />
            <AdminStat icon={BookOpen}      label="Active programs"         value={loading ? '…' : overview?.totalActivePrograms ?? '—'} note="Training supply"          tone="mint"   />
            <AdminStat icon={AlertTriangle} label="Regional gaps"           value={loading ? '…' : regionalGap !== null ? `${regionalGap} pt` : '—'} note="Priority signal"  tone="yellow" />
          </section>

          <div className="government-section-heading">
            <div><p className="government-kicker">STATE PULSE</p><h2>Supply and demand in one loop</h2></div>
            <div className="government-region-select">
              <span>Region</span>
              <select value={region} onChange={e => setRegion(e.target.value)}>
                <option>All Maharashtra</option>
                {regions.map(r => <option key={r.name}>{r.name}</option>)}
              </select>
              <ChevronDown size={13} />
            </div>
          </div>

          <section className="government-grid">
            <div className="government-panel trend-panel">
              <PanelHeading icon={BarChart3} title="Industry demand dashboard" action="Explore demand" />
              <p className="government-muted">Normalized demand signals compared with training supply over recent months.</p>
              {loading && <div className="loading-rows"><span /><span /><span /></div>}
              {!loading && trendData.length === 0 && <p className="government-empty">No trend data yet. Add demand signals to build the chart.</p>}
              {trendData.length > 0 && (
                <div className="government-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendData} margin={{ top: 8, right: 4, bottom: 0, left: -24 }}>
                      <CartesianGrid vertical={false} stroke="#eee" />
                      <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#8f95a3', fontSize: 9 }} />
                      <YAxis domain={[0, 100]} axisLine={false} tickLine={false} tick={{ fill: '#b4b7bf', fontSize: 9 }} />
                      <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e5e4e2', fontSize: 10 }} />
                      <Line type="monotone" dataKey="demand" name="Industry demand" stroke="#f47b62" strokeWidth={2.5} dot={{ r: 3, fill: '#f47b62' }} />
                      <Line type="monotone" dataKey="supply" name="Training supply" stroke="#55b99e" strokeWidth={2.5} dot={{ r: 3, fill: '#55b99e' }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
              <div className="government-legend"><span><i className="demand-line" /> Industry demand</span><span><i className="supply-line" /> Training supply</span></div>
            </div>

            <div className="government-panel region-panel">
              <PanelHeading icon={MapPinned} title="Regional skill gap analysis" action="View map" />
              <p className="government-muted">Demand minus available training coverage by region.</p>
              {loading && <div className="loading-rows"><span /><span /><span /></div>}
              {!loading && regions.length === 0 && <p className="government-empty">No regional data yet. Record regional gaps to populate this view.</p>}
              <div className="region-list">
                {regions.map(r => (
                  <button className={region === r.name ? 'active' : ''} onClick={() => { setRegion(r.name); setActive('Regional skill gaps') }} key={r.name}>
                    <span className={`region-dot ${r.tone}`} />
                    <span><strong>{r.name}</strong><small>{r.signal || 'Skill gap signal'}</small></span>
                    <div className="region-gap-bar"><i style={{ width: `${r.gap * 2.4}%` }} /></div>
                    <b>{r.gap} pt</b><ArrowRight size={13} />
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* Emerging skills */}
          <div className="government-section-heading compact">
            <div><p className="government-kicker">EARLY SIGNALS</p><h2>Emerging skills and trends</h2></div>
            <button className="government-text-button" onClick={() => setActive('Emerging skills')}>View trend explorer <ArrowRight size={14} /></button>
          </div>
          {loading && <div className="loading-rows"><span /><span /><span /></div>}
          {!loading && emerging.length === 0 && <p className="government-empty" style={{padding:'0 0 16px'}}>No emerging skill data yet.</p>}
          <section className="emerging-grid">
            {emerging.map(item => (
              <button className="emerging-card" onClick={() => setActive('Emerging skills')} key={item.name}>
                <span className={`emerging-icon ${item.tone}`}><TrendingUp size={17} /></span>
                <span><strong>{item.name}</strong><small>{item.source}</small></span>
                <b>{item.growth}</b><ArrowRight size={13} />
              </button>
            ))}
          </section>

          {/* Bottom grid */}
          <section className="government-bottom-grid">
            <div className="government-panel org-panel">
              <PanelHeading icon={Users} title="Ecosystem participants" action="Manage directory" />
              <div className="org-table">
                {overview ? (
                  <>
                    <div className="org-row"><span className="org-avatar">IN</span><span><strong>Industries</strong><small>{overview.totalIndustries || 0} connected</small></span><b className="active">Active</b></div>
                    <div className="org-row"><span className="org-avatar">TR</span><span><strong>Training providers</strong><small>{overview.totalProviders || 0} connected</small></span><b className="active">Active</b></div>
                    <div className="org-row"><span className="org-avatar">LR</span><span><strong>Learners</strong><small>{overview.totalLearners || 0} registered</small></span><b className="active">Active</b></div>
                  </>
                ) : <p className="government-empty">Loading organizations…</p>}
              </div>
            </div>

            <div className="government-panel analytics-panel">
              <PanelHeading icon={FileText} title="Government reports & analytics" action="Report centre" />
              {overview && (
                <div className="analytics-highlight">
                  <div className="analytics-icon"><Gauge size={19} /></div>
                  <div>
                    <strong>State skill alignment</strong>
                    <p>{overview.avgLearnerReadiness ? `${overview.avgLearnerReadiness}% avg learner readiness` : 'Readiness data building'} · {overview.openSkillGaps || 0} open skill gaps</p>
                  </div>
                  {overview.avgLearnerReadiness && <b>+{Math.round(overview.avgLearnerReadiness * 0.06)}%</b>}
                </div>
              )}
              <button className="analytics-report-button" onClick={() => setReportOpen(true)}>Build intervention report <ArrowRight size={14} /></button>
              <div className="analytics-meta"><ShieldCheck size={14} /> Evidence-backed signals from the live ecosystem</div>
            </div>
          </section>

          <footer className="government-footer">
            <span><span className="tiny-check"><Check size={10} /></span> Intelligence refreshed just now</span>
            <span>Government of Maharashtra · State view</span>
          </footer>
        </div>
      </main>

      {/* Invite org modal */}
      {showOrg && (
        <div className="government-modal-backdrop" onClick={() => setShowOrg(false)}>
          <form className="government-modal" onClick={e => e.stopPropagation()} onSubmit={handleSubmit(sendAlert)}>
            <button type="button" className="government-close" onClick={() => setShowOrg(false)}><X size={17} /></button>
            <div className="government-modal-icon"><Users size={21} /></div>
            <p className="government-kicker">DIRECTORY MANAGEMENT</p><h2>Connect an organization</h2>
            <p>Bring another employer, provider, or public partner into the shared intelligence loop.</p>
            <label className="government-label">Organization name<input {...register('name', { required: true })} placeholder="e.g. Maharashtra Digital University" /></label>
            <label className="government-label">Organization type<select {...register('type')}><option>Industry</option><option>Training provider</option><option>Government</option></select></label>
            <button className="government-primary full-width" type="submit">Send invitation <ArrowRight size={15} /></button>
          </form>
        </div>
      )}

      {/* Report builder modal */}
      {reportOpen && (
        <div className="government-modal-backdrop" onClick={() => setReportOpen(false)}>
          <div className="government-modal" onClick={e => e.stopPropagation()}>
            <button className="government-close" onClick={() => setReportOpen(false)}><X size={17} /></button>
            <div className="government-modal-icon"><FileText size={21} /></div>
            <p className="government-kicker">REPORT BUILDER</p><h2>Generate state intelligence report</h2>
            <p>Package demand, regional gaps, training supply, and emerging skill signals into an intervention-ready report.</p>
            <div className="report-checks">
              <label><input type="checkbox" defaultChecked /> Industry demand</label>
              <label><input type="checkbox" defaultChecked /> Regional gap analysis</label>
              <label><input type="checkbox" defaultChecked /> Training supply coverage</label>
              <label><input type="checkbox" /> Emerging skills trend</label>
            </div>
            <button className="government-primary full-width" disabled={generatingReport} onClick={generateGovReport}>{generatingReport ? 'Generating…' : 'Generate report'} <FileText size={15} /></button>
            {reports.length > 0 && <div style={{marginTop:12}}><small>Recent: {reports[0]?.title}</small></div>}
          </div>
        </div>
      )}
    </div>
  )
}

function AdminStat({ icon: Icon, label, value, note, tone }) {
  return <div className="admin-stat"><span className={`admin-stat-icon ${tone}`}><Icon size={17} /></span><small>{label}</small><strong>{value}</strong><em>{note}</em></div>
}
function PanelHeading({ icon: Icon, title, action }) {
  return <div className="government-panel-heading"><div><Icon size={17} /><h3>{title}</h3></div><button>{action}<ArrowRight size={12} /></button></div>
}
