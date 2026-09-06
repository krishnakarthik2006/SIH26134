import { Component, lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthGate } from './components/AuthGate.jsx'
import './styles.css'
import './finalization.css'

const App = lazy(() => import('./App.jsx'))
const StudentDashboard = lazy(() => import('./components/StudentDashboard.jsx'))
const TrainingDashboard = lazy(() => import('./components/TrainingDashboard.jsx'))
const IndustryDashboard = lazy(() => import('./components/IndustryDashboard.jsx'))
const GovernmentDashboard = lazy(() => import('./components/GovernmentDashboard.jsx'))
const AIIntelligence = lazy(() => import('./components/AIIntelligence.jsx'))
const AnalyticsDashboard = lazy(() => import('./components/AnalyticsDashboard.jsx'))
const ReportsCenter = lazy(() => import('./components/ReportsCenter.jsx'))
const SkillMatchingDashboard = lazy(() => import('./components/SkillMatchingDashboard.jsx'))
const RecommendationDashboard = lazy(() => import('./components/RecommendationDashboard.jsx'))

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }
  componentDidCatch(error, errorInfo) {
    console.error('App ErrorBoundary caught error:', error, errorInfo)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '3rem', maxWidth: '600px', margin: '3rem auto', background: '#fff', borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.1)', fontFamily: 'system-ui, sans-serif' }}>
          <h2 style={{ color: '#e11d48', marginTop: 0 }}>Application Error</h2>
          <p style={{ color: '#475569' }}>An unexpected error occurred in the workspace interface:</p>
          <pre style={{ background: '#f8fafc', padding: '1rem', borderRadius: '8px', overflowX: 'auto', fontSize: '0.85rem', color: '#0f172a', border: '1px solid #e2e8f0' }}>
            {this.state.error?.toString()}
          </pre>
          <button
            onClick={() => { localStorage.clear(); window.location.href = '/'; }}
            style={{ padding: '0.6rem 1.2rem', background: '#6450dc', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}
          >
            Reset Session & Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

function RouteFallback() {
  return <div className="route-fallback"><div className="route-spinner" /><strong>Loading workspace</strong><span>Preparing your intelligence view...</span></div>
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/login" element={<AuthGate><App /></AuthGate>} />
            <Route path="/" element={<AuthGate><App /></AuthGate>} />
            <Route path="/student" element={<AuthGate><StudentDashboard /></AuthGate>} />
            <Route path="/training" element={<AuthGate><TrainingDashboard /></AuthGate>} />
            <Route path="/industry" element={<AuthGate><IndustryDashboard /></AuthGate>} />
            <Route path="/government" element={<AuthGate><GovernmentDashboard /></AuthGate>} />
            <Route path="/intelligence" element={<AuthGate><AIIntelligence /></AuthGate>} />
            <Route path="/analytics" element={<AuthGate><AnalyticsDashboard /></AuthGate>} />
            <Route path="/reports" element={<AuthGate><ReportsCenter /></AuthGate>} />
            <Route path="/skill-matching" element={<AuthGate><SkillMatchingDashboard /></AuthGate>} />
            <Route path="/recommendations" element={<AuthGate><RecommendationDashboard /></AuthGate>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)

