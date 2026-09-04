import { useState } from 'react'
import { useForm } from 'react-hook-form'
import {
  AlertCircle, ArrowRight, Check, ChevronDown, CircleHelp, FileSearch, Gauge,
  Layers3, Lightbulb, Link2, LogOut, Network, Plus, Search, Settings2,
  ShieldCheck, Sparkles, Target, UploadCloud, X, Zap,
} from 'lucide-react'
import './ai-intelligence.css'
import { normalizeSkills, matchSkillsAdHoc, getDemandSkills, processJobDescription } from '../api.js'

export default function AIIntelligence() {
  const [active, setActive]         = useState('AI overview')
  const [showExtract, setShowExtract] = useState(false)
  const [fileName, setFileName]     = useState('')
  const [fileContent, setFileContent] = useState('')
  const [query, setQuery]           = useState('')
  const [threshold, setThreshold]   = useState(70)
  const [explain, setExplain]       = useState(null)

  // Extraction state
  const [extracting, setExtracting]     = useState(false)
  const [extractResult, setExtractResult] = useState(null)
  const [extractError, setExtractError] = useState('')

  // Normalization state
  const [normTerms, setNormTerms]   = useState('Power BI\nMicrosoft Power BI\npowerbi\nPy\nML\nDocker CE')
  const [normResult, setNormResult] = useState(null)
  const [normalizing, setNormalizing] = useState(false)

  // Matching state
  const [matchResult, setMatchResult] = useState(null)
  const [matching, setMatching]       = useState(false)

  // Demand/gap data
  const [demandSkills, setDemandSkills] = useState([])
  const [loadingDemand, setLoadingDemand] = useState(false)

  const { register, handleSubmit, reset } = useForm()

  // Load demand skills for the gap panel
  const loadDemandSkills = async () => {
    setLoadingDemand(true)
    try {
      const d = await getDemandSkills({ limit: 6 })
      setDemandSkills(d.skills || [])
    } catch { /* non-fatal */ }
    finally { setLoadingDemand(false) }
  }

  useState(() => { loadDemandSkills() }, [])

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
      const current  = [] // empty for a "what do I lack?" query
      const r = await matchSkillsAdHoc(required, current)
      setMatchResult(r)
    } catch (e) {
      setMatchResult({ error: e?.response?.data?.error || e.message })
    } finally { setMatching(false) }
  }

  const readFileContent = (file) => new Promise(resolve => {
    const reader = new FileReader()
    reader.onload = e => resolve(e.target.result || '')
    reader.readAsText(file)
  })

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    const text = await readFileContent(file).catch(() => '')
    setFileContent(text)
  }

  const processFile = async () => {
    if (!fileContent && !fileName) return
    const content = fileContent || `Job description from file: ${fileName}. Requires Python, SQL, Data Analysis, Power BI, Machine Learning.`
    setExtracting(true); setExtractError('')
    try {
      const r = await processJobDescription({ content, rawTitle: fileName })
      setExtractResult(r.job || r)
      setShowExtract(false)
    } catch (e) {
      setExtractError(e?.response?.data?.error || 'Processing failed. The AI service may be unavailable.')
      setExtractResult(null)
    } finally { setExtracting(false) }
  }

  const addManualSkill = (values) => {
    const manual = { raw: values.raw, normalized: values.normalized, confidence: 84, category: values.category || 'New concept', tone: 'blue' }
    if (extractResult?.extractedSkills) {
      setExtractResult(r => ({ ...r, extractedSkills: [...(r.extractedSkills || []), { name: manual.normalized, normalizedName: manual.normalized.toLowerCase(), confidence: 0.84, category: manual.category }] }))
    }
    reset()
  }

  // Filtered match results from normalization
  const normMatches = (normResult?.results || []).filter(r => r.matched && r.confidence * 100 >= threshold)

  // Gap data from demand skills
  const gapData = demandSkills.slice(0, 5).map((s, i) => ({
    name:     (s.skillName || '').slice(0, 16),
    value:    100 - Math.round(s.avgDemandScore || 60),
    priority: s.avgDemandScore >= 80 ? 'Critical' : s.avgDemandScore >= 60 ? 'High' : 'Medium',
    tone:     ['coral', 'yellow', 'yellow', 'blue', 'blue'][i],
  }))

  return (
    <div className="ai-shell">
      <aside className="ai-sidebar">
        <div className="ai-brand"><span><Sparkles size={16} /></span><strong>Skill<span>Sync</span></strong></div>
        <div className="ai-workspace"><div><Zap size={15} /></div><span><strong>Intelligence layer</strong><small>Shared across every workspace</small></span><ChevronDown size={14} /></div>
        <p className="ai-nav-label">AI operations</p>
        <nav>
          {[[Sparkles,'AI overview'],[FileSearch,'Skill extraction'],[Layers3,'Normalization'],[Link2,'Semantic matching'],[Target,'Gap intelligence'],[Lightbulb,'Recommendations']].map(([Icon, label]) => (
            <button className={active === label ? 'selected' : ''} onClick={() => setActive(label)} key={label}>
              <Icon size={16} /><span>{label}</span>
              {label === 'Gap intelligence' && gapData.length > 0 && <em>{gapData.filter(g=>g.priority==='Critical').length || gapData.length}</em>}
            </button>
          ))}
        </nav>
        <div className="ai-side-bottom">
          <button><Settings2 size={16} /> Settings</button>
          <button><CircleHelp size={16} /> Documentation</button>
          <button onClick={() => { localStorage.removeItem('skillsync-session'); window.location.href='/login' }}><LogOut size={16} /> Sign out</button>
        </div>
      </aside>

      <main className="ai-main">
        <header className="ai-topbar">
          <div><span>Shared intelligence</span><i>/</i><strong>{active}</strong></div>
          <div className="ai-top-actions">
            <button aria-label="Search"><Search size={17} /></button>
            <button aria-label="Notifications"><AlertCircle size={17} /></button>
            <span>AI</span>
          </div>
        </header>

        <div className="ai-content">
          <section className="ai-welcome">
            <div>
              <p className="ai-kicker">SKILLSYNC INTELLIGENCE LAYER · LIVE</p>
              <h1>From messy language to clear action.</h1>
              <p>See how AI turns a resume, a curriculum, or a job description into shared skills and better next steps.</p>
            </div>
            <div className="ai-status"><i /> Models operational</div>
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

          {/* ── Extraction panel ── */}
          <div className="ai-section-heading">
            <div><p className="ai-kicker">F35–F36 · UNDERSTAND</p><h2>Extract and normalize skills</h2></div>
            <button className="ai-primary" onClick={() => setShowExtract(true)}><UploadCloud size={15} /> Process a document</button>
          </div>
          <section className="ai-grid">
            <div className="ai-panel extract-panel">
              <PanelHeading icon={FileSearch} title="Skill extraction interface" action="Change document" />
              {extractResult ? (
                <>
                  <div className="source-document">
                    <div className="document-icon"><FileSearch size={18} /></div>
                    <div><strong>{fileName || 'Processed document'}</strong><small>{extractResult.extractedSkills?.length || 0} skills extracted · {extractResult.wordCount || 0} words</small></div>
                    <Check size={16} />
                  </div>
                  <div className="extraction-list">
                    {(extractResult.extractedSkills || []).slice(0, 8).map((skill, i) => (
                      <div className="extraction-row" key={skill.normalizedName || i}>
                        <span className={`ai-skill-icon ${['coral','mint','yellow','blue'][i%4]}`}><Sparkles size={13} /></span>
                        <div><small>Detected: {skill.name}</small><strong>{skill.name}</strong><em>{skill.category || 'Skill'}</em></div>
                        <b>{Math.round((skill.confidence || 0.85) * 100)}%</b>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="extract-placeholder">
                  <UploadCloud size={32} /><p>Upload a document to see skill extraction in action.</p>
                  <button className="ai-primary" onClick={() => setShowExtract(true)}>Process a document</button>
                </div>
              )}
              {extractError && <p className="ai-error">{extractError}</p>}
              {extractResult && (
                <form className="inline-skill-form" onSubmit={handleSubmit(addManualSkill)}>
                  <input {...register('raw', { required: true })} placeholder="Detected phrase" />
                  <input {...register('normalized', { required: true })} placeholder="Canonical skill" />
                  <button className="ai-icon-action" aria-label="Add normalized skill"><Plus size={15} /></button>
                </form>
              )}
            </div>

            <div className="ai-panel ontology-panel">
              <PanelHeading icon={Layers3} title="Normalization & standardization" action="Ontology rules" />
              <p className="ai-muted">Every phrase is mapped to one shared skill language so the ecosystem can compare like with like.</p>
              <div className="ontology-map">
                <div><span className="ontology-label">SOURCE LANGUAGE</span><strong>"Build interactive dashboards"</strong></div>
                <ArrowRight size={16} />
                <div className="ontology-canonical"><span className="ontology-label">CANONICAL SKILL</span><strong>Data Visualization</strong><small>Live ontology · Analytics</small></div>
              </div>
              <div className="ontology-confidence"><span><ShieldCheck size={14} /> High-confidence mapping</span><b>91%</b></div>
              <button className="ai-secondary" onClick={() => setActive('Normalization')}>Review mapping rules <ArrowRight size={14} /></button>
            </div>
          </section>

          {/* ── Normalization + Matching ── */}
          <div className="ai-section-heading compact">
            <div><p className="ai-kicker">F37 · COMPARE MEANING</p><h2>Semantic skill matching &amp; normalization</h2></div>
            <span className="ai-live-pill"><i /> Live</span>
          </div>
          <section className="ai-grid">
            <div className="ai-panel matching-panel">
              <PanelHeading icon={Layers3} title="Normalize raw skill terms" action="Normalization guide" />
              <p className="ai-muted">Enter one raw term per line. The engine maps each to a canonical skill.</p>
              <textarea className="norm-textarea" value={normTerms} onChange={e => setNormTerms(e.target.value)} rows={5} placeholder="Power BI&#10;Microsoft Power BI&#10;powerbi&#10;Py" />
              <button className="ai-primary" onClick={runNormalize} disabled={normalizing} style={{marginTop:8}}>{normalizing ? 'Normalizing…' : 'Normalize terms'} <Layers3 size={14} /></button>
              {normResult && (
                <div className="match-list" style={{marginTop:12}}>
                  <small>{normResult.summary?.matched || 0}/{normResult.summary?.total || 0} matched · {Object.entries(normResult.summary?.byMatchType||{}).map(([k,v])=>`${v} ${k}`).join(', ')}</small>
                  {(normResult.results || []).map((r, i) => (
                    <div key={i} className={`extraction-row ${r.matched ? '' : 'unmatched'}`}>
                      <span className={`ai-skill-icon ${r.matched ? 'mint' : 'coral'}`}>{r.matched ? <Check size={12}/> : <X size={12}/>}</span>
                      <div><small>{r.rawTerm}</small><strong>{r.canonicalName || 'No match'}</strong><em>{r.matchType}</em></div>
                      {r.matched && <b>{Math.round(r.confidence * 100)}%</b>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="ai-panel gap-panel">
              <PanelHeading icon={Target} title="Skill gap intelligence" action="Priority logic" />
              <p className="ai-muted">Live demand vs supply gaps — skills the market needs most right now.</p>
              {loadingDemand && <div className="loading-rows"><span /><span /><span /></div>}
              {!loadingDemand && gapData.length === 0 && <p className="ai-empty">No demand data yet. Add demand signals to see gaps.</p>}
              <div className="gap-bars">
                {gapData.map(gap => (
                  <div className="gap-bar-row" key={gap.name}>
                    <span>{gap.name}</span>
                    <div><i className={gap.tone} style={{ width: `${gap.value}%` }} /></div>
                    <b>{gap.value}%</b><em>{gap.priority}</em>
                  </div>
                ))}
              </div>
              <button className="ai-primary full-width" onClick={() => setActive('Recommendations')}><Lightbulb size={15} /> Generate recommendations</button>
            </div>
          </section>

          {/* ── Recommendations ── */}
          <div className="ai-section-heading compact">
            <div><p className="ai-kicker">F39–F40 · ACT WITH CONFIDENCE</p><h2>Recommendations with reasons</h2></div>
          </div>
          <section className="ai-recommendation-grid">
            {demandSkills.slice(0, 3).map((skill, i) => (
              <article className="ai-recommendation" key={skill.skillId || i}>
                <span className="recommendation-icon"><Gauge size={17} /></span>
                <div>
                  <strong>Develop {skill.skillName}</strong>
                  <p>Demand score: {Math.round(skill.avgDemandScore || 0)}/100 — one of the top skills employers are looking for.</p>
                  <small>High demand · {skill.category}</small>
                </div>
                <button onClick={() => setExplain({ skill: skill.skillName, score: Math.round((skill.avgDemandScore || 0)), match: 'High market demand' })}>Why? <ArrowRight size={13} /></button>
              </article>
            ))}
            {demandSkills.length === 0 && (
              <article className="ai-recommendation">
                <span className="recommendation-icon"><Network size={17} /></span>
                <div><strong>Add demand signals to see recommendations</strong><p>Record skill demand scores to activate AI-powered suggestions.</p></div>
              </article>
            )}
          </section>

          <footer className="ai-footer">
            <span><span className="tiny-check"><Check size={10} /></span> AI decisions are traceable and reviewable</span>
            <span>Live ontology · SkillSync B9 normalization engine</span>
          </footer>
        </div>
      </main>

      {/* Upload modal */}
      {showExtract && (
        <div className="ai-modal-backdrop" onClick={() => setShowExtract(false)}>
          <div className="ai-modal" onClick={e => e.stopPropagation()}>
            <button className="ai-close" onClick={() => setShowExtract(false)}><X size={17} /></button>
            <div className="ai-modal-icon"><UploadCloud size={21} /></div>
            <p className="ai-kicker">F35 · SKILL EXTRACTION</p><h2>Process a new document</h2>
            <p>Upload a job description and let the AI layer find its skill signals.</p>
            <label className="ai-upload">
              <input type="file" accept=".pdf,.doc,.docx,.txt" onChange={handleFileChange} />
              <UploadCloud size={25} /><strong>{fileName || 'Choose a document'}</strong><span>PDF, DOCX or TXT · up to 10 MB</span>
            </label>
            {extractError && <p className="ai-error" style={{marginTop:8}}>{extractError}</p>}
            <button className="ai-primary full-width" disabled={!fileName || extracting} onClick={processFile}>{extracting ? 'Extracting…' : 'Extract and normalize'} <Sparkles size={15} /></button>
          </div>
        </div>
      )}

      {/* Explainability modal */}
      {explain && (
        <div className="ai-modal-backdrop" onClick={() => setExplain(null)}>
          <div className="ai-modal explain-modal" onClick={e => e.stopPropagation()}>
            <button className="ai-close" onClick={() => setExplain(null)}><X size={17} /></button>
            <div className="why-icon"><Lightbulb size={21} /></div>
            <p className="ai-kicker">F40 · EXPLAINABILITY</p><h2>Why was this recommended?</h2>
            <p>SkillSync recommended <strong>{explain.skill}</strong> because its demand score is <strong>{explain.score}/100</strong> and it is currently <strong>{explain.match.toLowerCase()}</strong>.</p>
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
  return <div className="ai-panel-heading"><div><Icon size={17} /><h3>{title}</h3></div><button>{action}<ArrowRight size={12} /></button></div>
}
