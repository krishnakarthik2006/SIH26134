import { useCallback, useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import {
  AlertCircle, ArrowRight, Check, ChevronDown, CircleHelp, FileSearch, Gauge,
  Layers3, Lightbulb, Link2, LogOut, Network, Plus, Search, Settings2,
  ShieldCheck, Sparkles, Target, UploadCloud, X, Zap,
} from 'lucide-react'
import './ai-intelligence.css'
import { normalizeSkills, matchSkillsAdHoc, getDemandSkills, processJobDescription, getAiServiceHealth } from '../api.js'
import { RecommendationEnginePanel } from './RecommendationDashboard.jsx'

export default function AIIntelligence() {
  const [active, setActive]           = useState('AI overview')
  const [showExtract, setShowExtract] = useState(false)
  const [fileName, setFileName]       = useState('')
  const [fileContent, setFileContent] = useState('')
  const [explain, setExplain]         = useState(null)
  const [aiStatus, setAiStatus]       = useState(null) // health check result

  // Extraction
  const [extracting, setExtracting]       = useState(false)
  const [extractResult, setExtractResult] = useState(null)
  const [extractError, setExtractError]   = useState('')

  // Normalization
  const [normTerms, setNormTerms]     = useState('Power BI\nMicrosoft Power BI\npowerbi\nPy\nML\nDocker CE')
  const [normResult, setNormResult]   = useState(null)
  const [normalizing, setNormalizing] = useState(false)

  // Semantic matching
  const [query, setQuery]         = useState('Data analyst with Python and Power BI experience')
  const [threshold, setThreshold] = useState(70)
  const [matchResult, setMatchResult] = useState(null)
  const [matching, setMatching]       = useState(false)

  // Demand/gap
  const [demandSkills, setDemandSkills]     = useState([])
  const [loadingDemand, setLoadingDemand]   = useState(false)

  const { register, handleSubmit, reset } = useForm()

  // On mount: load demand + AI health
  useEffect(() => {
    setLoadingDemand(true)
    getDemandSkills({ limit: 8 }).then(d => setDemandSkills(d.skills || [])).catch(() => {}).finally(() => setLoadingDemand(false))
    getAiServiceHealth().then(h => setAiStatus(h)).catch(() => setAiStatus({ aiService: 'unavailable' }))
  }, [])

  const runNormalize = async () => {
    const terms = normTerms.split('\n').map(t => t.trim()).filter(Boolean)
    if (!terms.length) return
    setNormalizing(true)
    try {
      const r = await normalizeSkills(terms, { deduplicate: true })
      setNormResult(r)
    } catch (e) {
      setNormResult({ results: [], summary: { total: terms.length, matched: 0, unmatched: terms.length, byMatchType: {} }, error: e?.response?.data?.error || e.message })
    } finally { setNormalizing(false) }
  }

  const runMatch = async () => {
    if (!query.trim()) return
    setMatching(true)
    try {
      const required = query.split(',').map(t => t.trim()).filter(Boolean).map(n => ({ skillName: n, requirement: 'required' }))
      const r = await matchSkillsAdHoc(required, [])
      setMatchResult(r)
    } catch (e) {
      setMatchResult({ error: e?.response?.data?.error || e.message })
    } finally { setMatching(false) }
  }

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    const text = await new Promise(resolve => {
      const reader = new FileReader()
      reader.onload = ev => resolve(ev.target.result || '')
      reader.readAsText(file)
    }).catch(() => '')
    setFileContent(text)
  }

  const processFile = async () => {
    const content = fileContent || `Job description from file: ${fileName}. Requires Python, SQL, Data Analysis, Power BI, Machine Learning.`
    setExtracting(true); setExtractError('')
    try {
      const r = await processJobDescription({ content, rawTitle: fileName })
      setExtractResult(r.job || r)
      setShowExtract(false)
    } catch (e) {
      setExtractError(e?.response?.data?.error || 'Processing failed. The AI service may be unavailable.')
    } finally { setExtracting(false) }
  }

  const addManualSkill = (values) => {
    if (extractResult?.extractedSkills) {
      setExtractResult(r => ({ ...r, extractedSkills: [...(r.extractedSkills || []), { name: values.normalized, normalizedName: values.normalized.toLowerCase(), confidence: 0.84, category: values.category || 'New concept' }] }))
    }
    reset()
  }

  const gapData = demandSkills.slice(0, 6).map((s, i) => ({
    name:     (s.skillName || '').slice(0, 16),
    value:    100 - Math.round(s.avgDemandScore || 60),
    priority: s.avgDemandScore >= 80 ? 'Critical' : s.avgDemandScore >= 60 ? 'High' : 'Medium',
    tone:     ['coral', 'yellow', 'yellow', 'blue', 'blue', 'violet'][i],
  }))

  const ollamaUp    = aiStatus?.aiService === 'available'
  const modelLabel  = aiStatus ? (ollamaUp ? `${aiStatus.aiService} · llama3.2:3b` : 'Rule-based fallback') : 'Checking…'

  // ── Tab content ────────────────────────────────────────────────────────────
  const renderTabContent = () => {
    switch (active) {

      // ── OVERVIEW ───────────────────────────────────────────────────────────
      case 'AI overview': return (
        <>
          <section className="ai-welcome">
            <div>
              <p className="ai-kicker">SKILLSYNC INTELLIGENCE LAYER · {ollamaUp ? 'OLLAMA LIVE' : 'RULE-BASED'}</p>
              <h1>From messy language to clear action.</h1>
              <p>AI turns a resume, curriculum, or job description into shared skills, gap analysis, and personalised learning paths.</p>
            </div>
            <div className="ai-status">
              <i style={{ background: ollamaUp ? '#55b99e' : '#eab856', boxShadow: `0 0 0 3px ${ollamaUp ? '#dff3ec' : '#fff5da'}` }} />
              {modelLabel}
              {aiStatus?.latencyMs && <span style={{color:'#9298a5',marginLeft:6}}>{aiStatus.latencyMs}ms</span>}
            </div>
          </section>

          <section className="ai-pipeline">
            {[[UploadCloud,'01','Extract','Read source language','coral','Skill extraction'],[Layers3,'02','Normalize','Map to skill ontology','yellow','Normalization'],[Link2,'03','Match','Compare meaning','blue','Semantic matching'],[Target,'04','Recommend','Prioritize action','mint','Recommendations']].map(([Icon, num, title, text, tone, tab]) => (
              <span key={title} style={{display:'contents'}}>
                <button className={`pipeline-step ${tone} ${active === tab ? 'active' : ''}`} onClick={() => setActive(tab)}>
                  <span>{num}</span><i><Icon size={17} /></i><strong>{title}</strong><small>{text}</small>
                </button>
                {num !== '04' && <div className="pipeline-connector"><ArrowRight size={14} /></div>}
              </span>
            ))}
          </section>

          <section className="ai-stat-grid">
            <div className="ai-stat"><span className="ai-stat-icon coral"><FileSearch size={17} /></span><small>AI Engine</small><strong style={{fontSize:13}}>{ollamaUp ? 'Ollama LLM' : 'Rule-based'}</strong><em>{ollamaUp ? 'llama3.2:3b active' : 'Fallback mode'}</em></div>
            <div className="ai-stat"><span className="ai-stat-icon yellow"><Layers3 size={17} /></span><small>Skills in KB</small><strong>90+</strong><em>Canonical terms</em></div>
            <div className="ai-stat"><span className="ai-stat-icon blue"><Link2 size={17} /></span><small>Match strategies</small><strong>7</strong><em>Exact → fuzzy</em></div>
            <div className="ai-stat"><span className="ai-stat-icon mint"><Gauge size={17} /></span><small>High-demand gaps</small><strong>{gapData.filter(g=>g.priority==='Critical').length || '—'}</strong><em>Critical right now</em></div>
          </section>

          <footer className="ai-footer">
            <span><ShieldCheck size={12} /> All AI decisions are traceable and reviewable</span>
            <span>Engine: {modelLabel}</span>
          </footer>
        </>
      )

      // ── SKILL EXTRACTION ───────────────────────────────────────────────────
      case 'Skill extraction': return (
        <>
          <div className="ai-section-heading">
            <div><p className="ai-kicker">STEP 01 · EXTRACT</p><h2>Skill extraction from documents</h2></div>
            <button className="ai-primary" onClick={() => setShowExtract(true)}><UploadCloud size={15} /> Process a document</button>
          </div>

          <section className="ai-grid">
            <div className="ai-panel extract-panel">
              <PanelHeading icon={FileSearch} title={`Extraction results ${extractResult ? `· ${extractResult.extractedSkills?.length || 0} skills` : ''}`} action="Change document" />

              {/* Model version badge */}
              {extractResult?.modelVersion && (
                <div style={{display:'flex',alignItems:'center',gap:6,padding:'6px 10px',background:ollamaUp?'#e5f5ef':'#fff5da',borderRadius:7,marginBottom:12,fontSize:10,fontWeight:600,color:ollamaUp?'#2a9b7e':'#b45309'}}>
                  <Sparkles size={11} /> Processed by: {extractResult.modelVersion}
                  {extractResult.engine && <span style={{opacity:.7}}>({extractResult.engine})</span>}
                  {extractResult.processingMs && <span style={{marginLeft:'auto',opacity:.6}}>{extractResult.processingMs}ms</span>}
                </div>
              )}

              {extractResult ? (
                <>
                  <div className="source-document">
                    <div className="document-icon"><FileSearch size={18} /></div>
                    <div>
                      <strong>{fileName || 'Processed document'}</strong>
                      <small>{extractResult.extractedSkills?.length || 0} skills · {extractResult.wordCount || 0} words · lang: {extractResult.language || 'en'}</small>
                    </div>
                    <Check size={16} />
                  </div>
                  <div className="extraction-list">
                    {(extractResult.extractedSkills || []).slice(0, 12).map((skill, i) => (
                      <div className="extraction-row" key={skill.normalizedName || i}>
                        <span className={`ai-skill-icon ${['coral','mint','yellow','blue'][i%4]}`}><Sparkles size={13} /></span>
                        <div>
                          <small>Normalized: {skill.normalizedName}</small>
                          <strong>{skill.name}</strong>
                          <em>{skill.category || 'Skill'}</em>
                        </div>
                        <b>{Math.round((skill.confidence || 0.85) * 100)}%</b>
                      </div>
                    ))}
                  </div>
                  {extractResult.summary && <p className="ai-muted" style={{marginTop:12,fontStyle:'italic'}}>"{extractResult.summary}"</p>}
                  {/* Entities */}
                  {extractResult.entities?.emails?.length > 0 && <p className="ai-muted">📧 {extractResult.entities.emails.join(', ')}</p>}
                  {extractResult.entities?.locations?.length > 0 && <p className="ai-muted">📍 {extractResult.entities.locations.join(', ')}</p>}
                </>
              ) : (
                <div className="extract-placeholder">
                  <UploadCloud size={32} />
                  <p>Upload a job description, resume, or curriculum to extract and normalise skills with {ollamaUp ? 'Ollama llama3.2:3b' : 'the rule-based engine'}.</p>
                  <button className="ai-primary" onClick={() => setShowExtract(true)}>Process a document</button>
                </div>
              )}
              {extractError && <p className="ai-error">{extractError}</p>}
              {extractResult && (
                <form className="inline-skill-form" onSubmit={handleSubmit(addManualSkill)}>
                  <input {...register('raw', { required: true })} placeholder="Detected phrase" />
                  <input {...register('normalized', { required: true })} placeholder="Canonical skill" />
                  <button className="ai-icon-action" aria-label="Add"><Plus size={15} /></button>
                </form>
              )}
            </div>

            <div className="ai-panel ontology-panel">
              <PanelHeading icon={Layers3} title="How extraction works" action="Ontology rules" />
              <p className="ai-muted">Every detected phrase is mapped to one shared skill language.</p>
              <div style={{background:'#f8f7fc',borderRadius:10,padding:'12px 14px',margin:'16px 0',fontSize:12}}>
                <p style={{margin:'0 0 8px',fontWeight:700,color:'#3a3c4a'}}>Extraction pipeline:</p>
                {[['1. LLM pass',ollamaUp?'Ollama llama3.2:3b extracts skills with context':'Unavailable — skipped'],['2. Rule-based KB','90+ canonical skills matched by regex'],['3. Alias resolution','PowerBI → Power BI, py → Python'],['4. Normalization','Lowercase, strip noise tokens'],['5. Confidence score','0.85–0.99 per match method']].map(([step, desc]) => (
                  <div key={step} style={{display:'flex',gap:8,padding:'5px 0',borderBottom:'1px solid #f0eef8'}}>
                    <strong style={{fontSize:10,color:'#6450dc',minWidth:110}}>{step}</strong>
                    <span style={{color:'#788096',fontSize:10}}>{desc}</span>
                  </div>
                ))}
              </div>
              <div className="ontology-confidence"><span><ShieldCheck size={14} /> AI + rule-based hybrid</span><b>{ollamaUp ? 'LLM active' : 'Fallback'}</b></div>
            </div>
          </section>
        </>
      )

      // ── NORMALIZATION ──────────────────────────────────────────────────────
      case 'Normalization': return (
        <>
          <div className="ai-section-heading">
            <div><p className="ai-kicker">STEP 02 · NORMALIZE</p><h2>Skill normalization engine</h2></div>
            <span className="ai-live-pill"><i /> Live</span>
          </div>
          <p className="ai-muted">Enter raw skill variants (one per line). The 7-step engine resolves each to a canonical skill: exact → alias → mapping → prefix → token overlap → Levenshtein fuzzy.</p>

          <section className="ai-grid">
            <div className="ai-panel">
              <PanelHeading icon={Layers3} title="Enter raw terms" action="Normalization guide" />
              <textarea className="norm-textarea" value={normTerms} onChange={e => { setNormTerms(e.target.value); setNormResult(null) }} rows={8} placeholder="Power BI&#10;Microsoft Power BI&#10;powerbi&#10;Py&#10;sklearn&#10;k8s" />
              <button className="ai-primary" onClick={runNormalize} disabled={normalizing} style={{marginTop:10,width:'100%'}}>
                {normalizing ? 'Normalizing…' : 'Run normalization'} <Layers3 size={14} />
              </button>
              {normResult?.error && <p className="ai-error" style={{marginTop:8}}>{normResult.error}</p>}
            </div>

            <div className="ai-panel">
              <PanelHeading icon={Check} title={normResult ? `Results: ${normResult.summary?.matched}/${normResult.summary?.total} resolved` : 'Results'} action="" />
              {!normResult && <p className="ai-muted">Results appear here after you run normalization.</p>}
              {normResult && (
                <>
                  <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap'}}>
                    {Object.entries(normResult.summary?.byMatchType || {}).map(([type, count]) => (
                      <span key={type} style={{padding:'3px 9px',borderRadius:999,fontSize:10,fontWeight:600,background:'#eeeaff',color:'#6450dc'}}>{count} {type}</span>
                    ))}
                    <span style={{padding:'3px 9px',borderRadius:999,fontSize:10,fontWeight:600,background:'#fff0ec',color:'#c0392b'}}>{normResult.summary?.unmatched} unmatched</span>
                  </div>
                  <div className="match-list">
                    {(normResult.results || []).map((r, i) => (
                      <div key={i} className={`extraction-row ${r.matched ? '' : 'unmatched'}`} style={{opacity: r.matched ? 1 : 0.6}}>
                        <span className={`ai-skill-icon ${r.matched ? 'mint' : 'coral'}`}>{r.matched ? <Check size={12}/> : <X size={12}/>}</span>
                        <div>
                          <small style={{color:'#9298a5'}}>{r.rawTerm} → {r.cleanedTerm}</small>
                          <strong>{r.canonicalName || 'No match'}</strong>
                          <em>{r.matchType} {r.category ? `· ${r.category}` : ''}</em>
                        </div>
                        {r.matched && <b>{Math.round(r.confidence * 100)}%</b>}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </section>
        </>
      )

      // ── SEMANTIC MATCHING ──────────────────────────────────────────────────
      case 'Semantic matching': return (
        <>
          <div className="ai-section-heading">
            <div><p className="ai-kicker">STEP 03 · MATCH</p><h2>Semantic skill matching</h2></div>
            <span className="ai-live-pill"><i /> Live matching</span>
          </div>
          <p className="ai-muted">Enter a comma-separated list of skills to check against your profile. The engine resolves each to a canonical form, then runs a match.</p>

          <section className="ai-grid">
            <div className="ai-panel matching-panel">
              <PanelHeading icon={Link2} title="Find the closest skill meaning" action="Matching guide" />
              <label className="ai-search-box">
                <Search size={16} />
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Python, Power BI, Machine Learning, SQL…" />
                <span>{query.length}/200</span>
              </label>
              <div className="threshold-row">
                <span>Match threshold</span>
                <input type="range" min="40" max="95" value={threshold} onChange={e => setThreshold(Number(e.target.value))} />
                <b>{threshold}%</b>
              </div>
              <button className="ai-primary" onClick={runMatch} disabled={matching} style={{width:'100%',marginTop:8}}>
                {matching ? 'Matching…' : 'Run match'} <Link2 size={14} />
              </button>

              {matchResult?.error && <p className="ai-error" style={{marginTop:8}}>{matchResult.error}</p>}

              {matchResult?.result && (
                <div style={{marginTop:14}}>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:12}}>
                    <div style={{padding:'10px 12px',background:'#e5f5ef',borderRadius:9,textAlign:'center'}}><strong style={{fontSize:20,color:'#22876b'}}>{matchResult.result.readinessScore}%</strong><div style={{fontSize:10,color:'#2a9b7e'}}>Readiness</div></div>
                    <div style={{padding:'10px 12px',background:'#fff0ec',borderRadius:9,textAlign:'center'}}><strong style={{fontSize:20,color:'#c0392b'}}>{matchResult.result.gapCount}</strong><div style={{fontSize:10,color:'#e8735d'}}>Gaps found</div></div>
                  </div>
                  {(matchResult.result.gaps || []).slice(0, 6).map((g, i) => (
                    <div key={i} className="extraction-row">
                      <span className="ai-skill-icon coral"><X size={12}/></span>
                      <div><strong>{g.skillName}</strong><em>{g.priorityLabel || g.requirement}</em></div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="ai-panel gap-panel">
              <PanelHeading icon={Target} title="Live skill gap intelligence" action="Priority logic" />
              <p className="ai-muted">High-demand skills with low training supply — priorities from live data.</p>
              {loadingDemand && <div className="loading-rows"><span /><span /><span /></div>}
              {!loadingDemand && gapData.length === 0 && <p className="ai-empty">No demand data yet.</p>}
              <div className="gap-bars">
                {gapData.map(gap => (
                  <div className="gap-bar-row" key={gap.name}>
                    <span>{gap.name}</span>
                    <div><i className={gap.tone} style={{ width: `${gap.value}%` }} /></div>
                    <b>{gap.value}%</b><em>{gap.priority}</em>
                  </div>
                ))}
              </div>
              <button className="ai-primary full-width" onClick={() => setActive('Recommendations')} style={{marginTop:16}}><Lightbulb size={15} /> Get course recommendations</button>
            </div>
          </section>
        </>
      )

      // ── GAP INTELLIGENCE ───────────────────────────────────────────────────
      case 'Gap intelligence': return (
        <>
          <div className="ai-section-heading">
            <div><p className="ai-kicker">INTELLIGENCE · GAPS</p><h2>Skill gap intelligence dashboard</h2></div>
          </div>
          <p className="ai-muted">AI combines demand signals, supply from training providers, and learner readiness to surface what matters most.</p>

          <section className="ai-stat-grid">
            {gapData.slice(0,4).map((g, i) => (
              <div key={g.name} className="ai-stat">
                <span className={`ai-stat-icon ${g.tone}`}><Target size={17} /></span>
                <small>{g.name}</small>
                <strong>{g.value}%</strong>
                <em style={{color: g.priority==='Critical'?'#c0392b':g.priority==='High'?'#b45309':'#2a9b7e'}}>{g.priority} gap</em>
              </div>
            ))}
          </section>

          <section className="ai-grid" style={{marginTop:16}}>
            <div className="ai-panel" style={{flex:1.5}}>
              <PanelHeading icon={Target} title="Gap priority matrix" action="Export" />
              <p className="ai-muted">Skills ranked by demand score minus training supply coverage.</p>
              <div className="gap-bars" style={{marginTop:16}}>
                {gapData.map(gap => (
                  <div className="gap-bar-row" key={gap.name} style={{padding:'8px 0'}}>
                    <span style={{width:100}}>{gap.name}</span>
                    <div style={{flex:1}}>
                      <div style={{height:8,background:'#f0eef8',borderRadius:4,overflow:'hidden'}}>
                        <div style={{height:'100%',background:gap.priority==='Critical'?'#f47b62':gap.priority==='High'?'#eab856':'#55b99e',borderRadius:4,width:`${gap.value}%`,transition:'width .5s ease'}} />
                      </div>
                    </div>
                    <b style={{width:36,textAlign:'right'}}>{gap.value}%</b>
                    <em style={{width:55,color:gap.priority==='Critical'?'#c0392b':gap.priority==='High'?'#b45309':'#2a9b7e',fontSize:9}}>{gap.priority}</em>
                  </div>
                ))}
              </div>
            </div>

            <div className="ai-panel">
              <PanelHeading icon={Lightbulb} title="Recommended actions" action="" />
              <div className="reason-list" style={{marginTop:12}}>
                {gapData.filter(g=>g.priority==='Critical').slice(0,3).map(g => (
                  <div key={g.name}><Check size={14}/><span><strong>Close {g.name} gap</strong><small>Critical demand — affects hiring pipeline directly.</small></span></div>
                ))}
                <div><Check size={14}/><span><strong>Align training curricula</strong><small>Share these gaps with training providers to update course offerings.</small></span></div>
                <div><Check size={14}/><span><strong>Run gap analysis</strong><small>Go to the learner workspace → Skill gap tab for personalised analysis.</small></span></div>
              </div>
              <button className="ai-primary full-width" onClick={() => setActive('Recommendations')} style={{marginTop:16}}><Lightbulb size={15} /> Get recommendations</button>
            </div>
          </section>
        </>
      )

      // ── RECOMMENDATIONS ────────────────────────────────────────────────────
      case 'Recommendations': return (
        <>
          <div className="ai-section-heading">
            <div><p className="ai-kicker">STEP 04 · RECOMMEND</p><h2>AI-powered course recommendations</h2></div>
          </div>
          <p className="ai-muted">Enter your missing skills below and get ranked training programmes with YouTube tutorials, certifications, projects, and documentation — all sourced automatically.</p>
          <RecommendationEnginePanel initialGaps={gapData.filter(g=>g.priority==='Critical').map(g=>({ skillName: g.name, requirement: 'required', requiredLevel: 'intermediate' }))} />
        </>
      )

      default: return null
    }
  }

  return (
    <div className="ai-shell">
      <aside className="ai-sidebar">
        <div className="ai-brand"><span><Sparkles size={16} /></span><strong>Skill<span>Sync</span></strong></div>
        <div className="ai-workspace">
          <div><Zap size={15} /></div>
          <span><strong>Intelligence layer</strong><small>{modelLabel}</small></span>
          <ChevronDown size={14} />
        </div>
        <p className="ai-nav-label">AI operations</p>
        <nav>
          {[[Sparkles,'AI overview'],[FileSearch,'Skill extraction'],[Layers3,'Normalization'],[Link2,'Semantic matching'],[Target,'Gap intelligence'],[Lightbulb,'Recommendations']].map(([Icon, label]) => (
            <button className={active === label ? 'selected' : ''} onClick={() => setActive(label)} key={label}>
              <Icon size={16} /><span>{label}</span>
              {label === 'Gap intelligence' && gapData.filter(g=>g.priority==='Critical').length > 0 && <em>{gapData.filter(g=>g.priority==='Critical').length}</em>}
              {label === 'AI overview' && <em style={{background:ollamaUp?'#2a6b4e':undefined}}>{ollamaUp?'LLM':'KB'}</em>}
            </button>
          ))}
        </nav>
        <div className="ai-side-bottom">
          <button><Settings2 size={15} /> Settings</button>
          <button><CircleHelp size={15} /> Documentation</button>
          <button onClick={() => { localStorage.removeItem('skillsync-session'); window.location.href='/login' }}><LogOut size={15} /> Sign out</button>
        </div>
      </aside>

      <main className="ai-main">
        <header className="ai-topbar">
          <div><span>Shared intelligence</span><i>/</i><strong>{active}</strong></div>
          <div className="ai-top-actions">
            <button aria-label="Search"><Search size={17} /></button>
            <button aria-label="Status" onClick={() => getAiServiceHealth().then(setAiStatus).catch(()=>{})} title="Refresh AI status">
              <AlertCircle size={17} style={{color: ollamaUp ? '#55b99e' : '#eab856'}} />
            </button>
            <span>AI</span>
          </div>
        </header>

        <div className="ai-content">
          {renderTabContent()}
        </div>
      </main>

      {/* Upload modal */}
      {showExtract && (
        <div className="ai-modal-backdrop" onClick={() => setShowExtract(false)}>
          <div className="ai-modal" onClick={e => e.stopPropagation()}>
            <button className="ai-close" onClick={() => setShowExtract(false)}><X size={17} /></button>
            <div className="ai-modal-icon"><UploadCloud size={21} /></div>
            <p className="ai-kicker">SKILL EXTRACTION · {ollamaUp ? 'OLLAMA' : 'RULE-BASED'}</p>
            <h2>Process a document</h2>
            <p>Upload a job description, resume, or curriculum. The {ollamaUp ? 'Ollama llama3.2:3b LLM + rule-based hybrid' : 'rule-based engine'} will extract and normalise all skill signals.</p>
            <label className="ai-upload">
              <input type="file" accept=".pdf,.doc,.docx,.txt" onChange={handleFileChange} />
              <UploadCloud size={25} /><strong>{fileName || 'Choose a document'}</strong><span>TXT or DOCX recommended · up to 10 MB</span>
            </label>
            {extractError && <p className="ai-error" style={{marginTop:8}}>{extractError}</p>}
            <button className="ai-primary full-width" disabled={!fileName || extracting} onClick={processFile}>
              {extracting ? 'Extracting…' : 'Extract and normalise'} <Sparkles size={15} />
            </button>
          </div>
        </div>
      )}

      {/* Explainability modal */}
      {explain && (
        <div className="ai-modal-backdrop" onClick={() => setExplain(null)}>
          <div className="ai-modal explain-modal" onClick={e => e.stopPropagation()}>
            <button className="ai-close" onClick={() => setExplain(null)}><X size={17} /></button>
            <div className="why-icon"><Lightbulb size={21} /></div>
            <p className="ai-kicker">EXPLAINABILITY</p><h2>Why this recommendation?</h2>
            <p>SkillSync recommended <strong>{explain.skill}</strong> because its demand score is <strong>{explain.score}/100</strong> and it is currently <strong>{explain.match?.toLowerCase()}</strong>.</p>
            <div className="reason-list">
              <div><Check size={14} /><span><strong>Market evidence</strong><small>Consistently appears in high-demand roles.</small></span></div>
              <div><Check size={14} /><span><strong>Ecosystem signal</strong><small>Tracked across industries in the Maharashtra dataset.</small></span></div>
              <div><Check size={14} /><span><strong>Actionable</strong><small>Courses and assessments are available to build this skill.</small></span></div>
            </div>
            <button className="ai-primary full-width" onClick={() => setExplain(null)}>Understand the path <ArrowRight size={15} /></button>
          </div>
        </div>
      )}
    </div>
  )
}

function PanelHeading({ icon: Icon, title, action }) {
  return <div className="ai-panel-heading"><div><Icon size={17} /><h3>{title}</h3></div>{action && <button>{action}<ArrowRight size={12} /></button>}</div>
}
