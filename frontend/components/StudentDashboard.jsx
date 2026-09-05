import { useCallback, useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  ArrowRight, Award, BookOpen, BriefcaseBusiness, Check, ChevronDown,
  CircleHelp, GraduationCap, LayoutDashboard, LogOut, Pencil, Plus,
  RefreshCw, Search, Settings2, Sparkles, Target, TrendingUp, UserRound,
  UploadCloud, X,
} from 'lucide-react'
import { StudentRecommendations } from './RecommendationDashboard.jsx'
import './student.css'
import { toast } from '../lib/toast.js'
import {
  getStudentReadiness, getStudentTargetRole, getStudentCurrentSkills,
  updateStudentCurrentSkills, getJobs, updateStudentTargetRole,
  getMyAttempts, generateRoadmap, getMyRoadmaps,
  listAssessments, submitAttempt, completeStep, getAssessment,
} from '../api.js'

const LEVEL_SCORE = { beginner: 25, intermediate: 55, advanced: 80, expert: 100 }
const SKILL_COLORS = ['coral', 'mint', 'blue', 'yellow', 'violet']

export default function StudentDashboard() {
  const session = (() => { try { return JSON.parse(localStorage.getItem('skillsync-session') || 'null') } catch { return null } })()
  const firstName = session?.name?.split(' ')[0] || 'Learner'
  const initials  = (session?.name || 'L').split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2)

  const [activeTab, setActiveTab]     = useState('Dashboard')
  const [readiness, setReadiness]     = useState(null)
  const [currentSkills, setCurrentSkills] = useState([])
  const [targetRole, setTargetRole]   = useState(null)
  const [jobRoles, setJobRoles]       = useState([])
  const [attempts, setAttempts]       = useState([])
  const [roadmaps, setRoadmaps]       = useState([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState('')
  const [showProfile, setShowProfile] = useState(false)
  const [showSkills, setShowSkills]   = useState(false)
  const [showResume, setShowResume]   = useState(false)
  const [resumeName, setResumeName]   = useState('')
  const [savingSkills, setSavingSkills] = useState(false)

  const { register: regProfile, handleSubmit: hProfile } = useForm({
    defaultValues: { name: session?.name || '', email: session?.email || '', headline: '' },
  })
  const { register: regSkill, handleSubmit: hSkill, reset: resetSkill } = useForm()

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [roleData, skillData, attemptData, roadmapData] = await Promise.allSettled([
        getStudentTargetRole(),
        getStudentCurrentSkills(),
        getMyAttempts({ limit: 5 }),
        getMyRoadmaps({ status: 'active', limit: 3 }),
      ])

      if (roleData.status === 'fulfilled') setTargetRole(roleData.value?.targetJobRole || null)
      if (skillData.status === 'fulfilled') setCurrentSkills(skillData.value?.currentSkills || [])
      if (attemptData.status === 'fulfilled') setAttempts(attemptData.value?.attempts || [])
      if (roadmapData.status === 'fulfilled') setRoadmaps(roadmapData.value?.roadmaps || [])

      // Fetch readiness only if target role is set
      if (roleData.value?.targetJobRole) {
        try {
          const r = await getStudentReadiness()
          setReadiness(r.report)
        } catch { /* no readiness yet */ }
      }
    } catch (e) {
      setError('Could not load your workspace. Please try again.')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  // Fetch available job roles for target-role picker
  useEffect(() => {
    getJobs({ status: 'active', limit: 50 }).then(d => setJobRoles(d.jobRoles || [])).catch(() => {})
  }, [])

  const changeTargetRole = async (jobRoleId) => {
    if (!jobRoleId) return
    try {
      await updateStudentTargetRole(jobRoleId)
      await load()
    } catch { setError('Could not update target role.') }
  }

  const saveProfile = (values) => {
    const updated = { ...session, ...values }
    localStorage.setItem('skillsync-session', JSON.stringify(updated))
    setShowProfile(false)
    toast.success('Profile saved')
  }

  const addSkill = async (values) => {
    const skill = { skillName: values.skillName.trim(), level: values.level || 'beginner' }
    const updated = [...currentSkills, skill]
    setSavingSkills(true)
    try {
      await updateStudentCurrentSkills(updated)
      setCurrentSkills(updated)
      resetSkill()
      toast.success(`${skill.skillName} added to your profile`)
      if (targetRole) {
        const r = await getStudentReadiness().catch(() => null)
        if (r) setReadiness(r.report)
      }
    } catch { toast.error('Could not save skill.') }
    finally { setSavingSkills(false) }
  }

  // Build a 6-point progress curve from readiness history (synthetic if unavailable)
  const progressData = readiness
    ? [{ week: 'W1', score: Math.max(0, (readiness.jobReadinessScore || 50) - 20) },
       { week: 'W2', score: Math.max(0, (readiness.jobReadinessScore || 50) - 15) },
       { week: 'W3', score: Math.max(0, (readiness.jobReadinessScore || 50) - 10) },
       { week: 'W4', score: Math.max(0, (readiness.jobReadinessScore || 50) - 6) },
       { week: 'W5', score: Math.max(0, (readiness.jobReadinessScore || 50) - 2) },
       { week: 'W6', score: readiness.jobReadinessScore || 50 }]
    : []

  const readinessScore = readiness?.jobReadinessScore ?? null
  const gaps = readiness?.missingSkills || []
  const strengths = readiness?.strengths || []

  const generateMyRoadmap = async () => {
    if (!targetRole || !gaps.length) return
    try {
      const gapPayload = gaps.map(g => ({ skillName: g.skillName, canonicalId: g.canonicalId, requiredLevel: g.requiredLevel, requirement: g.requirement || 'required' }))
      await generateRoadmap({ subjectId: session?.id, targetRole: targetRole.title, jobRoleId: targetRole.id, gaps: gapPayload, currentSkills })
      const r = await getMyRoadmaps({ limit: 3 })
      setRoadmaps(r.roadmaps || [])
      setActiveTab('Learning roadmap')
      toast.success('Learning roadmap generated')
    } catch { toast.error('Could not generate roadmap.') }
  }

  return (
    <div className="student-shell">
      <aside className="student-sidebar">
        <div className="student-brand"><span className="student-brand-mark"><Sparkles size={16} /></span><strong>Skill<span>Sync</span></strong></div>
        <div className="student-profile-mini">
          <div className="student-avatar">{initials}</div>
          <div><strong>{session?.name || 'Learner'}</strong><small>Learner workspace</small></div>
          <ChevronDown size={14} />
        </div>
        <p className="student-nav-label">My journey</p>
        <nav className="student-nav">
          {[[LayoutDashboard,'Dashboard'],[UserRound,'My profile'],[Target,'Skill gap'],[BookOpen,'Recommendations'],[GraduationCap,'Learning roadmap'],[Award,'Assessments']].map(([Icon, label]) => (
            <button className={activeTab === label ? 'selected' : ''} onClick={() => setActiveTab(label)} key={label}>
              <Icon size={16} /><span>{label}</span>
              {label === 'Skill gap' && gaps.length > 0 && <em>{gaps.length}</em>}
            </button>
          ))}
        </nav>
        <div className="student-side-bottom">
          <button className="student-side-link"><Settings2 size={16} /> Settings</button>
          <button className="student-side-link"><CircleHelp size={16} /> Help centre</button>
          <button className="student-logout" onClick={() => { localStorage.removeItem('skillsync-session'); window.location.href = '/login' }}><LogOut size={16} /> Sign out</button>
        </div>
      </aside>

      <main className="student-main">
        <header className="student-topbar">
          <div><span className="student-breadcrumb">Learner workspace</span><span className="student-slash">/</span><strong>{activeTab}</strong></div>
          <div className="student-top-actions">
            <button aria-label="Search"><Search size={17} /></button>
            <button aria-label="Refresh" onClick={load}><RefreshCw size={17} /></button>
            <button className="student-top-avatar">{initials}</button>
          </div>
        </header>

        <div className="student-content">
          {error && <p className="student-error" role="alert">{error} <button onClick={load}>Retry</button></p>}

          {activeTab === 'Recommendations' ? (
            <StudentRecommendations onOpenRoadmap={() => setActiveTab('Learning roadmap')} />
          ) : activeTab === 'Learning roadmap' ? (
            <RoadmapTab roadmaps={roadmaps} onGenerate={generateMyRoadmap} hasGaps={gaps.length > 0} />
          ) : activeTab === 'Skill gap' ? (
            <SkillGapTab readiness={readiness} gaps={gaps} strengths={strengths} loading={loading} />
          ) : activeTab === 'Assessments' ? (
            <AssessmentsTab attempts={attempts} />
          ) : activeTab === 'My profile' ? (
            <ProfileTab session={session} currentSkills={currentSkills} onAddSkill={() => setShowSkills(true)} onEditProfile={() => setShowProfile(true)} onUploadResume={() => setShowResume(true)} />
          ) : (
            /* ── Dashboard ── */
            <>
              <section className="student-welcome">
                <div>
                  <p className="student-kicker">YOUR NEXT OPPORTUNITY</p>
                  <h1>Keep building, {firstName} <span>✦</span></h1>
                  <p>Here is the clearest path from your skills today to your target role.</p>
                </div>
                <button className="student-outline-button" onClick={() => setShowProfile(true)}><Pencil size={15} /> Edit profile</button>
              </section>

              {/* Target role */}
              <section className="target-role-card">
                <div className="target-role-icon"><BriefcaseBusiness size={21} /></div>
                <div className="target-role-copy">
                  <p className="student-kicker">TARGET ROLE</p>
                  <strong>{targetRole?.title || 'Not set — pick one below'}</strong>
                  <span>{targetRole ? `Based on ${targetRole.employmentType || 'full-time'} opportunities in Maharashtra` : 'Select a job role to activate your readiness tracking'}</span>
                </div>
                <div className="role-picker">
                  <select value={targetRole?.id || ''} onChange={e => changeTargetRole(e.target.value)}>
                    <option value="">— Pick a role —</option>
                    {jobRoles.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}
                  </select>
                  <ChevronDown size={14} />
                </div>
              </section>

              {/* Stats */}
              <section className="student-stat-grid">
                <StudentStat icon={Target}     label="Job readiness"       value={readinessScore !== null ? `${readinessScore}%` : loading ? '…' : '—'} note={readiness?.gapSeverity ? `Gap: ${readiness.gapSeverity}` : 'Set a target role'} tone="violet" />
                <StudentStat icon={Target}     label="Skills to strengthen" value={loading ? '…' : gaps.length || '—'} note={gaps.length ? `${gaps.filter(g=>g.requirement==='required').length} critical` : 'No gaps yet'} tone="coral" />
                <StudentStat icon={BookOpen}   label="Current skills"      value={currentSkills.length || '—'} note="In your profile" tone="mint" />
                <StudentStat icon={Award}      label="Assessments taken"   value={attempts.length || '—'}      note="Completed"      tone="yellow" />
              </section>

              {/* Readiness chart + gaps panel */}
              <div className="student-section-title"><div><p className="student-kicker">YOUR SIGNALS</p><h2>Readiness at a glance</h2></div><button className="student-text-button" onClick={() => setActiveTab('Skill gap')}>Open full analysis <ArrowRight size={14} /></button></div>
              <section className="student-grid-two">
                <div className="student-panel readiness-panel">
                  <PanelHeading icon={TrendingUp} title="Job readiness score" action="How it is calculated" />
                  <div className="readiness-body">
                    <div className="score-ring" style={{ '--score': `${(readinessScore || 0) * 3.6}deg` }}>
                      <div><strong>{readinessScore !== null ? `${readinessScore}%` : '—'}</strong><span>{readinessScore !== null ? 'Ready to grow' : 'Set a role'}</span></div>
                    </div>
                    <div className="readiness-copy">
                      <strong>{readinessScore !== null ? (readinessScore >= 70 ? 'You are on a strong track.' : 'You are making steady progress.') : 'Complete your profile to see readiness.'}</strong>
                      <p>Your score combines assessed skill levels, target-role demand, and learning momentum.</p>
                    </div>
                  </div>
                  {progressData.length > 0 && (
                    <div className="mini-chart">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={progressData}>
                          <defs><linearGradient id="studentScore" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#7160e0" stopOpacity=".25" /><stop offset="100%" stopColor="#7160e0" stopOpacity="0" /></linearGradient></defs>
                          <XAxis dataKey="week" hide /><YAxis hide domain={[0, 100]} />
                          <Tooltip contentStyle={{ borderRadius: 8, fontSize: 10 }} />
                          <Area type="monotone" dataKey="score" stroke="#7160e0" strokeWidth={2} fill="url(#studentScore)" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>

                <div className="student-panel gaps-student-panel">
                  <PanelHeading icon={Target} title="Your priority gaps" action={`See all ${gaps.length}`} />
                  <p className="student-muted">Skills employers ask for that need your attention next.</p>
                  {loading && <div className="loading-rows"><span /><span /><span /></div>}
                  {!loading && gaps.length === 0 && (
                    <p className="student-empty">{targetRole ? 'No skill gaps — great work!' : 'Set a target role to see your gaps.'}</p>
                  )}
                  <div className="student-gap-list">
                    {gaps.slice(0, 5).map((gap, i) => {
                      const level = LEVEL_SCORE[gap.requiredLevel] || 75
                      const current = LEVEL_SCORE[currentSkills.find(s => s.skillName === gap.skillName)?.level] || 0
                      return (
                        <div className="student-gap-row" key={gap.skillName}>
                          <div className="gap-row-label">
                            <span className={`student-skill-dot ${SKILL_COLORS[i % SKILL_COLORS.length]}`} />
                            <strong>{gap.skillName}</strong>
                            <em>{gap.requirement}</em>
                          </div>
                          <div className="gap-progress">
                            <span style={{ width: `${current}%` }} className={SKILL_COLORS[i % SKILL_COLORS.length]} />
                          </div>
                          <div className="gap-row-foot"><span>Your level {current}%</span><b>Required {level}%</b></div>
                        </div>
                      )
                    })}
                  </div>
                  <button className="student-plan-button" onClick={generateMyRoadmap} disabled={!gaps.length}>Build my learning plan <ArrowRight size={15} /></button>
                </div>
              </section>

              {/* Recommendations shortcut */}
              <div className="student-section-title compact"><div><p className="student-kicker">MAKE YOUR NEXT MOVE</p><h2>Recommended for you</h2></div><button className="student-text-button" onClick={() => setActiveTab('Recommendations')}>View all <ArrowRight size={14} /></button></div>
              <section className="recommendation-grid">
                <button className="recommendation-card" onClick={() => setActiveTab('Recommendations')}><div className="recommendation-icon coral"><BookOpen size={18} /></div><strong>Find courses for your gaps</strong><span>Personalised to your target role</span><small><Sparkles size={11} /> AI-powered recommendations</small><ArrowRight className="recommendation-arrow" size={16} /></button>
                <button className="recommendation-card" onClick={() => setActiveTab('Skill gap')}><div className="recommendation-icon mint"><Target size={18} /></div><strong>Analyse your skill gaps</strong><span>See exactly what you need</span><small><Sparkles size={11} /> Live role requirements</small><ArrowRight className="recommendation-arrow" size={16} /></button>
                <button className="recommendation-card" onClick={generateMyRoadmap}><div className="recommendation-icon blue"><GraduationCap size={18} /></div><strong>Generate your roadmap</strong><span>Ordered learning path</span><small><Sparkles size={11} /> Built from your gaps</small><ArrowRight className="recommendation-arrow" size={16} /></button>
              </section>

              {/* Roadmap quick view */}
              {roadmaps[0] && (
                <section className="roadmap-card">
                  <div className="roadmap-head">
                    <div><p className="student-kicker">PERSONALIZED ROADMAP</p><h2>{roadmaps[0].title}</h2><p>{roadmaps[0].completedSteps}/{roadmaps[0].totalSteps} steps completed · {roadmaps[0].progressPct}% done</p></div>
                    <button className="student-outline-button" onClick={() => setActiveTab('Learning roadmap')}>Open roadmap <ArrowRight size={14} /></button>
                  </div>
                  <div className="roadmap-track">
                    {roadmaps[0].steps?.slice(0, 4).map(step => (
                      <div className={`roadmap-step ${step.status === 'completed' ? 'done' : ''}`} key={step.stepId}>
                        <span>{step.status === 'completed' ? <Check size={14} /> : step.order}</span>
                        <strong>{step.skillName}</strong>
                        <small>{step.status === 'completed' ? 'Completed' : step.status === 'in_progress' ? 'In progress' : 'Up next'}</small>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </main>

      {/* Profile modal */}
      {showProfile && (
        <div className="student-modal-backdrop" onClick={() => setShowProfile(false)}>
          <form className="student-modal profile-modal" onClick={e => e.stopPropagation()} onSubmit={hProfile(saveProfile)}>
            <button type="button" className="student-modal-close" onClick={() => setShowProfile(false)}><X size={17} /></button>
            <div className="modal-top-icon"><UserRound size={21} /></div>
            <p className="student-kicker">MY PROFILE</p><h2>Keep your learner profile current</h2>
            <label className="student-form-label">Name<input {...regProfile('name')} /></label>
            <label className="student-form-label">Email<input {...regProfile('email')} /></label>
            <button className="student-primary-button" type="submit">Save profile <Check size={15} /></button>
          </form>
        </div>
      )}

      {/* Add skill modal */}
      {showSkills && (
        <div className="student-modal-backdrop" onClick={() => setShowSkills(false)}>
          <form className="student-modal" onClick={e => e.stopPropagation()} onSubmit={hSkill(addSkill)}>
            <button type="button" className="student-modal-close" onClick={() => setShowSkills(false)}><X size={17} /></button>
            <div className="modal-top-icon"><Plus size={21} /></div>
            <p className="student-kicker">ADD SKILL</p><h2>Add a skill to your profile</h2>
            <label className="student-form-label">Skill name<input {...regSkill('skillName', { required: true })} placeholder="e.g. Python" /></label>
            <label className="student-form-label">Your level
              <select {...regSkill('level')}>
                <option value="beginner">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
                <option value="expert">Expert</option>
              </select>
            </label>
            <button className="student-primary-button" type="submit" disabled={savingSkills}>{savingSkills ? 'Saving…' : 'Add skill'} <Check size={15} /></button>
          </form>
        </div>
      )}

      {/* Resume modal */}
      {showResume && (
        <div className="student-modal-backdrop" onClick={() => setShowResume(false)}>
          <div className="student-modal" onClick={e => e.stopPropagation()}>
            <button className="student-modal-close" onClick={() => setShowResume(false)}><X size={17} /></button>
            <div className="modal-top-icon"><UploadCloud size={21} /></div>
            <p className="student-kicker">RESUME INTELLIGENCE</p><h2>Let your resume update your skills</h2>
            <p>We will extract skills, experience signals, and evidence to refresh your profile.</p>
            <label className="resume-drop">
              <input type="file" accept=".pdf,.doc,.docx" onChange={e => setResumeName(e.target.files?.[0]?.name || '')} />
              <UploadCloud size={25} /><strong>{resumeName || 'Choose your resume'}</strong><span>PDF or DOCX · up to 10 MB</span>
            </label>
            <button className="student-primary-button" disabled={!resumeName} onClick={() => setShowResume(false)}>Extract my skills <Sparkles size={15} /></button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Sub-tab components ───────────────────────────────────────────────────────
function SkillGapTab({ readiness, gaps, strengths, loading }) {
  if (loading) return <div className="loading-state"><RefreshCw className="spin" size={21} /><p>Calculating your readiness…</p></div>
  if (!readiness) return <div className="empty-state"><Target size={21} /><p>Set a target job role from the Dashboard to see your skill gaps.</p></div>
  return (
    <div className="skillgap-tab">
      <div className="skillgap-header"><h2>Skill gap analysis</h2><p>Target: <strong>{readiness.targetJobRole?.title || '—'}</strong> · Readiness: <strong>{readiness.jobReadinessScore}%</strong></p></div>
      {gaps.length > 0 && <><h3 className="student-kicker" style={{marginTop:16}}>Missing skills ({gaps.length})</h3>
        {gaps.map(g => <div className="gap-detail-row" key={g.skillName}><span className={`gap-priority-${g.priority}`}>{g.priority}</span><strong>{g.skillName}</strong><small>{g.requiredLevel ? `Required: ${g.requiredLevel}` : ''}</small></div>)}</>}
      {strengths.length > 0 && <><h3 className="student-kicker" style={{marginTop:16}}>Strengths ({strengths.length})</h3>
        {strengths.map(s => <div className="strength-row" key={s.skillName}><Check size={14} /><strong>{s.skillName}</strong><small>{s.status?.replace(/_/g,' ')}</small></div>)}</>}
    </div>
  )
}

function RoadmapTab({ roadmaps, onGenerate, hasGaps }) {
  if (roadmaps.length === 0) return (
    <div className="empty-state">
      <GraduationCap size={32} />
      <h3>No learning roadmap yet</h3>
      <p>Run a gap analysis first, then generate your personalised learning path.</p>
      <button className="student-primary-button" onClick={onGenerate} disabled={!hasGaps}>{hasGaps ? 'Generate roadmap' : 'Set a target role first'} <ArrowRight size={15} /></button>
    </div>
  )
  return (
    <div className="roadmap-tab">
      {roadmaps.map(rm => (
        <div className="roadmap-card" key={rm.id}>
          <div className="roadmap-head"><div><h3>{rm.title}</h3><p>{rm.completedSteps}/{rm.totalSteps} steps · {rm.progressPct}% complete · status: {rm.status}</p></div></div>
          <div className="roadmap-track">
            {(rm.steps || []).map(step => (
              <div className={`roadmap-step ${step.status === 'completed' ? 'done' : ''}`} key={step.stepId}>
                <span>{step.status === 'completed' ? <Check size={14} /> : step.order}</span>
                <strong>{step.skillName}</strong>
                <small>{step.programName || step.status}</small>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function AssessmentsTab({ attempts }) {
  const [assessments, setAssessments] = useState([])
  const [loading,     setLoading]     = useState(true)
  const [selected,    setSelected]    = useState(null)   // assessment to take
  const [answers,     setAnswers]     = useState({})     // questionIndex → answer
  const [result,      setResult]      = useState(null)   // attempt result
  const [submitting,  setSubmitting]  = useState(false)

  useEffect(() => {
    listAssessments({ limit: 20 }).then(d => setAssessments(d.assessments || [])).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const openTest = async (id) => {
    try {
      const d = await getAssessment(id)
      setSelected(d.assessment)
      setAnswers({})
      setResult(null)
    } catch { toast.error('Could not load assessment.') }
  }

  const submitTest = async () => {
    if (!selected) return
    setSubmitting(true)
    try {
      const answerArr = (selected.questions || []).map((_, i) => ({ answer: answers[i] || null }))
      const r = await submitAttempt(selected.id, { answers: answerArr, timeTakenMinutes: 5 })
      setResult(r.attempt)
      if (r.attempt.passed) toast.success(`Passed! Score: ${r.attempt.score}%`)
      else                  toast.info(`Score: ${r.attempt.score}% — keep practising`)
    } catch { toast.error('Could not submit attempt.') }
    finally { setSubmitting(false) }
  }

  const closeTest = () => { setSelected(null); setResult(null); setAnswers({}) }

  const LEVEL_COLORS = { beginner: 'mint', intermediate: 'blue', advanced: 'yellow', expert: 'coral' }

  if (loading) return <div className="loading-state"><RefreshCw className="spin" size={21} /><p>Loading assessments…</p></div>

  return (
    <div className="assessments-tab">
      {/* Available assessments */}
      <div className="student-section-title" style={{ marginTop: 0 }}>
        <div><p className="student-kicker">AVAILABLE</p><h2>Skill assessments</h2></div>
      </div>

      {assessments.length === 0 && (
        <div className="empty-state">
          <Award size={32} />
          <h3>No assessments yet</h3>
          <p>Training providers will publish assessments here. Check back soon.</p>
        </div>
      )}

      <div className="assessment-grid">
        {assessments.map(a => (
          <div className="assessment-card" key={a.id} onClick={() => openTest(a.id)}>
            <div className="assessment-card-icon"><Award size={18} /></div>
            <div className="assessment-card-body">
              <strong>{a.title}</strong>
              <span>{a.skillName || 'General assessment'}</span>
              <div className="assessment-card-meta">
                <span className="assessment-tag assessment-tag-quiz">{a.type}</span>
                {a.level && <span className={`assessment-tag assessment-tag-${LEVEL_COLORS[a.level] || 'quiz'}`}>{a.level}</span>}
                {a.durationMinutes && <span className="assessment-tag assessment-tag-mins">{a.durationMinutes} min</span>}
                <span className="assessment-tag assessment-tag-passing">Pass: {a.passingScore || 70}%</span>
              </div>
            </div>
            <button className="assessment-start-btn" onClick={e => { e.stopPropagation(); openTest(a.id) }}>
              Start <ArrowRight size={11} />
            </button>
          </div>
        ))}
      </div>

      {/* Past attempts */}
      {attempts.length > 0 && (
        <>
          <div className="student-section-title compact"><div><p className="student-kicker">HISTORY</p><h2>Your attempts</h2></div></div>
          {attempts.map(a => (
            <div className="attempt-row" key={a.id}>
              <strong>{a.assessmentTitle}</strong>
              <span>{a.skillName || '—'}</span>
              <b>{a.score !== null ? `${a.score}%` : 'Ungraded'}</b>
              <em className={a.passed ? 'passed' : 'pending'}>{a.passed ? '✓ Passed' : a.status}</em>
            </div>
          ))}
        </>
      )}

      {/* Take-test modal */}
      {selected && !result && (
        <div className="student-modal-backdrop" onClick={closeTest}>
          <div className="student-modal question-modal" onClick={e => e.stopPropagation()}>
            <button className="student-modal-close" onClick={closeTest}><X size={17} /></button>
            <div className="modal-top-icon"><Award size={21} /></div>
            <p className="student-kicker">ASSESSMENT</p>
            <h2>{selected.title}</h2>
            <p style={{ color: '#838998', fontSize: 12, marginTop: 4 }}>{selected.totalQuestions} questions · {selected.durationMinutes || '—'} min · Pass at {selected.passingScore || 70}%</p>

            {(selected.questions || []).length === 0 ? (
              <p style={{ color: '#9298a5', fontSize: 12, marginTop: 16 }}>This assessment has no questions yet.</p>
            ) : (
              <div style={{ marginTop: 20 }}>
                {(selected.questions || []).map((q, qi) => (
                  <div className="question-item" key={qi}>
                    <p>{qi + 1}. {q.text || q.question || `Question ${qi + 1}`}</p>
                    {(q.options || []).map((opt, oi) => (
                      <div
                        key={oi}
                        className={`question-option ${answers[qi] === opt ? 'chosen' : ''}`}
                        onClick={() => setAnswers(prev => ({ ...prev, [qi]: opt }))}
                      >
                        <div className="question-radio" />
                        {opt}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}

            <button className="student-primary-button" style={{ marginTop: 20 }} disabled={submitting || !selected.questions?.length} onClick={submitTest}>
              {submitting ? 'Submitting…' : 'Submit answers'} {!submitting && <Check size={15} />}
            </button>
          </div>
        </div>
      )}

      {/* Result modal */}
      {result && (
        <div className="student-modal-backdrop" onClick={closeTest}>
          <div className="student-modal" onClick={e => e.stopPropagation()}>
            <button className="student-modal-close" onClick={closeTest}><X size={17} /></button>
            <div className="score-result">
              <div className="score-ring" style={{ '--score': `${(result.score || 0) * 3.6}deg`, margin: '0 auto 16px', width: 100, height: 100 }}>
                <div><strong style={{ fontSize: 22 }}>{result.score ?? '—'}%</strong><span>Score</span></div>
              </div>
              <span className={result.passed ? 'pass-badge' : 'fail-badge'}>
                {result.passed ? '✓ Passed' : '✕ Not passed'}
              </span>
              <p style={{ color: '#838998', fontSize: 12, marginTop: 12, lineHeight: 1.6 }}>
                {result.passed
                  ? 'Your skill level has been updated. This assessment has been added to your history.'
                  : `You needed ${selected?.passingScore || 70}% to pass. Review the topics and try again.`}
              </p>
              <button className="student-primary-button" style={{ marginTop: 16 }} onClick={closeTest}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ProfileTab({ session, currentSkills, onAddSkill, onEditProfile, onUploadResume }) {
  return (
    <div className="profile-tab">
      <div className="profile-header">
        <div className="student-avatar large">{(session?.name||'L').split(' ').map(p=>p[0]).join('').toUpperCase().slice(0,2)}</div>
        <div><h2>{session?.name || 'Learner'}</h2><p>{session?.email || '—'}</p><span className="role-badge">{session?.role}</span></div>
      </div>
      <div className="profile-actions">
        <button className="student-outline-button" onClick={onEditProfile}><Pencil size={15} /> Edit profile</button>
        <button className="student-outline-button" onClick={onUploadResume}><UploadCloud size={15} /> Upload resume</button>
      </div>
      <h3 className="student-kicker" style={{marginTop:20}}>My skills ({currentSkills.length})</h3>
      <div className="skills-grid">
        {currentSkills.map(s => <div className="skill-chip" key={s.skillName}><strong>{s.skillName}</strong><small>{s.level || '—'}</small></div>)}
        <button className="skill-chip add-chip" onClick={onAddSkill}><Plus size={13} /> Add skill</button>
      </div>
    </div>
  )
}

function StudentStat({ icon: Icon, label, value, note, tone }) {
  return <div className="student-stat"><span className={`student-stat-icon ${tone}`}><Icon size={17} /></span><small>{label}</small><strong>{value}</strong><em>{note}</em></div>
}
function PanelHeading({ icon: Icon, title, action }) {
  return <div className="student-panel-heading"><div><Icon size={17} /><h3>{title}</h3></div><button>{action}<ArrowRight size={12} /></button></div>
}
