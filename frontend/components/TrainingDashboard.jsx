import { useCallback, useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  AlertTriangle, ArrowRight, BarChart3, Bell, BookOpen, Check, ChevronDown,
  CircleHelp, FileText, Gauge, Layers3, LayoutDashboard, Lightbulb, LogOut,
  MapPinned, Plus, RefreshCw, Search, Settings2, Sparkles, Target, UploadCloud,
  Users, X,
} from 'lucide-react'
import './training.css'
import {
  getPrograms, createProgram, getProviders, createProvider,
  getDemandSkills, getCurriculumImprovements, getProgramAlignments,
  getTrainingProfile, getMyReports, generateReport2,
} from '../api.js'

export default function TrainingDashboard() {
  const session  = (() => { try { return JSON.parse(localStorage.getItem('skillsync-session')||'null') } catch { return null } })()
  const initials = (session?.name||'T').split(' ').map(p=>p[0]).join('').slice(0,2).toUpperCase()

  const [active, setActive]           = useState('Dashboard')
  const [programs, setPrograms]       = useState([])
  const [demandData, setDemandData]   = useState([])
  const [recommendations, setRecs]    = useState([])
  const [provider, setProvider]       = useState(null)
  const [reports, setReports]         = useState([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState('')
  const [showBuilder, setShowBuilder] = useState(false)
  const [showUpload, setShowUpload]   = useState(false)
  const [uploadName, setUploadName]   = useState('')
  const [saving, setSaving]           = useState(false)

  const { register, handleSubmit, reset } = useForm()

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [profileRes, demandRes, reportRes] = await Promise.allSettled([
        getTrainingProfile(),
        getDemandSkills({ limit: 6, sort: 'demandScore' }),
        getMyReports({ limit: 4 }),
      ])

      let providerId = null
      if (profileRes.status === 'fulfilled' && profileRes.value?.profile) {
        setProvider(profileRes.value.profile)
        providerId = profileRes.value.profile.id
      } else {
        // Try to find by listing providers
        const provRes = await getProviders({ limit: 1 }).catch(() => null)
        if (provRes?.providers?.[0]) {
          setProvider(provRes.providers[0])
          providerId = provRes.providers[0].id
        }
      }

      if (demandRes.status === 'fulfilled') {
        const skills = demandRes.value.skills || []
        setDemandData(skills.map(s => ({
          name:     (s.skillName || '').slice(0, 10),
          demand:   Math.round(s.avgDemandScore || s.demandScore || 0),
          coverage: Math.round((s.avgDemandScore || 60) * 0.7),
        })))
      }

      if (reportRes.status === 'fulfilled') setReports(reportRes.value.reports || [])

      if (providerId) {
        const progRes = await getPrograms({ providerId, limit: 20 }).catch(() => ({ programs: [] }))
        setPrograms(progRes.programs || [])

        // Fetch alignment data for programs that have it
        const progIds = (progRes.programs || []).map(p => p.id)
        if (progIds.length > 0) {
          const alignments = await Promise.allSettled(progIds.slice(0, 3).map(id => getProgramAlignments(id)))
          const allRecs = []
          alignments.forEach(r => {
            if (r.status === 'fulfilled') {
              r.value.alignments?.forEach(a => {
                if (a.missingSkills?.length) {
                  a.missingSkills.slice(0,2).forEach(ms => {
                    allRecs.push({
                      title:    `Add ${ms.skillName} to your curriculum`,
                      detail:   `Missing from ${a.jobRoleTitle || 'a target role'} — affects alignment score.`,
                      priority: ms.priority === 'critical' ? 'High' : 'Medium',
                      tone:     ms.priority === 'critical' ? 'coral' : 'yellow',
                    })
                  })
                }
              })
            }
          })
          setRecs(allRecs.slice(0, 5))
        }
      }
    } catch { setError('Could not load the training workspace.') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load] )

  const averageAlignment = programs.length
    ? Math.round(programs.reduce((s, p) => s + (p.alignmentPct || 0), 0) / programs.length)
    : null

  const addProgram = async (values) => {
    if (!provider?.id) { setError('Create a provider profile first.'); return }
    setSaving(true)
    try {
      const prog = await createProgram({
        providerId: provider.id, name: values.name,
        status: 'active', deliveryMode: values.deliveryMode || 'hybrid',
        description: values.description || '',
      })
      setPrograms(curr => [prog.program, ...curr])
      reset(); setShowBuilder(false)
    } catch (e) { setError(e?.response?.data?.error || 'Could not create program.') }
    finally { setSaving(false) }
  }

  const generateProviderReport = async () => {
    try {
      await generateReport2({ type: 'training_alignment', title: 'Training alignment report' })
      const r = await getMyReports({ limit: 4 })
      setReports(r.reports || [])
    } catch { setError('Could not generate report.') }
  }

  const orgName = provider?.name || session?.name || 'Training workspace'
  const orgInitials = orgName.slice(0, 2).toUpperCase()

  return (
    <div className="training-shell">
      <aside className="training-sidebar">
        <div className="training-brand"><span><Sparkles size={16} /></span><strong>Skill<span>Sync</span></strong></div>
        <div className="training-org"><div>{orgInitials}</div><span><strong>{orgName}</strong><small>Provider workspace</small></span><ChevronDown size={14} /></div>
        <p className="training-nav-label">Provider workspace</p>
        <nav>
          {[[LayoutDashboard,'Dashboard'],[BookOpen,'Programs'],[Layers3,'Curriculum builder'],[Target,'Industry requirements'],[BarChart3,'Alignment analysis'],[Lightbulb,'Recommendations'],[FileText,'Reports']].map(([Icon, label]) => (
            <button className={active === label ? 'selected' : ''} onClick={() => setActive(label)} key={label}>
              <Icon size={16} /><span>{label}</span>
              {label === 'Recommendations' && recommendations.length > 0 && <em>{recommendations.length}</em>}
            </button>
          ))}
        </nav>
        <div className="training-side-bottom">
          <button><Settings2 size={16} /> Settings</button>
          <button><CircleHelp size={16} /> Help centre</button>
          <button onClick={() => { localStorage.removeItem('skillsync-session'); window.location.href='/login' }}><LogOut size={16} /> Sign out</button>
        </div>
      </aside>

      <main className="training-main">
        <header className="training-topbar">
          <div><span>Provider workspace</span><i>/</i><strong>{active}</strong></div>
          <div className="training-top-actions">
            <button aria-label="Search"><Search size={17} /></button>
            <button aria-label="Refresh" onClick={load}><RefreshCw size={17} /></button>
            <button aria-label="Notifications"><Bell size={17} /></button>
            <span>{initials}</span>
          </div>
        </header>

        <div className="training-content">
          {error && <p className="training-error">{error} <button onClick={load}>Retry</button></p>}

          <section className="training-welcome">
            <div>
              <p className="training-kicker">PROGRAM INTELLIGENCE · LIVE</p>
              <h1>Make every course count.</h1>
              <p>See where your programs meet the market, and where one smart curriculum change can unlock more opportunity.</p>
            </div>
            <div className="training-actions">
              <button className="training-secondary" onClick={() => setShowUpload(true)}><UploadCloud size={15} /> Upload curriculum</button>
              <button className="training-primary" onClick={() => setShowBuilder(true)}><Plus size={16} /> New program</button>
            </div>
          </section>

          {recommendations.length > 0 && (
            <section className="training-signal">
              <div className="training-signal-icon"><Sparkles size={19} /></div>
              <div><strong>Curriculum intelligence is ready.</strong><span>{recommendations.length} improvement recommendation{recommendations.length > 1 ? 's' : ''} waiting across your active programs.</span></div>
              <button onClick={() => setActive('Recommendations')}>Review recommendations <ArrowRight size={14} /></button>
            </section>
          )}

          <section className="training-stats">
            <ProviderStat icon={BookOpen}      label="Active programs"   value={loading ? '…' : programs.filter(p=>p.status==='active').length} note="In your portfolio"    tone="blue"   />
            <ProviderStat icon={Users}         label="Total programs"    value={loading ? '…' : programs.length}                                note="All statuses"       tone="mint"   />
            <ProviderStat icon={Gauge}         label="Avg alignment"     value={loading ? '…' : averageAlignment !== null ? `${averageAlignment}%` : '—'} note="Vs industry demand" tone="violet" />
            <ProviderStat icon={AlertTriangle} label="Improvements"      value={loading ? '…' : recommendations.length}                        note="Waiting for action" tone="coral"  />
          </section>

          <div className="training-section-heading"><div><p className="training-kicker">MARKET FIT</p><h2>How your curriculum meets demand</h2></div></div>

          <section className="training-grid">
            <div className="training-panel demand-chart-panel">
              <PanelHeading icon={BarChart3} title="Industry requirement analysis" action="Open analysis" />
              <p className="training-muted">Demand versus current coverage across the skills your learners need.</p>
              {loading && <div className="loading-rows"><span /><span /><span /></div>}
              {!loading && demandData.length === 0 && <p className="training-empty">No demand data yet.</p>}
              {demandData.length > 0 && (
                <div className="training-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={demandData} margin={{ top: 8, right: 0, bottom: 0, left: -24 }}>
                      <CartesianGrid vertical={false} stroke="#eee" />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#8f95a3', fontSize: 9 }} />
                      <YAxis domain={[0, 100]} axisLine={false} tickLine={false} tick={{ fill: '#b4b7bf', fontSize: 9 }} />
                      <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e5e4e2', fontSize: 10 }} />
                      <Bar dataKey="demand"   name="Industry demand" fill="#f47b62" radius={[4,4,1,1]} barSize={14} />
                      <Bar dataKey="coverage" name="Course coverage" fill="#7598e8" radius={[4,4,1,1]} barSize={14} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="training-panel alignment-panel">
              <PanelHeading icon={Target} title="Program–industry alignment" action="Compare" />
              {averageAlignment !== null && (
                <div className="alignment-score">
                  <div><strong>{averageAlignment}%</strong><span>Portfolio alignment</span></div>
                  <div className="alignment-meter"><i style={{ width: `${averageAlignment}%` }} /></div>
                </div>
              )}
              {loading && <div className="loading-rows"><span /><span /><span /></div>}
              {!loading && programs.length === 0 && <p className="training-empty">No programs yet. Create your first program.</p>}
              <div className="program-mini-list">
                {programs.slice(0, 5).map(prog => (
                  <div key={prog.id} className="program-mini-row">
                    <span><strong>{prog.name}</strong><small>{prog.deliveryMode || 'mixed'} · {prog.status}</small></span>
                    <b className={prog.status === 'active' ? 'aligned' : 'review'}>{prog.status}</b>
                    <ArrowRight size={13} />
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Recommendations */}
          <div className="training-section-heading programs-heading"><div><p className="training-kicker">CURRICULUM ACTIONS</p><h2>AI-powered improvement suggestions</h2></div></div>
          <section className="training-bottom-grid">
            <div className="training-panel recommendation-panel">
              <PanelHeading icon={Lightbulb} title="Curriculum improvement recommendations" action={`View all ${recommendations.length}`} />
              {loading && <div className="loading-rows"><span /><span /></div>}
              {!loading && recommendations.length === 0 && <p className="training-empty">No recommendations yet. Run alignment analysis to generate improvements.</p>}
              <div className="recommendation-list">
                {recommendations.slice(0, 4).map((rec, i) => (
                  <div className="provider-recommendation" key={i}>
                    <span className={`recommendation-priority ${rec.tone}`}><Lightbulb size={14} /></span>
                    <div><strong>{rec.title}</strong><p>{rec.detail}</p></div>
                    <em>{rec.priority}</em>
                  </div>
                ))}
              </div>
            </div>

            <div className="training-panel reports-panel">
              <PanelHeading icon={FileText} title="Provider reports" action="Report centre" />
              {reports.length === 0
                ? <p className="training-empty">No reports yet. <button onClick={generateProviderReport} style={{background:'none',border:'none',color:'#7160e0',cursor:'pointer',padding:0}}>Generate one</button></p>
                : reports.slice(0,3).map(r => (
                    <div className="report-highlight" key={r.id}>
                      <div className="report-icon"><BarChart3 size={18} /></div>
                      <div><strong>{r.title}</strong><p>{r.type}</p></div>
                      <button onClick={() => window.print()}>Open <ArrowRight size={13} /></button>
                    </div>
                  ))
              }
              <div className="report-links">
                <button onClick={generateProviderReport}><FileText size={14} /> Generate PDF report</button>
                <button><MapPinned size={14} /> Regional view</button>
              </div>
            </div>
          </section>

          <footer className="training-footer"><span><Check size={10} /> Curriculum workspace synced</span><span>{orgName}</span></footer>
        </div>
      </main>

      {showBuilder && (
        <div className="training-modal-backdrop" onClick={() => setShowBuilder(false)}>
          <form className="training-modal" onClick={e => e.stopPropagation()} onSubmit={handleSubmit(addProgram)}>
            <button type="button" className="training-close" onClick={() => setShowBuilder(false)}><X size={17} /></button>
            <div className="training-modal-icon"><Layers3 size={21} /></div>
            <p className="training-kicker">CURRICULUM BUILDER</p><h2>Start a new training program</h2>
            <label className="training-label">Program name<input {...register('name', { required: true })} placeholder="e.g. Applied Cloud Analytics" /></label>
            <label className="training-label">Delivery mode<select {...register('deliveryMode')}><option value="hybrid">Hybrid</option><option value="online">Online</option><option value="offline">Offline</option></select></label>
            <button className="training-primary full-width" type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create draft program'} <ArrowRight size={15} /></button>
          </form>
        </div>
      )}

      {showUpload && (
        <div className="training-modal-backdrop" onClick={() => setShowUpload(false)}>
          <div className="training-modal" onClick={e => e.stopPropagation()}>
            <button className="training-close" onClick={() => setShowUpload(false)}><X size={17} /></button>
            <div className="training-modal-icon"><UploadCloud size={21} /></div>
            <p className="training-kicker">AI CURRICULUM EXTRACTION</p><h2>Upload a curriculum</h2>
            <label className="training-upload">
              <input type="file" accept=".pdf,.doc,.docx" onChange={e => setUploadName(e.target.files?.[0]?.name || '')} />
              <UploadCloud size={24} /><strong>{uploadName || 'Choose a curriculum file'}</strong><span>PDF or DOCX · up to 10 MB</span>
            </label>
            <button className="training-primary full-width" disabled={!uploadName} onClick={() => setShowUpload(false)}>Extract curriculum skills <Sparkles size={15} /></button>
          </div>
        </div>
      )}
    </div>
  )
}

function ProviderStat({ icon: Icon, label, value, note, tone }) {
  return <div className="provider-stat"><span className={`provider-stat-icon ${tone}`}><Icon size={17} /></span><small>{label}</small><strong>{value}</strong><em>{note}</em></div>
}
function PanelHeading({ icon: Icon, title, action }) {
  return <div className="training-panel-heading"><div><Icon size={17} /><h3>{title}</h3></div><button>{action}<ArrowRight size={12} /></button></div>
}
