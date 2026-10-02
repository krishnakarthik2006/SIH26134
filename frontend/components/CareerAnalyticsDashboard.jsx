import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft, BrainCircuit, ChartNoAxesCombined, Database, Play,
  RefreshCw, Search, ShieldCheck, AlertTriangle, BarChart3, GitBranch,
  Layers, SlidersHorizontal, TrendingUp,
} from 'lucide-react'
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer,
  Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
  RadarChart, PolarGrid, PolarAngleAxis, Radar,
} from 'recharts'
import { useNavigate } from 'react-router-dom'
import { getCareerAnalytics, getCareerEda, predictCareerEducation } from '../api.js'
import './career-analytics.css'

// ── Colour palette ────────────────────────────────────────────────────────────
const BAND_COLORS = {
  'Secondary / certificate': '#5576a8',
  'Undergraduate':           '#19736c',
  'Graduate / professional': '#c59a34',
  'Advanced professional':   '#d1764b',
}
const BAND_ORDER = ['Secondary / certificate', 'Undergraduate', 'Graduate / professional', 'Advanced professional']
const BAND_SHORT = {
  'Secondary / certificate': 'Secondary',
  'Undergraduate':           'Undergrad',
  'Graduate / professional': 'Graduate',
  'Advanced professional':   'Advanced',
}
const MODEL_COLORS = {
  'Random Forest':     '#19736c',
  'Gradient Boosting': '#d1764b',
  'Majority baseline': '#8b929e',
}

// ── Small reusable components ─────────────────────────────────────────────────
function Metric({ icon: Icon, label, value, note }) {
  return (
    <div className="ca-metric">
      <span><Icon size={17} /></span>
      <small>{label}</small>
      <strong>{value}</strong>
      <em>{note}</em>
    </div>
  )
}

function SectionHeading({ eyebrow, title, meta }) {
  return (
    <div className="ca-section-heading">
      <div>
        <p className="ca-eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      {meta && <span>{meta}</span>}
    </div>
  )
}

// ── Custom tooltip helpers ────────────────────────────────────────────────────
function ScatterTip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d) return null
  return (
    <div className="ca-tooltip">
      <strong>{d.title}</strong>
      <span>{d.band}</span>
      <div>Importance: {d.meanImportance} · Level: {d.meanLevel}</div>
      <div>Software tools: {d.softwareCount}</div>
    </div>
  )
}

function HeatmapTip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d) return null
  const color = d.r >= 0.7 ? '#19736c' : d.r <= -0.4 ? '#d1764b' : '#526168'
  return (
    <div className="ca-tooltip">
      <strong>{d.x}</strong> vs <strong>{d.y}</strong>
      <div style={{ color }}>Pearson r = {d.r}</div>
    </div>
  )
}

function BoxTip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d) return null
  return (
    <div className="ca-tooltip">
      <strong>{d.band}</strong>
      <div>Min {d.min} · Q1 {d.q1} · Median {d.median}</div>
      <div>Q3 {d.q3} · Max {d.max}</div>
      <div>Outliers: {d.outlierCount} / {d.outlierCount + (d.q3 - d.q1 > 0 ? '?' : 0)}</div>
    </div>
  )
}

// ── Correlation heatmap cell (custom shape for Recharts ScatterChart) ─────────
function HeatCell(props) {
  const { cx, cy, payload } = props
  if (!payload) return null
  const r = payload.r ?? 0
  const intensity = Math.abs(r)
  let bg
  if (r > 0) {
    const g = Math.round(115 + (1 - intensity) * 90)
    bg = `rgb(25, ${g}, 108)`
  } else {
    const rr = Math.round(180 + intensity * 70)
    bg = `rgb(${rr}, 80, 60)`
  }
  const size = 40
  return (
    <g>
      <rect x={cx - size / 2} y={cy - size / 2} width={size} height={size}
        fill={bg} fillOpacity={0.15 + intensity * 0.8} rx={3} />
      <text x={cx} y={cy + 4} textAnchor="middle" fontSize={9} fill="#2b3a40"
        fontWeight={Math.abs(r) > 0.5 ? '700' : '400'}>
        {r.toFixed(2)}
      </text>
    </g>
  )
}

// ── Confusion matrix component ────────────────────────────────────────────────
function ConfusionMatrix({ cells, modelName }) {
  if (!cells?.length) return null
  // Build row-normalised percentages
  const rowTotals = {}
  for (const { actual, count } of cells) {
    rowTotals[actual] = (rowTotals[actual] || 0) + count
  }
  return (
    <div className="ca-cm-wrap">
      <p className="ca-cm-ylabel">Actual →</p>
      <div className="ca-cm-grid" style={{ gridTemplateColumns: `80px repeat(${BAND_ORDER.length}, 1fr)` }}>
        {/* header row */}
        <div className="ca-cm-corner">
          <span>Actual ↓</span><span>Predicted →</span>
        </div>
        {BAND_ORDER.map(b => (
          <div key={b} className="ca-cm-header" title={b}>
            {BAND_SHORT[b]}
          </div>
        ))}
        {/* data rows */}
        {BAND_ORDER.map(actual => (
          <>
            <div key={`row-${actual}`} className="ca-cm-rowlabel" title={actual}>
              {BAND_SHORT[actual]}
            </div>
            {BAND_ORDER.map(predicted => {
              const cell = cells.find(c => c.actual === actual && c.predicted === predicted)
              const count = cell?.count ?? 0
              const total = rowTotals[actual] || 1
              const pct = count / total
              const isDiag = actual === predicted
              return (
                <div
                  key={`${actual}-${predicted}`}
                  className={`ca-cm-cell ${isDiag ? 'ca-cm-diag' : ''}`}
                  style={{ opacity: 0.18 + pct * 0.82 }}
                  title={`${actual} → ${predicted}: ${count} (${(pct * 100).toFixed(0)}%)`}
                >
                  <strong>{count}</strong>
                  <small>{(pct * 100).toFixed(0)}%</small>
                </div>
              )
            })}
          </>
        ))}
      </div>
    </div>
  )
}

// ── Wrangling steps panel ─────────────────────────────────────────────────────
function WranglingPanel({ wrangling }) {
  if (!wrangling) return null
  const stats = [
    { label: 'Total records',     value: wrangling.totalOccupationRows?.toLocaleString() },
    { label: 'Labeled',           value: wrangling.labeledOccupations?.toLocaleString() },
    { label: 'Excluded (no edu)', value: wrangling.excludedNoEducationLabel?.toLocaleString() },
    { label: 'Skill rows kept',   value: wrangling.skillRowsRetained?.toLocaleString() },
    { label: 'Importance mean',   value: wrangling.importanceStats?.mean },
    { label: 'Importance std',    value: wrangling.importanceStats?.std },
    { label: 'Level mean',        value: wrangling.levelStats?.mean },
    { label: 'Level std',         value: wrangling.levelStats?.std },
  ]
  return (
    <article className="ca-panel ca-wrangling-panel">
      <h3>Data wrangling pipeline</h3>
      <p>Applied before exploration, training, holdout evaluation, and prediction.</p>
      <div className="ca-wrangling-stats">
        {stats.map(s => (
          <div key={s.label} className="ca-wrangling-stat">
            <span>{s.label}</span>
            <strong>{s.value ?? '—'}</strong>
          </div>
        ))}
      </div>
      <ol className="ca-wrangling-steps">
        {(wrangling.steps || []).map((step, i) => (
          <li key={i}><span>{String(i + 1).padStart(2, '0')}</span>{step}</li>
        ))}
      </ol>
    </article>
  )
}

// ── Main dashboard ────────────────────────────────────────────────────────────
export default function CareerAnalyticsDashboard() {
  const navigate = useNavigate()
  const [overview, setOverview] = useState(null)
  const [eda, setEda] = useState(null)
  const [query, setQuery] = useState('')
  const [selectedCode, setSelectedCode] = useState('')
  const [prediction, setPrediction] = useState(null)
  const [loadingOverview, setLoadingOverview] = useState(true)
  const [loadingEda, setLoadingEda] = useState(true)
  const [predicting, setPredicting] = useState(false)
  const [error, setError] = useState('')
  const [activeModel, setActiveModel] = useState('Random Forest')

  const loadOverview = async () => {
    setLoadingOverview(true)
    setError('')
    try {
      const result = await getCareerAnalytics()
      setOverview(result)
      const suggested = result.occupations?.find(o => o.title === 'Software Developers') || result.occupations?.[0]
      setSelectedCode(suggested?.socCode || '')
    } catch (err) {
      setError(err?.response?.data?.error || err?.response?.data?.detail || 'Could not load career analytics. Ensure the Python service and dataset are available.')
    } finally {
      setLoadingOverview(false)
    }
  }

  const loadEda = async () => {
    setLoadingEda(true)
    try {
      const result = await getCareerEda()
      setEda(result)
    } catch {
      // non-fatal — overview still shows
    } finally {
      setLoadingEda(false)
    }
  }

  const reload = () => { loadOverview(); loadEda() }
  useEffect(() => { loadOverview(); loadEda() }, [])

  const occupations = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return overview?.occupations || []
    return (overview?.occupations || []).filter(o =>
      `${o.title} ${o.socCode}`.toLowerCase().includes(term)
    )
  }, [overview, query])

  const runPrediction = async () => {
    if (!selectedCode) return
    setPredicting(true)
    setError('')
    try {
      setPrediction(await predictCareerEducation(selectedCode))
    } catch (err) {
      setError(err?.response?.data?.error || err?.response?.data?.detail || 'Prediction failed. Please retry.')
    } finally {
      setPredicting(false)
    }
  }

  const loading = loadingOverview

  // Derived data
  const distribution = (overview?.educationDistribution || []).map(item => ({
    ...item,
    color: BAND_COLORS[item.label] || '#8b929e',
    shortLabel: BAND_SHORT[item.label] || item.label,
  }))
  const metrics   = overview?.models || []
  const topSkills = overview?.topSkills || []
  const topSoftware = overview?.topSoftware || []

  // EDA-derived
  const scatterData  = (eda?.eda?.scatter || [])
  const corrMatrix   = (eda?.eda?.correlationMatrix || [])
  const corrFeatures = (eda?.eda?.correlationFeatures || [])
  const boxData      = (eda?.eda?.boxPlot || []).map(b => ({
    ...b, shortBand: BAND_SHORT[b.band] || b.band,
  }))
  const skillByBand      = (eda?.eda?.skillByBand || []).map(row => ({
    ...row,
    skill: row.skill?.length > 22 ? row.skill.slice(0, 22) + '…' : row.skill,
  }))
  const swHistogram      = eda?.eda?.softwareHistogram || []
  const featureImps      = eda?.featureImportances?.[activeModel] || []
  const confusionMatData = eda?.confusionMatrices?.[activeModel] || []
  const wrangling        = eda?.wrangling

  // Scatter: group by band for multi-series
  const scatterByBand = BAND_ORDER.map(band => ({
    band,
    color: BAND_COLORS[band],
    data: scatterData.filter(p => p.band === band),
  }))

  // Model comparison bar chart data
  const comparisonBarData = metrics.filter(m => m.name !== 'Majority baseline').map(m => ({
    name: m.name,
    Accuracy:        +(m.accuracy * 100).toFixed(1),
    'Balanced Acc.': +(m.balancedAccuracy * 100).toFixed(1),
    'Macro F1':      +(m.macroF1 * 100).toFixed(1),
    'CV Macro F1':   +(m.crossValidationMacroF1 * 100).toFixed(1),
  }))
  const baselineM = metrics.find(m => m.name === 'Majority baseline')

  return (
    <main className="career-analytics-page">
      {/* ── Top bar ── */}
      <header className="ca-topbar">
        <button type="button" className="ca-back" onClick={() => navigate('/')} aria-label="Back">
          <ArrowLeft size={17} />
        </button>
        <div><strong>SkillSync</strong><span>Career analytics</span></div>
        <button type="button" className="ca-refresh" onClick={reload} disabled={loading} aria-label="Refresh">
          <RefreshCw size={16} className={loading ? 'ca-spin-icon' : ''} />
        </button>
      </header>

      <div className="ca-content">
        {/* ── Page heading ── */}
        <section className="ca-page-heading">
          <div>
            <p className="ca-eyebrow">DATA ANALYTICS · EDA · MODEL COMPARISON</p>
            <h1>Career patterns and education prediction</h1>
            <p>
              1,016 O*NET-style occupation records · preprocessing &amp; wrangling ·
              exploratory analysis · two ML classifiers vs. majority baseline · interactive prediction.
            </p>
          </div>
          <span className="ca-status"><i />Reproducible evaluation · seed 42</span>
        </section>

        {error && (
          <div className="ca-error" role="alert">
            <AlertTriangle size={16} />
            <span>{error}</span>
            <button type="button" onClick={reload}>Retry</button>
          </div>
        )}
        {loading && (
          <div className="ca-loading"><span />Preparing dataset and evaluating models…</div>
        )}

        {!loading && overview && (
          <>
            {/* ── KPI metrics ── */}
            <section className="ca-metrics">
              <Metric icon={Database}          label="Occupation records"  value={overview.dataset.occupationRecords.toLocaleString()} note="Raw dataset" />
              <Metric icon={ShieldCheck}        label="Labeled records"     value={overview.dataset.labeledRecords.toLocaleString()} note={`${overview.dataset.excludedMissingEducation} without education target`} />
              <Metric icon={ChartNoAxesCombined} label="Model features"    value={overview.dataset.featureCount.toLocaleString()} note="Skill + tool features" />
              <Metric icon={BrainCircuit}        label="Held-out records"   value={overview.dataset.testRecords.toLocaleString()} note="Stratified 20% test split" />
            </section>

            {/* ══════════════════════════════════════════════════════════
                SECTION 01 · PREPROCESSING & WRANGLING
            ══════════════════════════════════════════════════════════ */}
            <section className="ca-section">
              <SectionHeading
                eyebrow="01 · PREPROCESSING & WRANGLING"
                title="How the data was prepared"
                meta={`${overview.dataset.skillSourceRows.toLocaleString()} skill rows · ${overview.dataset.softwareSourceRows.toLocaleString()} software rows`}
              />
              <div className="ca-chart-grid ca-chart-grid-3">
                <WranglingPanel wrangling={wrangling} />

                {/* Skill importance stats bar */}
                <article className="ca-panel">
                  <h3>Skill importance distribution</h3>
                  <p>IM-scale (1–5) value spread across {overview.dataset.skillSourceRows.toLocaleString()} retained rows.</p>
                  {wrangling && (
                    <div className="ca-stat-rows">
                      {[
                        ['Min',    wrangling.importanceStats?.min],
                        ['Mean',   wrangling.importanceStats?.mean],
                        ['Median', wrangling.importanceStats?.median],
                        ['Max',    wrangling.importanceStats?.max],
                        ['Std dev',wrangling.importanceStats?.std],
                      ].map(([label, val]) => (
                        <div key={label} className="ca-stat-row">
                          <span>{label}</span>
                          <div className="ca-stat-bar-track">
                            <div className="ca-stat-bar-fill" style={{ width: `${Math.min((val / 5) * 100, 100)}%` }} />
                          </div>
                          <strong>{val}</strong>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ marginTop: 16 }}>
                    <h3 style={{ marginBottom: 8 }}>Skill level distribution</h3>
                    <p>LV-scale (0.5–7) value spread.</p>
                    {wrangling && (
                      <div className="ca-stat-rows">
                        {[
                          ['Min',    wrangling.levelStats?.min],
                          ['Mean',   wrangling.levelStats?.mean],
                          ['Median', wrangling.levelStats?.median],
                          ['Max',    wrangling.levelStats?.max],
                          ['Std dev',wrangling.levelStats?.std],
                        ].map(([label, val]) => (
                          <div key={label} className="ca-stat-row">
                            <span>{label}</span>
                            <div className="ca-stat-bar-track">
                              <div className="ca-stat-bar-fill ca-stat-bar-level" style={{ width: `${Math.min((val / 7) * 100, 100)}%` }} />
                            </div>
                            <strong>{val}</strong>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </article>

                {/* Software tools histogram */}
                <article className="ca-panel">
                  <h3>Software tools per occupation</h3>
                  <p>Distribution of how many software tools each occupation mentions.</p>
                  <div className="ca-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={swHistogram} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                        <CartesianGrid vertical={false} stroke="#e9ecec" />
                        <XAxis dataKey="range" tick={{ fontSize: 11, fill: '#64707b' }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#64707b' }} />
                        <Tooltip formatter={v => [v, 'Occupations']} />
                        <Bar dataKey="count" fill="#5576a8" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </article>
              </div>
            </section>

            {/* ══════════════════════════════════════════════════════════
                SECTION 02 · EXPLORATORY DATA ANALYSIS
            ══════════════════════════════════════════════════════════ */}
            <section className="ca-section">
              <SectionHeading
                eyebrow="02 · EXPLORATORY DATA ANALYSIS"
                title="What is in the data"
                meta={`${scatterData.length} scatter points (200-sample) · 6×6 correlation matrix`}
              />

              <div className="ca-chart-grid">
                {/* Education band distribution */}
                <article className="ca-panel">
                  <h3>Required education band distribution</h3>
                  <p>Dominant band per labeled occupation, derived from summed reported category values.</p>
                  <div className="ca-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={distribution} margin={{ top: 8, right: 8, bottom: 30, left: 0 }}>
                        <CartesianGrid vertical={false} stroke="#e9ecec" />
                        <XAxis dataKey="shortLabel" interval={0} angle={-14} textAnchor="end" height={55} tick={{ fontSize: 10, fill: '#64707b' }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#64707b' }} />
                        <Tooltip formatter={(v, _n, item) => [`${v} occupations (${item.payload.percent}%)`, 'Count']} />
                        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                          {distribution.map(item => <Cell key={item.label} fill={item.color} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </article>

                {/* Top skills bar */}
                <article className="ca-panel">
                  <h3>Most important essential skills</h3>
                  <p>Mean reported importance (1–5) across occupations that have a rating for each skill.</p>
                  <div className="ca-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={topSkills.slice(0, 8)} layout="vertical" margin={{ top: 5, right: 18, bottom: 0, left: 8 }}>
                        <CartesianGrid horizontal={false} stroke="#e9ecec" />
                        <XAxis type="number" domain={[0, 5]} tick={{ fontSize: 10, fill: '#64707b' }} />
                        <YAxis type="category" dataKey="name" width={145} tick={{ fontSize: 10, fill: '#43505a' }} />
                        <Tooltip formatter={(v, _n, item) => [`${v} / 5 · ${item.payload.occupationCount} occupations`, 'Mean importance']} />
                        <Bar dataKey="meanImportance" fill="#19736c" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </article>

                {/* Scatter: mean importance vs mean level */}
                <article className="ca-panel">
                  <h3>Importance vs. level by education band</h3>
                  <p>Each point is one occupation (200-occupation random sample). Colour = education band.</p>
                  <div className="ca-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <ScatterChart margin={{ top: 8, right: 12, bottom: 20, left: 0 }}>
                        <CartesianGrid stroke="#e9ecec" />
                        <XAxis type="number" dataKey="meanImportance" name="Mean Importance" domain={[0, 5]}
                          label={{ value: 'Mean Importance', position: 'insideBottom', offset: -8, fontSize: 9, fill: '#7d888e' }}
                          tick={{ fontSize: 9, fill: '#64707b' }} />
                        <YAxis type="number" dataKey="meanLevel" name="Mean Level"
                          label={{ value: 'Mean Level', angle: -90, position: 'insideLeft', offset: 8, fontSize: 9, fill: '#7d888e' }}
                          tick={{ fontSize: 9, fill: '#64707b' }} />
                        <ZAxis range={[22, 22]} />
                        <Tooltip content={<ScatterTip />} />
                        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 9 }} />
                        {scatterByBand.map(({ band, color, data }) => (
                          <Scatter key={band} name={BAND_SHORT[band]} data={data} fill={color} fillOpacity={0.75} />
                        ))}
                      </ScatterChart>
                    </ResponsiveContainer>
                  </div>
                </article>

                {/* Correlation heatmap */}
                <article className="ca-panel">
                  <h3>Feature correlation matrix</h3>
                  <p>Pearson r between the 6 aggregate numeric features. Darker = stronger correlation.</p>
                  <div className="ca-corr-wrap">
                    {corrFeatures.length > 0 && corrMatrix.length > 0 ? (
                      <div className="ca-corr-grid" style={{ gridTemplateColumns: `90px repeat(${corrFeatures.length}, 1fr)` }}>
                        <div className="ca-corr-corner" />
                        {corrFeatures.map(f => <div key={f} className="ca-corr-header" title={f}>{f.split(' ').slice(-1)[0]}</div>)}
                        {corrFeatures.map((rowF, ri) => (
                          <>
                            <div key={`rl-${rowF}`} className="ca-corr-rowlabel" title={rowF}>{rowF}</div>
                            {corrFeatures.map((colF, ci) => {
                              const cell = corrMatrix.find(c => c.x === rowF && c.y === colF)
                              const r = cell?.r ?? 0
                              const intensity = Math.abs(r)
                              const isDiag = ri === ci
                              let bg = isDiag ? '#e8f4f2'
                                : r > 0
                                  ? `rgba(25, 115, 108, ${0.1 + intensity * 0.75})`
                                  : `rgba(209, 118, 75, ${0.1 + intensity * 0.75})`
                              return (
                                <div key={`${rowF}-${colF}`}
                                  className={`ca-corr-cell ${isDiag ? 'ca-corr-diag' : ''}`}
                                  style={{ background: bg }}
                                  title={`${rowF} × ${colF} = ${r}`}>
                                  <span>{isDiag ? '1.00' : r.toFixed(2)}</span>
                                </div>
                              )
                            })}
                          </>
                        ))}
                      </div>
                    ) : (
                      <p className="ca-panel-empty">Loading correlation data…</p>
                    )}
                    <div className="ca-corr-legend">
                      <span className="ca-corr-pos">■ Positive</span>
                      <span className="ca-corr-neg">■ Negative</span>
                      <span className="ca-corr-diag-label">■ Diagonal = 1.00</span>
                    </div>
                  </div>
                </article>

                {/* Box plots */}
                <article className="ca-panel">
                  <h3>Mean importance distribution per band</h3>
                  <p>Box plot showing Q1–Q3 interquartile range, median, and IQR-based outlier counts.</p>
                  <div className="ca-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={boxData} margin={{ top: 8, right: 12, bottom: 20, left: 0 }}>
                        <CartesianGrid vertical={false} stroke="#e9ecec" />
                        <XAxis dataKey="shortBand" tick={{ fontSize: 10, fill: '#64707b' }} />
                        <YAxis domain={[0, 5]} tick={{ fontSize: 10, fill: '#64707b' }} />
                        <Tooltip
                          formatter={(v, name) => [v, name]}
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null
                            const d = payload[0]?.payload
                            return (
                              <div className="ca-tooltip">
                                <strong>{d.band}</strong>
                                <div>Min {d.min} · Q1 {d.q1}</div>
                                <div>Median {d.median} · Q3 {d.q3} · Max {d.max}</div>
                                <div>Outliers: {d.outlierCount}</div>
                              </div>
                            )
                          }}
                        />
                        <Bar dataKey="q1" stackId="box" fill="transparent" />
                        <Bar dataKey="median" stackId="box" fill="#19736c" opacity={0.85} radius={[0, 0, 0, 0]}
                          label={{ position: 'top', fontSize: 9, fill: '#19736c', formatter: v => v }} />
                        <Bar dataKey="q3" stackId="box" fill="#c5deda" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  {boxData.length > 0 && (
                    <div className="ca-outlier-badges">
                      {boxData.map(b => (
                        <span key={b.band} className="ca-outlier-badge" title={b.band}>
                          <AlertTriangle size={10} />
                          {BAND_SHORT[b.band]}: {b.outlierCount} outlier{b.outlierCount !== 1 ? 's' : ''}
                        </span>
                      ))}
                    </div>
                  )}
                </article>

                {/* Skill importance by band */}
                <article className="ca-panel">
                  <h3>Top skills by education band</h3>
                  <p>Mean importance (1–5) of the top 6 skills, broken out by education band.</p>
                  <div className="ca-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={skillByBand} margin={{ top: 8, right: 8, bottom: 40, left: 0 }}>
                        <CartesianGrid vertical={false} stroke="#e9ecec" />
                        <XAxis dataKey="skill" interval={0} angle={-20} textAnchor="end" height={60} tick={{ fontSize: 9, fill: '#64707b' }} />
                        <YAxis domain={[0, 5]} tick={{ fontSize: 10, fill: '#64707b' }} />
                        <Tooltip />
                        <Legend iconSize={8} wrapperStyle={{ fontSize: 9 }} />
                        {BAND_ORDER.map(band => (
                          <Bar key={band} dataKey={band} name={BAND_SHORT[band]}
                            fill={BAND_COLORS[band]} radius={[2, 2, 0, 0]} />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </article>

                {/* Common software tools */}
                <article className="ca-panel">
                  <h3>Common software and tools</h3>
                  <p>Occupations listing each tool, with hot-technology and in-demand indicators.</p>
                  <div className="ca-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={topSoftware.slice(0, 8)} layout="vertical" margin={{ top: 5, right: 18, bottom: 0, left: 8 }}>
                        <CartesianGrid horizontal={false} stroke="#e9ecec" />
                        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: '#64707b' }} />
                        <YAxis type="category" dataKey="name" width={142} tick={{ fontSize: 10, fill: '#43505a' }} />
                        <Tooltip formatter={(v, _n, item) => [`${v} occupations · ${item.payload.hotCount} hot · ${item.payload.inDemandCount} in demand`, 'Usage']} />
                        <Bar dataKey="occupationCount" fill="#c2774e" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </article>
              </div>
            </section>

            {/* ══════════════════════════════════════════════════════════
                SECTION 03 · SUPERVISED LEARNING — MODEL COMPARISON
            ══════════════════════════════════════════════════════════ */}
            <section className="ca-section">
              <SectionHeading
                eyebrow="03 · SUPERVISED LEARNING"
                title="Compare model performance"
                meta="Same stratified holdout · fixed random seed 42"
              />

              {/* Metrics bar chart */}
              <article className="ca-panel" style={{ marginBottom: 12 }}>
                <h3>Side-by-side metric comparison</h3>
                <p>Random Forest vs. Gradient Boosting across four evaluation metrics (%).</p>
                <div className="ca-chart ca-chart-tall">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={comparisonBarData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                      <CartesianGrid vertical={false} stroke="#e9ecec" />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64707b' }} />
                      <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 10, fill: '#64707b' }} />
                      <Tooltip formatter={v => [`${v}%`]} />
                      <Legend iconSize={10} wrapperStyle={{ fontSize: 10 }} />
                      <Bar dataKey="Accuracy"        fill="#19736c" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="Balanced Acc."   fill="#5576a8" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="Macro F1"        fill="#c59a34" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="CV Macro F1"     fill="#d1764b" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {baselineM && (
                  <div className="ca-baseline-note">
                    Majority baseline accuracy: <strong>{(baselineM.accuracy * 100).toFixed(1)}%</strong> ·
                    Macro F1: <strong>{(baselineM.macroF1 * 100).toFixed(1)}%</strong>
                    <em> — both trained models significantly exceed this baseline.</em>
                  </div>
                )}
              </article>

              {/* Full metrics table */}
              <div className="ca-panel ca-table-wrap">
                <table className="ca-model-table">
                  <thead>
                    <tr><th>Model</th><th>Accuracy</th><th>Balanced accuracy</th><th>Macro F1</th><th>5-fold CV Macro F1</th><th>Test records</th></tr>
                  </thead>
                  <tbody>
                    {metrics.map(model => (
                      <tr key={model.name}>
                        <th><i style={{ background: MODEL_COLORS[model.name] || '#66717a' }} />{model.name}</th>
                        <td>{(model.accuracy * 100).toFixed(1)}%</td>
                        <td>{(model.balancedAccuracy * 100).toFixed(1)}%</td>
                        <td>{(model.macroF1 * 100).toFixed(1)}%</td>
                        <td>{(model.crossValidationMacroF1 * 100).toFixed(1)}% <small>± {(model.crossValidationStd * 100).toFixed(1)}</small></td>
                        <td>{model.testRecords}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="ca-evaluation-note">Accuracy = overall correctness; balanced accuracy and macro F1 weight each band equally. Cross-validation runs on training data only.</p>
                <details className="ca-classwise">
                  <summary>View per-band precision, recall, F1, and support</summary>
                  <div className="ca-classwise-scroll">
                    <table className="ca-model-table">
                      <thead><tr><th>Model</th><th>Education band</th><th>Precision</th><th>Recall</th><th>F1</th><th>Support</th></tr></thead>
                      <tbody>
                        {metrics.flatMap(model =>
                          model.perBand.map(band => (
                            <tr key={`${model.name}-${band.label}`}>
                              <th>{model.name}</th><td>{band.label}</td>
                              <td>{(band.precision * 100).toFixed(1)}%</td>
                              <td>{(band.recall * 100).toFixed(1)}%</td>
                              <td>{(band.f1 * 100).toFixed(1)}%</td>
                              <td>{band.support}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </details>
              </div>
            </section>

            {/* ══════════════════════════════════════════════════════════
                SECTION 04 · FEATURE IMPORTANCE & CONFUSION MATRIX
            ══════════════════════════════════════════════════════════ */}
            <section className="ca-section">
              <SectionHeading
                eyebrow="04 · MODEL INTERNALS"
                title="Feature importance and confusion matrix"
                meta="Select a model to inspect"
              />

              {/* Model selector tabs */}
              <div className="ca-model-tabs">
                {['Random Forest', 'Gradient Boosting', 'Majority baseline'].map(name => (
                  <button
                    key={name}
                    type="button"
                    className={`ca-model-tab ${activeModel === name ? 'active' : ''}`}
                    style={activeModel === name ? { borderColor: MODEL_COLORS[name], color: MODEL_COLORS[name] } : {}}
                    onClick={() => setActiveModel(name)}
                  >
                    <span style={{ background: MODEL_COLORS[name] }} />
                    {name}
                  </button>
                ))}
              </div>

              <div className="ca-internals-grid">
                {/* Feature importance */}
                <article className="ca-panel">
                  <h3>Top 15 feature importances — {activeModel}</h3>
                  <p>Gini impurity-based importance from the fitted {activeModel} model (% of total).</p>
                  {featureImps.length > 0 ? (
                    <div className="ca-chart ca-chart-tall">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={featureImps.slice(0, 15)}
                          layout="vertical"
                          margin={{ top: 5, right: 55, bottom: 0, left: 8 }}
                        >
                          <CartesianGrid horizontal={false} stroke="#e9ecec" />
                          <XAxis type="number" unit="%" tick={{ fontSize: 9, fill: '#64707b' }} />
                          <YAxis type="category" dataKey="label" width={148} tick={{ fontSize: 9, fill: '#43505a' }} />
                          <Tooltip formatter={v => [`${v}%`, 'Importance']} />
                          <Bar dataKey="percent" fill={MODEL_COLORS[activeModel] || '#19736c'} radius={[0, 4, 4, 0]}>
                            {featureImps.slice(0, 15).map((_, i) => (
                              <Cell key={i} fillOpacity={1 - i * 0.04} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <p className="ca-panel-empty">
                      {activeModel === 'Majority baseline'
                        ? 'The majority-class baseline does not use features — it always predicts the most frequent class.'
                        : loadingEda ? 'Loading feature importances…' : 'No importance data available.'}
                    </p>
                  )}
                </article>

                {/* Confusion matrix */}
                <article className="ca-panel">
                  <h3>Confusion matrix — {activeModel}</h3>
                  <p>Rows = actual label · columns = predicted label · cell = count and row %. Diagonal = correct predictions.</p>
                  {confusionMatData.length > 0
                    ? <ConfusionMatrix cells={confusionMatData} modelName={activeModel} />
                    : <p className="ca-panel-empty">{loadingEda ? 'Loading…' : 'No data.'}</p>}
                </article>
              </div>
            </section>

            {/* ══════════════════════════════════════════════════════════
                SECTION 05 · INTERACTIVE PREDICTION
            ══════════════════════════════════════════════════════════ */}
            <section className="ca-section ca-predictor-section">
              <SectionHeading
                eyebrow="05 · INTERACTIVE PREDICTION"
                title="Estimate an occupation's education band"
                meta="Both trained models · full labeled cohort"
              />

              <div className="ca-predictor ca-panel">
                <div className="ca-predict-controls">
                  <label className="ca-search">
                    <Search size={16} />
                    <input
                      value={query}
                      onChange={e => setQuery(e.target.value)}
                      placeholder="Filter occupations by title or code"
                    />
                  </label>
                  <label className="ca-occupation-select">
                    Occupation
                    <select value={selectedCode} onChange={e => { setSelectedCode(e.target.value); setPrediction(null) }}>
                      <option value="">Select an occupation</option>
                      {occupations.map(o => (
                        <option key={o.socCode} value={o.socCode}>{o.title} · {o.socCode}</option>
                      ))}
                    </select>
                  </label>
                  <button className="ca-predict-button" type="button"
                    disabled={!selectedCode || predicting} onClick={runPrediction}>
                    <Play size={15} />
                    {predicting ? 'Predicting…' : 'Compare predictions'}
                  </button>
                </div>

                {prediction && (
                  <div className="ca-prediction-results">
                    <div className="ca-observed">
                      <span>Observed education band</span>
                      <strong>{prediction.observedEducationBand}</strong>
                      <small>{prediction.occupation.title} · {prediction.occupation.socCode}</small>
                    </div>
                    <div className="ca-model-predictions">
                      {prediction.predictions.map((m, i) => (
                        <article className="ca-model-prediction" key={m.model}>
                          <div>
                            <span style={{ background: MODEL_COLORS[m.model] || '#8b929e' }} />
                            {m.model}
                          </div>
                          <strong style={{ color: m.prediction === prediction.observedEducationBand ? '#19736c' : '#d1764b' }}>
                            {m.prediction}
                            {m.prediction === prediction.observedEducationBand
                              ? <span className="ca-match-badge">✓ correct</span>
                              : <span className="ca-mismatch-badge">✗ differs</span>}
                          </strong>
                          <small>{m.confidence}% top-class confidence</small>
                          <div className="ca-probabilities">
                            {m.probabilities.map(item => (
                              <div key={item.label}>
                                <span title={item.label}>{BAND_SHORT[item.label] || item.label}</span>
                                <i><b style={{
                                  width: `${item.probability}%`,
                                  background: BAND_COLORS[item.label] || '#19736c',
                                }} /></i>
                                <em>{item.probability}%</em>
                              </div>
                            ))}
                          </div>
                        </article>
                      ))}
                    </div>
                    <p className="ca-disclaimer">{prediction.note}</p>
                  </div>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  )
}
