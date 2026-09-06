# SkillSync — Maharashtra Skill Intelligence Platform

SIH 2026 · Project ID SIH26134

A full-stack workforce alignment platform connecting industry demand, training providers, learners, and government — built for Maharashtra.

---

## Prerequisites

| Tool | Minimum version | Install |
|------|----------------|---------|
| Node.js | 18+ | https://nodejs.org |
| Python | 3.10+ | https://python.org |
| MongoDB | 6+ | https://www.mongodb.com/try/download/community |

MongoDB must be running locally on the default port **27017** before you start the backend.

---

## Demo accounts (pre-seeded)

Run `node tests/seed-demo-data.mjs` once to create these accounts. Re-running is safe — it skips existing data.

### Industry partner — TechCorp Solutions
| Field | Value |
|-------|-------|
| Email | `abc@company.com` |
| Password | `Company@123` |
| Role | Industry partner |
| Dashboard | http://localhost:5173/industry |
| Pre-loaded | SDE job role with Java & C++ requirements + full job description |

### Learner — Arjun Kulkarni
| Field | Value |
|-------|-------|
| Email | `arjun@learner.com` |
| Password | `Learner@123` |
| Role | Learner |
| Dashboard | http://localhost:5173/student |
| Pre-loaded | Current skills: Python, JavaScript, DSA, Git · Target role: SDE · Readiness: 14% |

The gap between Arjun's skills and the SDE requirements (Java, C++ missing) is intentional — it demonstrates the skill gap analysis, AI recommendations, and learning roadmap features immediately on login.

---



```bash
# 1. Install Node.js dependencies
npm install

# 2. Install Python dependencies for the AI service
cd ai_service
pip install -r requirements.txt
cd ..

# 3. Copy environment variables
copy .env.example .env

# 4. Run the full stack
npm run dev
```

`npm run dev` starts **both** the Express backend (port 4000) and the Vite frontend (port 5173) concurrently.

---

## Running each service separately

### Backend (Express API — port 4000)

```bash
npm run server
```

### Frontend (Vite dev server — port 5173)

```bash
npm run client
```

### Python AI Service (FastAPI + Ollama llama3.2 — port 8000)

The AI service now uses **llama3.2:3b via local Ollama** for LLM-powered skill extraction.
If Ollama is unavailable it falls back to the built-in rule-based engine automatically.

**Step 1 — Start Ollama** (if not running as a system service):

```bash
ollama serve
```

**Step 2 — Start the AI service:**

```bash
cd ai_service
pip install -r requirements.txt
python run.py
```

Or directly:

```bash
cd ai_service
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```
cd ai_service
python run.py
```

---

## Production build

```bash
# Build the frontend
npm run build

# Preview the production build
npm run preview
```

---

## Environment variables

Copy `.env.example` to `.env` and fill in your values:

```env
# Backend
PORT=4000
MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DB_NAME=SIH26134
JWT_SECRET=replace-with-a-long-random-secret
JWT_EXPIRES_IN=2h

# Python AI service (called by the backend)
AI_SERVICE_URL=http://localhost:8000
AI_SERVICE_TIMEOUT_MS=30000
AI_SERVICE_API_KEY=

# AI service process settings
AI_SERVICE_PORT=8000
AI_SERVICE_LOG_LEVEL=info
AI_SERVICE_RELOAD=true
```

> **Important:** Change `JWT_SECRET` to a long random string before deploying.

---

## Verification tests

Run these after both servers are up:

```bash
# Profile APIs (B3)
node tests/verify-b3.mjs

# Skill Knowledge Base (B4)
node tests/verify-b4.mjs

# Industry & Job APIs (B5)
node tests/verify-b5.mjs

# Training Provider & Curriculum (B6)
node tests/verify-b6.mjs

# Document Processing / AI Service (B7) — requires Python AI service on :8000
node tests/verify-b7.mjs

# Skill Normalization & Matching (B9)
node tests/verify-b9.mjs

# Recommendation Engine (B11)
node tests/verify-b11.mjs

# B12–B18 smoke test
node tests/smoke-b12-b18.mjs
```

---

## Project structure

```
SIH26134/
├── backend/
│   ├── app.js               Express app factory
│   ├── server.js            Entry point
│   ├── db.js                MongoDB client + schema init
│   ├── config/env.js        Typed environment config
│   ├── middleware/
│   │   ├── auth.js          JWT verification + role guard
│   │   └── errorHandler.js
│   ├── routes/
│   │   ├── auth.js          Register / login / logout
│   │   ├── profiles.js      Role-specific profiles (B3)
│   │   ├── skills.js        Skill knowledge base (B4)
│   │   ├── industry.js      Industry management (B5)
│   │   ├── jobs.js          Job roles + descriptions (B5)
│   │   ├── training.js      Providers / programs / curricula (B6)
│   │   ├── process.js       Document AI processing (B7)
│   │   ├── normalize.js     Skill normalization (B9)
│   │   ├── match.js         Skill matching + gap analysis (B9)
│   │   ├── studentReadiness.js  Learner readiness (B10)
│   │   ├── recommendations.js   Recommendation engine (B11)
│   │   ├── roadmap.js       Learning roadmaps (B12)
│   │   ├── alignment.js     Curriculum alignment (B13)
│   │   ├── demand.js        Industry demand & trends (B14)
│   │   ├── govIntelligence.js  Government intelligence (B15)
│   │   ├── assessments.js   Assessments & feedback (B16)
│   │   ├── reportsNotifications.js  Reports + notifications (B17)
│   │   └── api.js           Legacy overview / health
│   └── services/
│       ├── aiService.js     HTTP client to Python AI
│       ├── normalization.js Normalization engine
│       ├── matcher.js       Skill matching engine
│       └── recommender.js   Recommendation scoring
│
├── frontend/
│   ├── main.jsx             React root + routing
│   ├── App.jsx              Program lead dashboard
│   ├── api.js               Axios client + all API functions
│   ├── routePermissions.js  Role → route mapping
│   └── components/
│       ├── AuthGate.jsx          Login / register
│       ├── StudentDashboard.jsx  Learner workspace
│       ├── IndustryDashboard.jsx Industry workspace
│       ├── TrainingDashboard.jsx Training provider workspace
│       ├── GovernmentDashboard.jsx Government workspace
│       ├── AIIntelligence.jsx    AI pipeline viewer
│       ├── AnalyticsDashboard.jsx Cross-ecosystem analytics
│       ├── ReportsCenter.jsx     Reports + notifications
│       ├── RecommendationDashboard.jsx  Course recommendations
│       ├── SkillMatchingDashboard.jsx   Normalization + matching
│       ├── SignalForm.jsx        Demand signal form
│       └── DemandChart.jsx      Recharts bar chart
│
├── ai_service/
│   ├── main.py              FastAPI AI service
│   ├── run.py               Convenience launcher
│   ├── requirements.txt     fastapi uvicorn pydantic
│   └── README.md
│
├── tests/
│   ├── verify-b3.mjs  through  smoke-b12-b18.mjs
│
├── .env.example
├── package.json
└── vite.config.js
```

---

## User roles

| Role | Route | What they see |
|------|-------|---------------|
| `learner` | `/student` | Skill gaps, readiness score, roadmap, recommendations |
| `training` | `/training` | Programs, curriculum alignment, improvement suggestions |
| `industry` | `/industry` | Job roles, demand signals, skill shortages |
| `government` | `/government` | Regional gaps, supply vs demand, ecosystem overview |

All four roles share `/analytics`, `/reports`, and `/intelligence` (the AI layer).

---

## API base URL

All API endpoints are under `http://localhost:4000/api`.  
The Vite dev server proxies `/api` to `:4000` automatically — no CORS config needed in development.

| Service | URL |
|---------|-----|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:4000/api |
| API health | http://localhost:4000/api/health |
| AI service | http://localhost:8000 |
| AI health | http://localhost:8000/health |
