/**
 * SkillMatchingDashboard — B9 / B11
 * Three panels: Normalization Lab · Skill Matcher · Gap Report + Recommendations
 * All data comes from the live API — no mock fallbacks.
 */

import { useState, useCallback } from 'react'
import {
  ArrowRight, CheckCircle2, ChevronDown, ChevronRight, CircleDashed,
  FlaskConical, Gauge, GitCompareArrows, HelpCircle, Lightbulb, ListChecks,
  Loader2, Plus, RefreshCw, Sparkles, Target, Trash2, TrendingUp, X, XCircle, Zap,
} from 'lucide-react'
import { normalizeSkills, matchSkillsAdHoc } from '../api.js'
import { RecommendationEnginePanel } from './RecommendationDashboard.jsx'
import './skill-matching.css'

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const LEVEL_LABELS = ['beginner', 'intermediate', 'advanced', 'expert']
const MATCH_TYPE_META = {
  exact:         { label: 'Exact',    color: 'mint',   icon: '✓' },
  alias:         { label: 'Alias',    color: 'blue',   icon: '≈' },
  mapping:       { label: 'Mapped',   color: 'violet', icon: '↦' },
  prefix:        { label: 'Prefix',   color: 'yellow', icon: '⊂' },
  token_overlap: { label: 'Token',    color: 'yellow', icon: '∩' },
  fuzzy:         { label: 'Fuzzy',    color: 'coral',  icon: '~' },
  unmatched:     { label: 'No match', color: 'red',    icon: '?' },
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function severityMeta(s) {
  switch (s) {
    case 'critical': return { label: 'Critical', color: 'coral',  icon: XCircle     }
    case 'moderate': return { label: 'Moderate', color: 'yellow', icon: HelpCircle  }
    case 'low':      return { label: 'Low',       color: 'mint',   icon: CheckCircle2 }
    default:         return { label: 'None',      color: 'mint',   icon: CheckCircle2 }
  }
}

function levelGapLabel(gap) {
  if (gap <= 0) return gap < 0 ? 'Exceeds requirement' : 'Exact match'
  if (gap === 1) return 'One level below'
  return 'Significantly below'
}

// ─── SUB-COMPONENTS ───────────────────────────────────────────────────────────
function TabBar({ tabs, active, onChange }) {
  return (
    <div className="smb-tabbar" role="tablist">
      {tabs.map(tab => {
        const Icon = tab.icon
        return (
          <button key={tab.id} className={`smb-tab ${active === tab.id ? 'active' : ''}`} role="tab" aria-selected={active === tab.id} onClick={() => onChange(tab.id)}>
            <Icon size={15} /><span>{tab.label}</span>{tab.badge && <em>{tab.badge}</em>}
          </button>
        )
      })}
    </div>
  )
}

function ConfidencePill({ conf, matchType }) {
  const meta = MATCH_TYPE_META[matchType] || MATCH_TYPE_META.unmatched
  const pct  = Math.round(conf * 100)
  const color = pct >= 90 ? 'mint' : pct >= 70 ? 'blue' : pct >= 50 ? 'yellow' : 'coral'
  return (
    <span className={`smb-conf-pill ${color}`}>
      <span className="smb-match-icon">{meta.icon}</span>
      <span>{meta.label}</span>
      <span className="smb-conf-pct">{pct}%</span>
    </span>
  )
}

function ReadinessRing({ score }) {
  const c = 2 * Math.PI * 42
  const dash = (score / 100) * c
  const color = score >= 70 ? '#55b99e' : score >= 45 ? '#eab856' : '#f47b62'
  return (
    <div className="smb-ring-wrap">
      <svg width="100" height="100" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="42" fill="none" stroke="#eee" strokeWidth="9" />
        <circle cx="50" cy="50" r="42" fill="none" stroke={color} strokeWidth="9" strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`} strokeDashoffset={c / 4}
          style={{ transition: 'stroke-dasharray .6s ease' }} />
      </svg>
      <div className="smb-ring-label"><strong>{score}%</strong><span>Ready</span></div>
    </div>
  )
}

function SectionHeading({ icon: Icon, title, subtitle }) {
  return (
    <div className="smb-section-head">
      <div className="smb-section-icon"><Icon size={18} /></div>
      <div><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}</div>
    </div>
  )
}

// ─── PANEL 1 — NORMALIZATION LAB ──────────────────────────────────────────────
function NormalizationLab() {
  const [input,   setInput]   = useState('')
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  const run = useCallback(async () => {
    const terms = input.split('\n').map(t => t.trim()).filter(Boolean)
    if (!terms.length) return
    setLoading(true); setError('')
    try {
      const data = await normalizeSkills(terms)
      setResults(data)
    } catch (e) {
      setError(e?.response?.data?.error || 'Normalization failed. Check the server.')
      setResults(null)
    } finally { setLoading(false) }
  }, [input])

  const grouped = results
    ? Object.values(results.results.reduce((acc, r) => {
        const key = r.canonicalName || '__unmatched__'
        if (!acc[key]) acc[key] = { canonical: r.canonicalName, matched: r.matched, items: [] }
        acc[key].items.push(r)
        return acc
      }, {}))
    : []

  return (
    <div className="smb-lab">
      <div className="smb-norm-hero">
        <div className="smb-norm-hero-flow">
          {['PowerBI', 'Microsoft Power BI', 'power bi', 'POWER BI'].map((v, i) => (
            <span key={v} className="smb-variant-chip">
              <span>{v}</span>{i < 3 && <ChevronRight size={13} className="smb-flow-arrow" />}
            </span>
          ))}
          <span className="smb-norm-arrow"><ArrowRight size={18} /></span>
          <span className="smb-canonical-chip"><Sparkles size={13} />Power BI</span>
        </div>
        <p className="smb-norm-hero-caption">The normalization engine resolves any spelling, casing, or vendor-prefix variant to one canonical skill.</p>
      </div>

      <div className="smb-lab-body">
        <div className="smb-lab-input-col">
          <label className="smb-lab-label">Raw skill terms <span className="smb-lab-hint">One per line</span></label>
          <textarea className="smb-lab-textarea" value={input} onChange={e => { setInput(e.target.value); setResults(null) }}
            placeholder={`PowerBI\nMicrosoft Power BI\npowerbi\nPython 3\nPy\nNode.js`} rows={10} />
          {error && <p style={{ color: '#c0392b', fontSize: 12, marginTop: 4 }}>{error}</p>}
          <div className="smb-lab-actions">
            <button className="smb-primary-btn" onClick={run} disabled={loading || !input.trim()}>
              {loading ? <><Loader2 size={15} className="smb-spin" /> Normalizing…</> : <><FlaskConical size={15} /> Run normalization</>}
            </button>
            <button className="smb-ghost-btn" onClick={() => { setInput(''); setResults(null) }}><RefreshCw size={13} /> Clear</button>
          </div>
        </div>

        <div className="smb-lab-result-col">
          {!results && !loading && (
            <div className="smb-lab-empty">
              <CircleDashed size={32} strokeWidth={1.5} />
              <p>Enter skill terms on the left and click <strong>Run normalization</strong> to see how the engine resolves each variant to a canonical skill.</p>
            </div>
          )}
          {loading && <div className="smb-lab-empty"><Loader2 size={32} className="smb-spin" strokeWidth={1.5} /><p>Resolving terms…</p></div>}
          {results && (
            <>
              <div className="smb-norm-summary">
                <div className="smb-norm-stat mint"><strong>{results.summary.matched}</strong><span>Resolved</span></div>
                <div className="smb-norm-stat coral"><strong>{results.summary.unmatched}</strong><span>Unmatched</span></div>
                <div className="smb-norm-stat blue"><strong>{results.summary.total}</strong><span>Total</span></div>
                {Object.entries(results.summary.byMatchType || {}).map(([type, count]) => (
                  <div key={type} className={`smb-norm-stat ${MATCH_TYPE_META[type]?.color || 'blue'}`}>
                    <strong>{count}</strong><span>{MATCH_TYPE_META[type]?.label || type}</span>
                  </div>
                ))}
              </div>
              <div className="smb-norm-groups">
                {grouped.map(group => (
                  <div key={group.canonical || 'unmatched'} className={`smb-norm-group ${group.matched ? 'matched' : 'unmatched'}`}>
                    <div className="smb-norm-group-head">
                      <span className={`smb-canonical-label ${group.matched ? 'matched' : 'unmatched'}`}>
                        {group.matched ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                        {group.canonical || 'Not matched'}
                      </span>
                      <span className="smb-norm-group-count">{group.items.length} input{group.items.length !== 1 ? 's' : ''}</span>
                    </div>
                    <div className="smb-norm-rows">
                      {group.items.map(item => (
                        <div className="smb-norm-row" key={item.rawTerm}>
                          <span className="smb-raw-term">{item.rawTerm}</span>
                          <span className="smb-cleaned-term">→ {item.cleanedTerm}</span>
                          <ConfidencePill conf={item.confidence} matchType={item.matchType} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── PANEL 2 — SKILL MATCHER ──────────────────────────────────────────────────
function useSkillList(initial = []) {
  const [skills, setSkills] = useState(initial)
  const add    = useCallback((name, level, extra = {}) => setSkills(p => [...p, { skillName: name.trim(), level, ...extra }]), [])
  const remove = useCallback(i => setSkills(p => p.filter((_, idx) => idx !== i)), [])
  const upd    = useCallback((i, level) => setSkills(p => p.map((s, idx) => idx === i ? { ...s, level } : s)), [])
  const reset  = useCallback(seed => setSkills(seed), [])
  return { skills, add, remove, updateLevel: upd, reset }
}

function AddSkillRow({ onAdd, side }) {
  const [name,  setName]  = useState('')
  const [level, setLevel] = useState('intermediate')
  const [req,   setReq]   = useState('required')
  const submit = () => {
    if (!name.trim()) return
    onAdd(name, level, side === 'required' ? { requirement: req } : {})
    setName('')
  }
  return (
    <div className="smb-add-row">
      <input className="smb-add-input" placeholder="Skill name…" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} />
      <select className="smb-add-select" value={level} onChange={e => setLevel(e.target.value)}>
        {LEVEL_LABELS.map(l => <option key={l}>{l}</option>)}
      </select>
      {side === 'required' && (
        <select className="smb-add-select req" value={req} onChange={e => setReq(e.target.value)}>
          <option value="required">Required</option>
          <option value="preferred">Preferred</option>
          <option value="nice-to-have">Nice-to-have</option>
        </select>
      )}
      <button className="smb-add-btn" onClick={submit} disabled={!name.trim()}><Plus size={14} /></button>
    </div>
  )
}

function SkillMatcherPanel({ onResult }) {
  const reqList = useSkillList([])
  const curList = useSkillList([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  const reqTone = req => req === 'required' ? 'coral' : req === 'preferred' ? 'blue' : 'yellow'

  const runMatch = async () => {
    if (!reqList.skills.length) { setError('Add at least one required skill.'); return }
    setLoading(true); setError('')
    try {
      const data = await matchSkillsAdHoc(reqList.skills, curList.skills)
      onResult(data.result)
    } catch (e) {
      setError(e?.response?.data?.error || 'Match failed. Check the server.')
    } finally { setLoading(false) }
  }

  const SkillList = ({ list, side }) => (
    <>
      {list.skills.length === 0 && <p className="smb-empty-hint">Add {side === 'required' ? 'skills the role demands' : 'skills you already have'}.</p>}
      <div className="smb-skill-list">
        {list.skills.map((s, i) => (
          <div className="smb-skill-item" key={i}>
            <span className={`smb-req-badge ${side === 'required' ? reqTone(s.requirement) : 'blue'}`}>
              {side === 'required' ? (s.requirement === 'required' ? 'R' : s.requirement === 'preferred' ? 'P' : 'N') : 'L'}
            </span>
            <span className="smb-skill-name">{s.skillName}</span>
            <select className="smb-level-select" value={s.level || 'intermediate'} onChange={e => list.updateLevel(i, e.target.value)}>
              {LEVEL_LABELS.map(l => <option key={l}>{l}</option>)}
            </select>
            <button className="smb-remove-btn" onClick={() => list.remove(i)} aria-label="Remove"><Trash2 size={13} /></button>
          </div>
        ))}
      </div>
      <AddSkillRow onAdd={list.add} side={side} />
    </>
  )

  return (
    <div className="smb-matcher">
      <div className="smb-matcher-cols">
        <div className="smb-matcher-col">
          <SectionHeading icon={Target} title="Required Skills" subtitle="Skills the role demands" />
          <SkillList list={reqList} side="required" />
        </div>
        <div className="smb-matcher-divider">
          <div className="smb-divider-line" /><div className="smb-divider-icon"><GitCompareArrows size={18} /></div><div className="smb-divider-line" />
        </div>
        <div className="smb-matcher-col">
          <SectionHeading icon={ListChecks} title="Current Skills" subtitle="Skills the learner has now" />
          <SkillList list={curList} side="current" />
        </div>
      </div>
      {error && <p style={{ color: '#c0392b', fontSize: 12, marginTop: 8 }}>{error}</p>}
      <div className="smb-matcher-footer">
        <div className="smb-matcher-counts">
          <span><strong>{reqList.skills.length}</strong> required</span>
          <span><strong>{curList.skills.length}</strong> current</span>
        </div>
        <button className="smb-primary-btn large" onClick={runMatch} disabled={loading}>
          {loading ? <><Loader2 size={16} className="smb-spin" /> Running match…</> : <><Zap size={16} /> Run skill match</>}
        </button>
      </div>
    </div>
  )
}

// ─── PANEL 3 — GAP REPORT ─────────────────────────────────────────────────────
function GapReport({ result, onRecommend }) {
  const [expandSurplus, setExpand] = useState(false)
  const SeverityIcon = severityMeta(result.gapSeverity).icon

  return (
    <div className="smb-gap-report">
      <div className="smb-gap-hero">
        <ReadinessRing score={result.readinessScore} />
        <div className="smb-gap-hero-copy">
          <p className="smb-kicker">JOB READINESS SCORE</p>
          <h2>{result.readinessScore}%</h2>
          <div className={`smb-severity-badge ${severityMeta(result.gapSeverity).color}`}>
            <SeverityIcon size={13} />{severityMeta(result.gapSeverity).label} gap severity
          </div>
          <div className="smb-gap-stats">
            <div className="smb-gap-stat mint"><strong>{result.matchedCount}</strong><span>Matched</span></div>
            <div className="smb-gap-stat coral"><strong>{result.gapCount}</strong><span>Gaps</span></div>
            <div className="smb-gap-stat blue"><strong>{result.surplusCount}</strong><span>Surplus</span></div>
            <div className="smb-gap-stat violet"><strong>{result.totalRequired}</strong><span>Required</span></div>
          </div>
        </div>
        <div className="smb-readiness-bar-wrap">
          <div className="smb-readiness-bar-track">
            <div className={`smb-readiness-bar-fill ${result.readinessScore >= 70 ? 'mint' : result.readinessScore >= 45 ? 'yellow' : 'coral'}`} style={{ width: `${result.readinessScore}%` }} />
          </div>
          <div className="smb-readiness-bar-markers">
            <span style={{ left: '0%' }}>0</span><span style={{ left: '50%' }}>50%</span><span style={{ left: '70%' }}>Ready</span><span style={{ left: '100%' }}>100%</span>
          </div>
        </div>
      </div>

      {result.matched.length > 0 && (
        <div className="smb-report-section">
          <div className="smb-report-section-head mint"><CheckCircle2 size={15} /><h4>Matched skills <span>({result.matched.length})</span></h4></div>
          <div className="smb-report-table">
            <div className="smb-report-table-head"><span>Skill</span><span>Required</span><span>Learner</span><span>Status</span><span>Priority</span></div>
            {result.matched.map((m, i) => (
              <div className="smb-report-row" key={i}>
                <span className="smb-report-skill">{m.skillName}</span>
                <span className="smb-level-chip">{m.requiredLevel || '—'}</span>
                <span className="smb-level-chip learner">{m.learnerLevel || '—'}</span>
                <span className={`smb-gap-status-pill ${m.levelGap <= 0 ? 'mint' : 'yellow'}`}>{levelGapLabel(m.levelGap)}</span>
                <span className={`smb-req-tag ${m.requirement === 'required' ? 'coral' : m.requirement === 'preferred' ? 'blue' : 'yellow'}`}>{m.requirement}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.gaps.length > 0 && (
        <div className="smb-report-section">
          <div className="smb-report-section-head coral"><XCircle size={15} /><h4>Skill gaps <span>({result.gaps.length})</span></h4></div>
          <div className="smb-report-table">
            <div className="smb-report-table-head"><span>Missing skill</span><span>Required level</span><span>Priority</span><span>Action</span></div>
            {result.gaps.map((g, i) => (
              <div className="smb-report-row gap-row" key={i}>
                <span className="smb-report-skill"><XCircle size={12} className="smb-gap-icon" />{g.skillName}</span>
                <span className="smb-level-chip">{g.requiredLevel || '—'}</span>
                <span className={`smb-req-tag ${g.requirement === 'required' ? 'coral' : g.requirement === 'preferred' ? 'blue' : 'yellow'}`}>{g.priorityLabel || g.requirement}</span>
                <button className="smb-find-course-btn" onClick={onRecommend}><TrendingUp size={11} /> Find training</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.surplus.length > 0 && (
        <div className="smb-report-section">
          <button className="smb-report-section-head blue smb-collapsible" onClick={() => setExpand(p => !p)}>
            <Sparkles size={15} /><h4>Surplus skills <span>({result.surplus.length})</span></h4>
            <ChevronDown size={14} className={`smb-chevron ${expandSurplus ? 'open' : ''}`} />
          </button>
          {expandSurplus && (
            <div className="smb-surplus-chips">
              {result.surplus.map((s, i) => (
                <span key={i} className="smb-skill-pill blue"><span>{s.skillName}</span>{s.level && <em>{s.level}</em>}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {result.calculatedAt && <p className="smb-calc-time">Calculated at {new Date(result.calculatedAt).toLocaleTimeString()}</p>}
    </div>
  )
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
const TABS = [
  { id: 'normalize', label: 'Normalization lab',  icon: FlaskConical },
  { id: 'match',     label: 'Skill matcher',       icon: GitCompareArrows },
  { id: 'gap',       label: 'Gap report',          icon: Gauge },
  { id: 'recommend', label: 'Course recommend',    icon: Lightbulb },
]

export default function SkillMatchingDashboard() {
  const [activeTab,   setActiveTab]   = useState('normalize')
  const [matchResult, setMatchResult] = useState(null)

  const handleMatch = useCallback(result => { setMatchResult(result); setActiveTab('gap') }, [])

  const tabs = TABS.map(t => ({
    ...t,
    badge: t.id === 'gap' && matchResult ? '!' : t.id === 'recommend' && matchResult?.gaps?.length ? matchResult.gaps.length : null,
  }))

  return (
    <div className="smb-shell">
      <div className="smb-header">
        <div className="smb-header-left">
          <div className="smb-header-icon"><Sparkles size={19} /></div>
          <div><p className="smb-kicker">PHASE B9–B11</p><h1>Skill matching &amp; course recommendations</h1></div>
        </div>
        <div className="smb-header-right">
          <div className="smb-pipeline-flow">
            {['Raw variants','Normalize','Match','Skill Gap','Recommend'].map((step, i, arr) => (
              <span key={step} className="smb-pipeline-step-wrap">
                <span className={`smb-pipeline-step ${i % 2 === 0 ? 'filled' : 'arrow'}`}>{step}</span>
                {i < arr.length - 1 && <ArrowRight size={12} className="smb-pipeline-arrow" />}
              </span>
            ))}
          </div>
        </div>
      </div>

      <TabBar tabs={tabs} active={activeTab} onChange={setActiveTab} />

      <div className="smb-panel">
        {activeTab === 'normalize' && <NormalizationLab />}
        {activeTab === 'match'     && <SkillMatcherPanel onResult={handleMatch} />}
        {activeTab === 'gap'       && (
          matchResult
            ? <GapReport result={matchResult} onRecommend={() => setActiveTab('recommend')} />
            : (
              <div className="smb-gap-placeholder">
                <Target size={40} strokeWidth={1.2} />
                <h3>No match result yet</h3>
                <p>Go to the <strong>Skill matcher</strong> tab, add required and current skills, and click <strong>Run skill match</strong>.</p>
                <button className="smb-primary-btn" onClick={() => setActiveTab('match')}><GitCompareArrows size={15} /> Open skill matcher</button>
              </div>
            )
        )}
        {activeTab === 'recommend' && (
          <RecommendationEnginePanel key={matchResult ? 'from-gaps' : 'empty'} initialGaps={matchResult?.gaps || []} />
        )}
      </div>
    </div>
  )
}
