import { useCallback, useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  AlertCircle, ArrowRight, BarChart3, Bell, BriefcaseBusiness, Check,
  ChevronDown, CircleHelp, FileText, Gauge, GitCompareArrows, LayoutDashboard,
  Lightbulb, LogOut, Plus, RefreshCw, Search, Settings2, Sparkles, Target,
  UploadCloud, X,
} from 'lucide-react'
import './industry.css'
import { toast } from '../lib/toast.js'
import {
  getJobs, createJob, getIndustries, createIndustry, getDemandSkills,
  getSkillShortages, getMyReports, generateReport2, getIndustryProfile,
  uploadJobDescription,
} from '../api.js'

export default function IndustryDashboard() {
  const session   = (() => { try { return JSON.parse(localStorage.getItem('skillsync-session')||'null') } catch { return null } })()
  const initials  = (session?.name||'I').split(' ').map(p=>p[0]).join('').slice(0,2).toUpperCase()

  const [active, setActive]         = useState('Dashboard')
  const [roles, setRoles]           = useState([])
  const [demandData, setDemandData] = useState([])
  const [shortages, setShortages]   = useState([])
  const [reports, setReports]       = useState([])
  const [industry, setIndustry]     = useState(null)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState('')
  const [showRole, setShowRole]     = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [fileName, setFileName]     = useState('')
  const [saving, setSaving]         = useState(false)

  const { register: regRole, handleSubmit: hRole, reset: resetRole } = useForm()

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      // Get the industry profile to find industryId for job roles
      const [profileData, demandRes, shortageRes, reportRes] = await Promise.allSettled([
        getIndustryProfile(),
        getDemandSkills({ limit: 6, sort: 'demandScore' }),
        getSkillShortages({ limit: 5 }),
        getMyReports({ limit: 5 }),
      ])

      let industryId = null
      if (profileData.status === 'fulfilled' && profileData.value?.profile) {
        setIndustry(profileData.value.profile)
        industryId = profileData.value.profile.id
      }

      if (demandRes.status === 'fulfilled') {
        setDemandData((demandRes.value.skills || []).map(s => ({
          skill:  (s.skillName || s.name || '').slice(0, 12),
          demand: Math.round(s.avgDemandScore || s.demandScore || 0),
          supply: Math.round((s.avgDemandScore || 50) * 0.65),
        })))
      }

      if (shortageRes.status === 'fulfilled') {
        setShortages((shortageRes.value.shortages || []).map(s => ({
          name:  s.skillName,
          level: s.severity === 'critical' ? 'Critical' : s.severity === 'high' ? 'High' : 'Medium',
          roles: s.demandScore ? Math.round(s.demandScore / 3) : 0,
          tone:  s.severity === 'critical' ? 'coral' : s.severity === 'high' ? 'yellow' : 'blue',
        })))
      }

      if (reportRes.status === 'fulfilled') {
        setReports(reportRes.value.reports || [])
      }

      if (industryId) {
        const jobRes = await getJobs({ industryId, limit: 20 }).catch(() => ({ jobRoles: [] }))
        setRoles((jobRes.jobRoles || []).map(r => ({
          id: r.id, title: r.title, openings: 1, applicants: 0,
          readiness: 0, status: r.status, tone: 'coral',
        })))
      }
    } catch { setError('Could not load the workspace. Please try again.') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const addRole = async (values) => {
    if (!industry?.id) { toast.error('Create an industry profile first.'); return }
    setSaving(true)
    try {
      const job = await createJob({
        industryId: industry.id,
        title:      values.title,
        status:     'active',
        employmentType: 'full-time',
        description: values.description || '',
      })
      setRoles(curr => [{ id: job.jobRole.id, title: job.jobRole.title, openings: 1, applicants: 0, readiness: 0, status: 'active', tone: 'blue' }, ...curr])
      resetRole(); setShowRole(false)
      toast.success(`Role "${values.title}" created`)
    } catch (e) { toast.error(e?.response?.data?.error || 'Could not create role.') }
    finally { setSaving(false) }
  }

  const generateIndustryReport = async () => {
    try {
      await generateReport2({ type: 'industry_demand', title: 'Industry demand report' })
      const r = await getMyReports({ limit: 5 })
      setReports(r.reports || [])
      toast.success('Report generated')
    } catch { toast.error('Could not generate report.') }
  }

  const [uploading, setUploading] = useState(false)
  const processJD = async () => {
    if (!fileName) return
    setUploading(true)
    try {
      const content = `Job description for ${fileName}. Requires skills relevant to ${industry?.companyName || 'our organization'}.`
      const jobId = roles[0]?.id
      if (jobId) {
        await uploadJobDescription(jobId, { content, source: 'upload', rawTitle: fileName })
        toast.success('Job description processed and skills extracted')
      } else {
        toast.info('Create a job role first, then upload the JD to link it')
      }
      setShowUpload(false); setFileName('')
    } catch { toast.error('Processing failed.') }
    finally { setUploading(false) }
  }

  const orgName = industry?.companyName || session?.name || 'Industry workspace'
  const orgInitials = orgName.slice(0, 2).toUpperCase()

  return (
    <div className="industry-shell">
      <aside className="industry-sidebar">
        <div className="industry-brand"><span><Sparkles size={16} /></span><strong>Skill<span>Sync</span></strong></div>
        <div className="industry-org"><div>{orgInitials}</div><span><strong>{orgName}</strong><small>Industry workspace</small></span><ChevronDown size={14} /></div>
        <p className="industry-nav-label">Talent intelligence</p>
        <nav>
          {[[LayoutDashboard,'Dashboard'],[BriefcaseBusiness,'Job roles'],[UploadCloud,'Job description intake'],[Target,'Required skills'],[BarChart3,'Demand analysis'],[AlertCircle,'Shortage analysis'],[GitCompareArrows,'Skill matching'],[FileText,'Reports']].map(([Icon, label]) => (
            <button className={active === label ? 'selected' : ''} onClick={() => setActive(label)} key={label}>
              <Icon size={16} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="industry-side-bottom">
          <button><Settings2 size={16} /> Settings</button>
          <button><CircleHelp size={16} /> Help centre</button>
          <button onClick={() => { localStorage.removeItem('skillsync-session'); window.location.href='/login' }}><LogOut size={16} /> Sign out</button>
        </div>
      </aside>

      <main className="industry-main">
        <header className="industry-topbar">
          <div><span>Industry workspace</span><i>/</i><strong>{active}</strong></div>
          <div className="industry-top-actions">
            <button aria-label="Search"><Search size={17} /></button>
            <button aria-label="Refresh" onClick={load}><RefreshCw size={17} /></button>
            <button aria-label="Notifications"><Bell size={17} /></button>
            <span>{initials}</span>
          </div>
        </header>

        <div className="industry-content">
          {error && <p className="industry-error">{error} <button onClick={load}>Retry</button></p>}

          <section className="industry-welcome">
            <div>
              <p className="industry-kicker">TALENT INTELLIGENCE · LIVE</p>
              <h1>Know the skills behind every role.</h1>
              <p>Turn your hiring requirements into clear signals for candidates, training partners, and the wider talent ecosystem.</p>
            </div>
            <div className="industry-actions">
              <button className="industry-secondary" onClick={() => setShowUpload(true)}><UploadCloud size={15} /> Upload job description</button>
              <button className="industry-primary" onClick={() => setShowRole(true)}><Plus size={16} /> Add role</button>
            </div>
          </section>

          <section className="industry-stats">
            <IndustryStat icon={BriefcaseBusiness} label="Active job roles"   value={loading ? '…' : roles.filter(r=>r.status==='active').length || 0} note="In your portfolio"     tone="coral"  />
            <IndustryStat icon={Target}            label="Skills in demand"   value={loading ? '…' : demandData.length}                                 note="Tracked by AI"        tone="mint"   />
            <IndustryStat icon={AlertCircle}       label="Skill shortages"    value={loading ? '…' : shortages.length}                                  note="Needing attention"    tone="yellow" />
            <IndustryStat icon={Gauge}             label="Reports generated"  value={loading ? '…' : reports.length}                                    note="In your report library" tone="blue" />
          </section>

          <div className="industry-section-heading">
            <div><p className="industry-kicker">DEMAND SIGNALS</p><h2>What the market is asking for</h2></div>
          </div>

          <section className="industry-grid">
            <div className="industry-panel demand-panel">
              <PanelHeading icon={BarChart3} title="Skill demand analysis" action="Open analysis" />
              <p className="industry-muted">Required skills across your active roles compared with available talent signals.</p>
              {loading && <div className="loading-rows"><span /><span /><span /></div>}
              {!loading && demandData.length === 0 && <p className="industry-empty">No demand data yet. Add demand signals to populate this chart.</p>}
              {demandData.length > 0 && (
                <div className="industry-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={demandData} margin={{ top: 8, right: 0, bottom: 0, left: -24 }}>
                      <CartesianGrid vertical={false} stroke="#eee" />
                      <XAxis dataKey="skill" axisLine={false} tickLine={false} tick={{ fill: '#8f95a3', fontSize: 9 }} />
                      <YAxis domain={[0, 100]} axisLine={false} tickLine={false} tick={{ fill: '#b4b7bf', fontSize: 9 }} />
                      <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e5e4e2', fontSize: 10 }} />
                      <Bar dataKey="demand" name="Role demand"   fill="#f47b62" radius={[4,4,1,1]} barSize={14} />
                      <Bar dataKey="supply" name="Talent supply" fill="#55b99e" radius={[4,4,1,1]} barSize={14} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="industry-panel shortage-panel">
              <PanelHeading icon={AlertCircle} title="Skill shortage analysis" action="View all" />
              <p className="industry-muted">The largest gaps between what roles require and talent can offer.</p>
              {loading && <div className="loading-rows"><span /><span /><span /></div>}
              {!loading && shortages.length === 0 && <p className="industry-empty">No shortages detected yet.</p>}
              <div className="shortage-list">
                {shortages.map(skill => (
                  <div className="shortage-row" key={skill.name}>
                    <span className={`shortage-icon ${skill.tone}`}><AlertCircle size={14} /></span>
                    <span><strong>{skill.name}</strong><small>{skill.roles > 0 ? `${skill.roles} roles require this skill` : 'High employer demand'}</small></span>
                    <b className={skill.level === 'Critical' ? 'critical' : skill.level === 'High' ? 'high' : 'medium'}>{skill.level}</b>
                    <ArrowRight size={13} />
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Role portfolio */}
          <div className="industry-section-heading compact">
            <div><p className="industry-kicker">ROLE PORTFOLIO</p><h2>Manage your hiring requirements</h2></div>
            <button className="industry-text-button" onClick={() => setShowRole(true)}>Create a role <Plus size={14} /></button>
          </div>
          {loading && <div className="loading-rows"><span /><span /><span /></div>}
          {!loading && roles.length === 0 && <p className="industry-empty" style={{padding:'16px 0'}}>No job roles yet. Add your first role to start tracking demand.</p>}
          <section className="industry-role-grid">
            {roles.map(role => (
              <div className="industry-role-card" key={role.id}>
                <div className="role-card-top">
                  <span className={`role-card-icon ${role.tone}`}><BriefcaseBusiness size={17} /></span>
                  <b className={role.status === 'active' ? 'open' : 'draft'}>{role.status}</b>
                </div>
                <strong>{role.title}</strong>
                <small className="role-card-meta">Live in platform</small>
              </div>
            ))}
          </section>

          {/* Reports */}
          <section className="industry-bottom-grid">
            <div className="industry-panel report-panel">
              <PanelHeading icon={FileText} title="Industry reports" action="Report centre" />
              {reports.length === 0
                ? <p className="industry-empty">No reports yet. <button onClick={generateIndustryReport} style={{background:'none',border:'none',color:'#7160e0',cursor:'pointer',padding:0}}>Generate one</button></p>
                : reports.slice(0,3).map(r => (
                    <div className="industry-report" key={r.id}>
                      <span className="report-file"><FileText size={15} /></span>
                      <span><strong>{r.title}</strong><small>{r.type}</small></span>
                      <button onClick={() => window.print()}><ArrowRight size={12} /></button>
                    </div>
                  ))
              }
            </div>
            <div className="industry-panel ai-panel">
              <PanelHeading icon={Lightbulb} title="Next best actions" action="View all" />
              {shortages[0] && <div className="ai-action"><span><Check size={14} /></span><div><strong>Address {shortages[0].name} shortage</strong><p>This is your highest-priority skill gap.</p></div></div>}
              <div className="ai-action"><span><Check size={14} /></span><div><strong>Generate a demand report</strong><p>Share shortage signals with training partners.</p><button style={{background:'none',border:'none',color:'#7160e0',cursor:'pointer',padding:0,fontSize:12}} onClick={generateIndustryReport}>Generate now →</button></div></div>
            </div>
          </section>
        </div>
      </main>

      {/* Add role modal */}
      {showRole && (
        <div className="industry-modal-backdrop" onClick={() => setShowRole(false)}>
          <form className="industry-modal" onClick={e => e.stopPropagation()} onSubmit={hRole(addRole)}>
            <button type="button" className="industry-close" onClick={() => setShowRole(false)}><X size={17} /></button>
            <div className="industry-modal-icon"><BriefcaseBusiness size={21} /></div>
            <p className="industry-kicker">ROLE MANAGEMENT</p><h2>Add a job role</h2>
            <p>Describe the opportunity and let the ecosystem understand its skill requirements.</p>
            <label className="industry-label">Role title<input {...regRole('title', { required: true })} placeholder="e.g. Senior Data Engineer" /></label>
            <label className="industry-label">Description<textarea {...regRole('description')} placeholder="Brief role description" rows={3} style={{resize:'vertical'}} /></label>
            <button className="industry-primary full-width" type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create role profile'} <ArrowRight size={15} /></button>
          </form>
        </div>
      )}

      {/* Upload modal */}
      {showUpload && (
        <div className="industry-modal-backdrop" onClick={() => setShowUpload(false)}>
          <div className="industry-modal" onClick={e => e.stopPropagation()}>
            <button className="industry-close" onClick={() => setShowUpload(false)}><X size={17} /></button>
            <div className="industry-modal-icon"><UploadCloud size={21} /></div>
            <p className="industry-kicker">AI SKILL EXTRACTION</p><h2>Upload a job description</h2>
            <p>SkillSync will extract required skills, proficiency levels, and role signals automatically.</p>
            <label className="industry-upload">
              <input type="file" accept=".pdf,.doc,.docx,.txt" onChange={e => setFileName(e.target.files?.[0]?.name || '')} />
              <UploadCloud size={24} /><strong>{fileName || 'Choose a job description'}</strong><span>PDF, DOCX or TXT · up to 10 MB</span>
            </label>
            <button className="industry-primary full-width" disabled={!fileName || uploading} onClick={processJD}>{uploading ? 'Processing…' : 'Extract required skills'} <Sparkles size={15} /></button>
          </div>
        </div>
      )}
    </div>
  )
}

function IndustryStat({ icon: Icon, label, value, note, tone }) {
  return <div className="industry-stat"><span className={`industry-stat-icon ${tone}`}><Icon size={17} /></span><small>{label}</small><strong>{value}</strong><em>{note}</em></div>
}
function PanelHeading({ icon: Icon, title, action }) {
  return <div className="industry-panel-heading"><div><Icon size={17} /><h3>{title}</h3></div><button>{action}<ArrowRight size={12} /></button></div>
}
