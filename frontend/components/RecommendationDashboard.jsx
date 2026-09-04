/**
 * RecommendationDashboard — Phase B11
 *
 * Rank courses against missing skills, show a relevance score, explain why
 * each course is recommended, and keep required (critical) gaps first.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  ArrowRight,
  BookOpen,
  Lightbulb,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Target,
  Trash2,
} from 'lucide-react'
import { previewRecommendations, getStudentRecommendations, getRecommendationsForMe } from '../api.js'
import './skill-matching.css'
import './rec-engine.css'

const DEMO_GAPS = [
  { skillName: 'SQL', requirement: 'required', requiredLevel: 'advanced' },
  { skillName: 'Python', requirement: 'required', requiredLevel: 'intermediate' },
  { skillName: 'Power BI', requirement: 'preferred', requiredLevel: 'intermediate' },
  { skillName: 'Cloud fundamentals', requirement: 'nice-to-have', requiredLevel: 'beginner' },
]

const WEIGHTS = [
  { key: 'gapCoverage', label: 'Gap coverage', pct: 40 },
  { key: 'demandWeight', label: 'Demand', pct: 25 },
  { key: 'levelFit', label: 'Level fit', pct: 20 },
  { key: 'providerQuality', label: 'Provider', pct: 10 },
  { key: 'freshness', label: 'Freshness', pct: 5 },
]

const MOCK_RECS = [
  {
    programId: 'demo-sql',
    programName: 'SQL for Data Analysis',
    providerName: 'Academy for Tech',
    deliveryMode: 'online',
    durationWeeks: 8,
    fees: 0,
    certificationOffered: true,
    relevanceScore: 86,
    priority: 'critical',
    scores: { gapCoverage: 0.72, demandWeight: 0.88, levelFit: 0.9, providerQuality: 0.8, freshness: 0.8 },
    coveredGaps: [{ skillName: 'SQL', requirement: 'required' }],
    coveredGapCount: 1,
    criticalCoveredCount: 1,
    reasons: [
      { type: 'critical_skill', label: 'Critical skill', text: 'Closes the critical missing skill SQL.' },
      { type: 'demand', label: 'High demand', text: 'Skills taught are in very high employer demand.' },
      { type: 'certification', label: 'Certification', text: 'Includes an industry-recognised certification on completion.' },
    ],
    explanation: 'Covers the critical missing skill: SQL. Skills taught are in very high employer demand. Offered by Academy for Tech. Includes an industry-recognised certification on completion. Format: online · 8 weeks · free. Overall relevance: 86/100 (highly relevant).',
  },
  {
    programId: 'demo-bi',
    programName: 'Power BI Dashboard Lab',
    providerName: 'Academy for Tech',
    deliveryMode: 'hybrid',
    durationWeeks: 6,
    fees: 12000,
    certificationOffered: false,
    relevanceScore: 71,
    priority: 'high',
    scores: { gapCoverage: 0.41, demandWeight: 0.74, levelFit: 0.7, providerQuality: 0.7, freshness: 0.6 },
    coveredGaps: [{ skillName: 'Power BI', requirement: 'preferred' }],
    coveredGapCount: 1,
    criticalCoveredCount: 0,
    reasons: [
      { type: 'preferred_skill', label: 'Preferred skills', text: 'Also covers the preferred skill Power BI.' },
    ],
    explanation: 'Also addresses the preferred skill: Power BI. Skills taught are in moderate employer demand. Offered by Academy for Tech. Format: hybrid · 6 weeks · ₹12,000. Overall relevance: 71/100 (relevant).',
  },
  {
    programId: 'demo-story',
    programName: 'Tell better stories with data',
    providerName: 'SkillSync Labs',
    deliveryMode: 'online',
    durationWeeks: 4,
    fees: 0,
    certificationOffered: false,
    relevanceScore: 58,
    priority: 'medium',
    scores: { gapCoverage: 0.18, demandWeight: 0.61, levelFit: 0.5, providerQuality: 0.4, freshness: 1 },
    coveredGaps: [{ skillName: 'Cloud fundamentals', requirement: 'nice-to-have' }],
    coveredGapCount: 1,
    criticalCoveredCount: 0,
    reasons: [
      { type: 'supplementary', label: 'Supplementary', text: 'Covers supplementary skills: Cloud fundamentals.' },
    ],
    explanation: 'Covers supplementary skills: Cloud fundamentals. Overall relevance: 58/100 (relevant).',
  },
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
      {WEIGHTS.map((w) => (
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
    rec.certificationOffered ? 'Certificate' : null,
  ].filter(Boolean)

  const criticalChips = (rec.coveredGaps || []).filter((g) => g.requirement === 'required')
  const otherChips = (rec.coveredGaps || []).filter((g) => g.requirement !== 'required')

  return (
    <article className={`rec-course ${rec.priority || 'medium'}`}>
      <div className="rec-course-top">
        <div>
          <strong>{rec.programName}</strong>
          <div className="rec-course-meta">{meta.map((item) => <span key={item}>{item}</span>)}</div>
          <span className={`rec-priority ${rec.priority}`}>{rec.priority} priority</span>
        </div>
        <div className="rec-score-block">
          <b>{rec.relevanceScore}</b>
          <span>relevance / 100</span>
        </div>
      </div>
      <div className="rec-reason-chips">
        {criticalChips.map((g) => (
          <span className="rec-chip coral" key={g.skillName}>Critical · {g.skillName}</span>
        ))}
        {otherChips.map((g) => (
          <span className="rec-chip" key={g.skillName}>{g.skillName}</span>
        ))}
        {(rec.reasons || []).filter((r) => r.type === 'demand' || r.type === 'certification').slice(0, 2).map((r) => (
          <span className="rec-chip mint" key={r.type}>{r.label}</span>
        ))}
      </div>
      <DimBars scores={rec.scores} />
      <button className="rec-explain-toggle" onClick={() => setOpen((v) => !v)}>
        <Lightbulb size={13} /> {open ? 'Hide explanation' : 'Why this course?'}
      </button>
      {open && <p className="rec-explain">{rec.explanation}</p>}
    </article>
  )
}

export function RecommendationEnginePanel({ initialGaps }) {
  const seed = initialGaps?.length
    ? initialGaps.map((g) => ({
        skillName: g.skillName,
        requirement: g.requirement === 'required' || g.priority === 'critical' ? 'required'
          : g.requirement === 'preferred' || g.priority === 'high' ? 'preferred'
          : g.requirement || 'nice-to-have',
        requiredLevel: g.requiredLevel || 'intermediate',
      }))
    : DEMO_GAPS

  const [gaps, setGaps] = useState(seed)
  const [prioritizeCritical, setPrioritizeCritical] = useState(true)
  const [loading, setLoading] = useState(false)
  const [usedMock, setUsedMock] = useState(false)
  const [result, setResult] = useState(null)

  const run = useCallback(async () => {
    const payload = gaps.filter((g) => g.skillName?.trim())
    if (!payload.length) return
    setLoading(true)
    try {
      const data = await previewRecommendations(payload, { limit: 12, prioritizeCritical })
      setResult(data)
      setUsedMock(!data.recommendations?.length)
      if (!data.recommendations?.length) {
        setResult({ ...data, recommendations: MOCK_RECS, count: MOCK_RECS.length })
      }
    } catch {
      setUsedMock(true)
      setResult({ recommendations: MOCK_RECS, count: MOCK_RECS.length, gapCount: payload.length })
    } finally {
      setLoading(false)
    }
  }, [gaps, prioritizeCritical])

  const updateGap = (index, field, value) => {
    setGaps((current) => current.map((gap, i) => i === index ? { ...gap, [field]: value } : gap))
    setResult(null)
  }

  return (
    <div className="rec-layout">
      <div className="rec-col">
        <div className="rec-card">
          <h3>Missing skills</h3>
          <p className="rec-hint">Required skills are treated as critical and ranked first.</p>
          {gaps.map((gap, index) => (
            <div className="rec-gap-row" key={index}>
              <input
                value={gap.skillName}
                placeholder="Skill name"
                onChange={(e) => updateGap(index, 'skillName', e.target.value)}
              />
              <select value={gap.requirement} onChange={(e) => updateGap(index, 'requirement', e.target.value)}>
                <option value="required">Critical</option>
                <option value="preferred">Preferred</option>
                <option value="nice-to-have">Nice to have</option>
              </select>
              <button className="rec-gap-remove" aria-label="Remove skill" onClick={() => {
                setGaps((current) => current.filter((_, i) => i !== index))
                setResult(null)
              }}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          <button
            className="smb-ghost-btn"
            onClick={() => setGaps((current) => [...current, { skillName: '', requirement: 'required', requiredLevel: 'intermediate' }])}
          >
            <Plus size={13} /> Add missing skill
          </button>
          <label className="rec-toggle">
            <input type="checkbox" checked={prioritizeCritical} onChange={(e) => setPrioritizeCritical(e.target.checked)} />
            Prioritize critical skills
          </label>
          <div className="smb-lab-actions">
            <button className="smb-primary-btn" onClick={run} disabled={loading}>
              {loading ? <Loader2 size={15} className="smb-spin" /> : <Sparkles size={15} />}
              {loading ? 'Scoring courses…' : 'Recommend courses'}
            </button>
            <button className="smb-ghost-btn" onClick={() => { setGaps(DEMO_GAPS); setResult(null) }}>
              <RefreshCw size={13} /> Reset demo
            </button>
          </div>
        </div>
        <div className="rec-card">
          <h3>How relevance is scored</h3>
          <p className="rec-hint">Each course is scored 0–100 from five weighted signals.</p>
          <div className="rec-weight-list">
            {WEIGHTS.map((w) => (
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
          <div>
            <p className="rec-kicker">RANKED FOR YOUR GAPS</p>
            <h2>Recommended courses</h2>
          </div>
          {result && <span className="rec-hint" style={{ margin: 0 }}>{result.count} matches{usedMock ? ' · demo catalogue' : ''}</span>}
        </div>
        {!result && !loading && (
          <div className="rec-empty">
            <BookOpen size={36} strokeWidth={1.4} />
            <h3>No recommendations yet</h3>
            <p>Add the skills you are missing, keep critical ones marked required, then run the engine to rank courses with a relevance score and a plain-English reason.</p>
          </div>
        )}
        {loading && (
          <div className="rec-empty">
            <Loader2 size={32} className="smb-spin" />
            <p>Matching published programmes to your missing skills…</p>
          </div>
        )}
        {result?.recommendations?.map((rec) => (
          <CourseCard rec={rec} key={rec.programId} />
        ))}
      </div>
    </div>
  )
}

export default function RecommendationDashboard({ matchGaps }) {
  return (
    <div className="smb-shell rec-shell">
      <div className="smb-header">
        <div className="smb-header-left">
          <div className="smb-header-icon"><Target size={19} /></div>
          <div>
            <p className="smb-kicker">PHASE B11</p>
            <h1>Course recommendation engine</h1>
          </div>
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
        <RecommendationEnginePanel initialGaps={matchGaps} />
      </div>
    </div>
  )
}

export function StudentRecommendations({ onOpenRoadmap }) {
  const [recs, setRecs] = useState(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      let data
      try {
        data = await getStudentRecommendations({ limit: 8 })
      } catch {
        data = await getRecommendationsForMe({ limit: 8 })
      }
      if (data.recommendations?.length) {
        setRecs(data.recommendations)
        setMessage(data.targetRole ? `Ranked for ${data.targetRole}` : '')
      } else {
        setRecs(MOCK_RECS)
        setMessage(data.message || 'Showing illustrative courses until a live catalogue match is available.')
      }
    } catch {
      setRecs(MOCK_RECS)
      setMessage('Showing illustrative courses until the live engine is reachable.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div>
      <div className="student-section-title compact">
        <div>
          <p className="student-kicker">MAKE YOUR NEXT MOVE</p>
          <h2>Recommended for you</h2>
          {message && <p className="student-muted">{message}</p>}
        </div>
      </div>
      {loading && <p className="student-muted">Scoring courses against your missing skills…</p>}
      <section className="recommendation-grid rec-student-grid">
        {(recs || []).map((item) => (
          <button
            className="recommendation-card"
            key={item.programId}
            onClick={() => onOpenRoadmap?.()}
          >
            <div className={`recommendation-icon ${item.priority === 'critical' ? 'coral' : item.priority === 'high' ? 'mint' : 'blue'}`}>
              <BookOpen size={18} />
            </div>
            <strong>{item.programName}</strong>
            <span>
              {[item.durationWeeks ? `${item.durationWeeks} weeks` : null, item.deliveryMode, formatFees(item.fees)].filter(Boolean).join(' · ') || 'Course match'}
            </span>
            <small><Sparkles size={11} /> {item.reasons?.[0]?.text || 'Recommended from your missing skills'}</small>
            <em className="rec-inline-score">{item.relevanceScore}</em>
          </button>
        ))}
      </section>
    </div>
  )
}
