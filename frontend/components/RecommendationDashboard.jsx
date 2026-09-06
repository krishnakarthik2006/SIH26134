import { useCallback, useEffect, useState } from 'react'
import {
  ArrowRight, BookOpen, Lightbulb, Loader2, Plus, RefreshCw,
  Sparkles, Target, Trash2,
} from 'lucide-react'
import { previewRecommendations, getRecommendationsForMe } from '../api.js'
import './skill-matching.css'
import './rec-engine.css'

const WEIGHTS = [
  { key: 'gapCoverage',     label: 'Gap coverage',    pct: 40 },
  { key: 'demandWeight',    label: 'Demand',           pct: 25 },
  { key: 'levelFit',        label: 'Level fit',        pct: 20 },
  { key: 'providerQuality', label: 'Provider quality', pct: 10 },
  { key: 'freshness',       label: 'Freshness',        pct:  5 },
]

function formatFees(fees) {
  if (fees === 0) return 'Free'
  if (fees == null) return null
  return `₹${Number(fees).toLocaleString('en-IN')}`
}

function DimBars({ scores }) {
  if (!scores) return null
  return (
    <div className="rec-dims">
      {WEIGHTS.map(w => (
        <div className="rec-dim" key={w.key}>
          <strong>{w.label} {Math.round((scores[w.key] || 0) * 100)}</strong>
          <div className="rec-dim-bar"><i style={{ width: `${(scores[w.key] || 0) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  )
}

function CourseCard({ rec }) {
  const [open, setOpen] = useState(false)
  const meta = [
    rec.providerName,
    rec.deliveryMode,
    rec.durationWeeks ? `${rec.durationWeeks} weeks` : null,
    formatFees(rec.fees),
    rec.certificationOffered ? 'Free Certificate' : null,
  ].filter(Boolean)

  const criticalChips = (rec.coveredGaps || []).filter(g => g.requirement === 'required')
  const otherChips    = (rec.coveredGaps || []).filter(g => g.requirement !== 'required')
  const resources     = rec.resources || []

  return (
    <article className={`rec-course ${rec.priority || 'medium'}`}>
      <div className="rec-course-top">
        <div>
          <strong>{rec.programName}</strong>
          <div className="rec-course-meta">{meta.map(item => <span key={item}>{item}</span>)}</div>
          <span className={`rec-priority ${rec.priority}`}>{rec.priority} priority</span>
        </div>
        <div className="rec-score-block">
          <b>{rec.relevanceScore}</b>
          <span>relevance / 100</span>
        </div>
      </div>
      <div className="rec-reason-chips">
        {criticalChips.map(g => <span className="rec-chip coral" key={g.skillName}>Critical · {g.skillName}</span>)}
        {otherChips.map(g => <span className="rec-chip" key={g.skillName}>{g.skillName}</span>)}
      </div>
      
      {/* Multi-Type Learning Resources (YouTube, Certs, Docs, Projects) */}
      {resources.length > 0 && (
        <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted, #94a3b8)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Recommended Multi-Source Learning Paths:
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.4rem' }}>
            {resources.map((res, i) => (
              <a
                key={i}
                href={res.url}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  fontSize: '0.75rem',
                  padding: '0.25rem 0.6rem',
                  borderRadius: '12px',
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  color: '#60a5fa',
                  textDecoration: 'none',
                  fontWeight: 500,
                }}
              >
                <span>{res.type === 'youtube' ? '▶ YouTube' : res.type === 'certification' ? '📜 Free Cert' : res.type === 'documentation' ? '📘 Docs' : res.type === 'project' ? '💻 Project' : '🎓 Course'}</span>
                <span>· {res.title}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      <DimBars scores={rec.scores} />
      <button className="rec-explain-toggle" onClick={() => setOpen(v => !v)}>
        <Lightbulb size={13} /> {open ? 'Hide explanation' : 'Why this course?'}
      </button>
      {open && <p className="rec-explain">{rec.explanation}</p>}
    </article>
  )
}

// ─── Recommendation Engine Panel ─────────────────────────────────────────────
export function RecommendationEnginePanel({ initialGaps }) {
  const [gaps, setGaps] = useState(
    (initialGaps || []).map(g => ({
      skillName:    g.skillName || g.name || '',
      requirement:  g.requirement || (g.priority === 'critical' ? 'required' : 'preferred'),
      requiredLevel: g.requiredLevel || 'intermediate',
    }))
  )
  const [prioritizeCritical, setPrioritize] = useState(true)
  const [loading, setLoading]  = useState(false)
  const [result,  setResult]   = useState(null)
  const [error,   setError]    = useState('')

  const run = useCallback(async () => {
    const payload = gaps.filter(g => g.skillName?.trim())
    if (!payload.length) return
    setLoading(true); setError('')
    try {
      const data = await previewRecommendations(payload, { limit: 12, prioritizeCritical })
      setResult(data)
    } catch (e) {
      setError(e?.response?.data?.error || 'Could not reach the recommendation engine.')
      setResult(null)
    } finally { setLoading(false) }
  }, [gaps, prioritizeCritical])

  const updateGap = (i, field, val) => {
    setGaps(cur => cur.map((g, idx) => idx === i ? { ...g, [field]: val } : g))
    setResult(null)
  }

  return (
    <div className="rec-layout">
      <div className="rec-col">
        <div className="rec-card">
          <h3>Missing skills</h3>
          <p className="rec-hint">Required skills are treated as critical and ranked first.</p>
          {gaps.length === 0 && <p className="rec-hint">Add the skills you need to close, then run the engine.</p>}
          {gaps.map((gap, i) => (
            <div className="rec-gap-row" key={i}>
              <input value={gap.skillName} placeholder="Skill name" onChange={e => updateGap(i, 'skillName', e.target.value)} />
              <select value={gap.requirement} onChange={e => updateGap(i, 'requirement', e.target.value)}>
                <option value="required">Critical</option>
                <option value="preferred">Preferred</option>
                <option value="nice-to-have">Nice to have</option>
              </select>
              <button className="rec-gap-remove" aria-label="Remove" onClick={() => { setGaps(cur => cur.filter((_, idx) => idx !== i)); setResult(null) }}><Trash2 size={13} /></button>
            </div>
          ))}
          <button className="smb-ghost-btn" onClick={() => setGaps(cur => [...cur, { skillName: '', requirement: 'required', requiredLevel: 'intermediate' }])}>
            <Plus size={13} /> Add missing skill
          </button>
          <label className="rec-toggle">
            <input type="checkbox" checked={prioritizeCritical} onChange={e => setPrioritize(e.target.checked)} />
            Prioritize critical skills
          </label>
          {error && <p style={{ color: '#c0392b', fontSize: 12, marginTop: 8 }}>{error}</p>}
          <div className="smb-lab-actions">
            <button className="smb-primary-btn" onClick={run} disabled={loading || !gaps.some(g => g.skillName?.trim())}>
              {loading ? <><Loader2 size={15} className="smb-spin" /> Scoring…</> : <><Sparkles size={15} /> Recommend courses</>}
            </button>
          </div>
        </div>

        <div className="rec-card">
          <h3>How relevance is scored</h3>
          <p className="rec-hint">Each course is scored 0–100 from five weighted signals.</p>
          <div className="rec-weight-list">
            {WEIGHTS.map(w => (
              <div className="rec-weight-row" key={w.key}>
                <span>{w.label}</span>
                <div className="rec-weight-track"><i style={{ width: `${w.pct}%` }} /></div>
                <b>{w.pct}%</b>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div>
        <div className="rec-results-head">
          <div><p className="rec-kicker">RANKED FOR YOUR GAPS</p><h2>Recommended courses</h2></div>
          {result && <span className="rec-hint" style={{ margin: 0 }}>{result.count} match{result.count !== 1 ? 'es' : ''}</span>}
        </div>

        {!result && !loading && (
          <div className="rec-empty">
            <BookOpen size={36} strokeWidth={1.4} />
            <h3>No recommendations yet</h3>
            <p>Add the skills you are missing, mark critical ones as required, and run the engine to rank matching courses with a relevance score and plain-English explanation.</p>
          </div>
        )}
        {loading && <div className="rec-empty"><Loader2 size={32} className="smb-spin" /><p>Matching published programmes to your missing skills…</p></div>}
        {result?.recommendations?.length === 0 && <div className="rec-empty"><BookOpen size={32} strokeWidth={1.4} /><h3>No matching courses found</h3><p>No published training programmes cover your skill gaps yet. Check back as more programmes are added, or adjust your skill list.</p></div>}
        {(result?.recommendations || []).map(rec => <CourseCard rec={rec} key={rec.programId} />)}
      </div>
    </div>
  )
}

// ─── Student Recommendations (used inside StudentDashboard) ───────────────────
export function StudentRecommendations({ onOpenRoadmap }) {
  const [recs,    setRecs]    = useState([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [error,   setError]   = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const data = await getRecommendationsForMe({ limit: 8 })
      setRecs(data.recommendations || [])
      setMessage(data.targetRole ? `Ranked for ${data.targetRole}` : (data.message || ''))
    } catch (e) {
      setError('Could not load recommendations.')
      setRecs([])
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div>
      <div className="student-section-title compact">
        <div>
          <p className="student-kicker">MAKE YOUR NEXT MOVE</p>
          <h2>Recommended for you</h2>
          {message && <p className="student-muted">{message}</p>}
          {error   && <p className="student-muted" style={{ color: '#c0392b' }}>{error} <button onClick={load} style={{ background: 'none', border: 'none', color: '#7160e0', cursor: 'pointer', fontSize: 12 }}>Retry</button></p>}
        </div>
      </div>

      {loading && <p className="student-muted">Scoring courses against your missing skills…</p>}

      {!loading && recs.length === 0 && (
        <div className="empty-state" style={{ padding: '24px 0' }}>
          <BookOpen size={28} />
          <p>No recommendations yet. Complete your skill profile and run a gap analysis to get personalised course suggestions.</p>
        </div>
      )}

      <section className="recommendation-grid rec-student-grid">
        {recs.map(item => (
          <button className="recommendation-card" key={item.programId} onClick={() => onOpenRoadmap?.()}>
            <div className={`recommendation-icon ${item.priority === 'critical' ? 'coral' : item.priority === 'high' ? 'mint' : 'blue'}`}>
              <BookOpen size={18} />
            </div>
            <strong>{item.programName}</strong>
            <span>{[item.durationWeeks ? `${item.durationWeeks} weeks` : null, item.deliveryMode, formatFees(item.fees)].filter(Boolean).join(' · ') || 'Course match'}</span>
            <small><Sparkles size={11} /> {item.explanation?.split('.')[0] || 'Recommended from your missing skills'}</small>
            <em className="rec-inline-score">{item.relevanceScore}</em>
            <ArrowRight className="recommendation-arrow" size={16} />
          </button>
        ))}
      </section>
    </div>
  )
}

// ─── Full page wrapper ─────────────────────────────────────────────────────────
export default function RecommendationDashboard({ matchGaps }) {
  return (
    <div className="smb-shell rec-shell">
      <div className="smb-header">
        <div className="smb-header-left">
          <div className="smb-header-icon"><Target size={19} /></div>
          <div><p className="smb-kicker">PHASE B11</p><h1>Course recommendation engine</h1></div>
        </div>
        <div className="smb-header-right">
          <div className="smb-pipeline-flow">
            {['Missing skills', 'Cover courses', 'Score relevance', 'Explain', 'Prioritize critical'].map((step, i, arr) => (
              <span key={step} className="smb-pipeline-step-wrap">
                <span className={`smb-pipeline-step ${i % 2 === 0 ? 'filled' : 'arrow'}`}>{step}</span>
                {i < arr.length - 1 && <ArrowRight size={12} className="smb-pipeline-arrow" />}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="smb-panel">
        <RecommendationEnginePanel initialGaps={matchGaps || []} />
      </div>
    </div>
  )
}
