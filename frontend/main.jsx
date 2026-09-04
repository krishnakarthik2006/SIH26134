import { lazy, StrictMode, Suspense } from 'react'
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

function RouteFallback() {
  return <div className="route-fallback"><div className="route-spinner" /><strong>Loading workspace</strong><span>Preparing your intelligence view...</span></div>
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
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
        <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  </StrictMode>,
)
