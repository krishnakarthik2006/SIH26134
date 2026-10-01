# Career Dataset Import

The career catalogue importer expects these five files in one folder:

- `occupation_data.csv`
- `essential_skills.csv`
- `software_skills.csv`
- `education.csv`
- `related_occupations.csv`

By default the importer reads `../career_projects` relative to the project root. Run a dry run first, then import into MongoDB:

```bash
node scripts/import-career-datasets.mjs --folder ..\career_projects --dry-run
npm run seed:datasets -- --folder ..\career_projects
```

The import is safe to rerun. It upserts one occupation document per occupation code into the `occupations` collection. Skill importance and level ratings, software demand flags, education categories, and related occupations are retained in each document.

The learner workspace exposes this catalogue under **Career library**. The read API is `GET /api/occupations` for search and `GET /api/occupations/:socCode` for full details.
