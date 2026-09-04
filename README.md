# SkillSync

SkillSync is a connected labour-market intelligence workspace for aligning industry requirements, training curricula, learner pathways, assessments, and regional interventions.

## Local development

```bash
npm install
npm run dev
```

Then open the local URL printed by Vite. This phase is intentionally limited to the React + Vite frontend foundation; deployment is out of scope.

## Project structure

- `frontend/` - React + Vite application, routes, components, charts, and styles
- `backend/` - Node.js + Express REST API
- `vite.config.js` - Vite frontend root and `/api` development proxy

## Product direction

The interface is organized around one continuous loop:

1. Industry publishes demand.
2. AI normalizes skills.
3. Training providers align curricula.
4. Learners close prioritized gaps.
5. Assessments refresh real skill levels.
6. Government acts on aggregated regional intelligence.