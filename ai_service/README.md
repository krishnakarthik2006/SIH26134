# SkillSync AI Extraction Service

Python FastAPI microservice that extracts skills and entities from resumes, job descriptions, and curriculum documents.

## Setup

```bash
cd ai_service
pip install -r requirements.txt
python run.py
# or: uvicorn main:app --reload --port 8000
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /health | Liveness check |
| POST | /extract/resume | Extract skills from resume text |
| POST | /extract/jd | Extract skills from job description text |
| POST | /extract/curriculum | Extract skills from curriculum text |
| GET | /skills | List all skills in the knowledge base |

## Request format

All three extraction endpoints accept:

```json
{
  "content": "plain text of the document (min 50 chars)",
  "metadata": {
    "sourceType": "resume | job_description | curriculum",
    "candidateName": "optional",
    "targetRole": "optional",
    "jobTitle": "optional"
  }
}
```

## Response format

```json
{
  "extractedSkills": [
    { "name": "Python", "normalizedName": "python", "confidence": 0.95, "category": "Programming Languages", "level": "" }
  ],
  "entities": {
    "names": [], "emails": [], "phones": [], "urls": [],
    "organizations": [], "degrees": [], "locations": []
  },
  "summary": "Resume processed. 12 skill(s) extracted...",
  "language": "en",
  "wordCount": 450,
  "processingMs": 8,
  "modelVersion": "rule-based-v1",
  "extractedAt": "2026-09-04T10:00:00+00:00"
}
```

## Authentication

If `AI_SERVICE_API_KEY` is set, every request must include:
```
X-Api-Key: <your-key>
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| AI_SERVICE_PORT | 8000 | Port to listen on |
| AI_SERVICE_API_KEY | (empty) | Optional API key |
| AI_SERVICE_LOG_LEVEL | info | uvicorn log level |
| AI_SERVICE_RELOAD | true | Hot reload in dev |

## Extending the skill knowledge base

Edit the `SKILL_KB` dictionary in `main.py` to add more skills:

```python
"your skill": ("Display Name", "Category", 0.90),
```

Add aliases in `ALIASES`:

```python
"short form": "canonical key",
```
