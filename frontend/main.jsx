import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import App from './App.jsx'
import { AuthGate } from './components/AuthGate.jsx'
import StudentDashboard from './components/StudentDashboard.jsx'
import TrainingDashboard from './components/TrainingDashboard.jsx'
import IndustryDashboard from './components/IndustryDashboard.jsx'
import './styles.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<AuthGate><App /></AuthGate>} />
        <Route path="/" element={<AuthGate><App /></AuthGate>} />
        <Route path="/student" element={<AuthGate><StudentDashboard /></AuthGate>} />
        <Route path="/training" element={<AuthGate><TrainingDashboard /></AuthGate>} />
        <Route path="/industry" element={<AuthGate><IndustryDashboard /></AuthGate>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
