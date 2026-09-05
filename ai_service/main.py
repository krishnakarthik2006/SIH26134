"""
SkillSync AI Extraction Service — Ollama Edition
=================================================
Powered by llama3.2:3b via local Ollama.
Rule-based KB is used as a fast fallback when Ollama is unavailable.

Run:
    pip install -r requirements.txt
    uvicorn main:app --host 0.0.0.0 --port 8000 --reload

Environment variables:
    OLLAMA_BASE_URL          = http://localhost:11434
    OLLAMA_MODEL             = llama3.2:3b
    OLLAMA_TIMEOUT_SECONDS   = 60
    AI_SERVICE_PORT          = 8000
    AI_SERVICE_API_KEY       = ""   (leave blank to disable auth)
"""

import os
import re
import time
import unicodedata
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from ollama_client import is_ollama_available, ollama_generate, parse_json_from_response

# ─── SETUP ───────────────────────────────────────────────────────────────────

SERVICE_VERSION = "2.0.0"
API_KEY         = os.getenv("AI_SERVICE_API_KEY", "")
OLLAMA_MODEL    = os.getenv("OLLAMA_MODEL", "llama3.2:3b")

app = FastAPI(
    title="SkillSync AI — Ollama Edition",
    description="LLM-powered skill extraction using llama3.2:3b via Ollama.",
    version=SERVICE_VERSION,
)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def verify_api_key(request: Request):
    if not API_KEY:
        return
    if request.headers.get("X-Api-Key", "") != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")


# ─── MODELS ──────────────────────────────────────────────────────────────────

class DocumentMetadata(BaseModel):
    sourceType:        str = ""
    sourceId:          str = ""
    candidateName:     str = ""
    targetRole:        str = ""
    jobTitle:          str = ""
    industryId:        str = ""
    jobRoleId:         str = ""
    programName:       str = ""
    trainingProgramId: str = ""
    curriculumId:      str = ""

class DocumentRequest(BaseModel):
    content:  str              = Field(..., min_length=10)
    metadata: DocumentMetadata = Field(default_factory=DocumentMetadata)

class ExtractedSkill(BaseModel):
    name:           str
    normalizedName: str
    confidence:     float
    category:       str = ""
    level:          str = ""

class Entities(BaseModel):
    names:         list[str] = []
    emails:        list[str] = []
    phones:        list[str] = []
    urls:          list[str] = []
    organizations: list[str] = []
    degrees:       list[str] = []
    locations:     list[str] = []

class ExtractionResult(BaseModel):
    extractedSkills: list[ExtractedSkill]
    entities:        Entities
    summary:         str
    language:        str
    wordCount:       int
    processingMs:    int
    modelVersion:    str
    extractedAt:     str
    engine:          str = "rule-based"   # "llm" | "rule-based" | "hybrid"


# ─── PROMPTS ─────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are a precise skill extraction engine for a workforce intelligence platform.
Extract only real, specific skills, tools, technologies, and competencies.
Do not invent skills not present in the text.
Always respond with valid JSON only — no explanation, no markdown outside the JSON."""

def build_extraction_prompt(content: str, source_type: str) -> str:
    type_hint = {
        "resume":         "This is a resume/CV.",
        "job_description":"This is a job description.",
        "curriculum":     "This is a training curriculum or course outline.",
    }.get(source_type, "This is a professional document.")

    # Truncate to ~2000 chars to stay within context window for 3b model
    truncated = content[:2000] + ("..." if len(content) > 2000 else "")

    return f"""{type_hint}

Extract ALL skills, technologies, tools, and competencies mentioned in the text below.

Return a JSON object with this exact structure:
{{
  "skills": [
    {{
      "name": "exact display name (e.g. Python, React, Machine Learning)",
      "normalizedName": "lowercase normalized name (e.g. python, react, machine learning)",
      "category": "one of: Programming Languages, Frontend, Backend, Databases, Cloud, DevOps, AI / ML, Data Analytics, Security, Soft Skills, Tools, Other",
      "level": "leave empty string unless the text explicitly states a level: beginner / intermediate / advanced / expert",
      "confidence": 0.95
    }}
  ],
  "summary": "one sentence describing the document and key skill areas found",
  "candidateName": "full name if this is a resume and a name is present, else empty string",
  "organizations": ["list of company or institution names mentioned"],
  "locations": ["list of cities, states, or regions mentioned"]
}}

DOCUMENT:
{truncated}

JSON response:"""


# ─── RULE-BASED KB (fallback) ────────────────────────────────────────────────

SKILL_KB: dict[str, tuple[str, str, float]] = {
    "python": ("Python", "Programming Languages", 0.95),
    "javascript": ("JavaScript", "Programming Languages", 0.95),
    "typescript": ("TypeScript", "Programming Languages", 0.93),
    "java": ("Java", "Programming Languages", 0.93),
    "kotlin": ("Kotlin", "Programming Languages", 0.92),
    "swift": ("Swift", "Programming Languages", 0.92),
    "c++": ("C++", "Programming Languages", 0.92),
    "c#": ("C#", "Programming Languages", 0.92),
    "go": ("Go", "Programming Languages", 0.90),
    "rust": ("Rust", "Programming Languages", 0.90),
    "ruby": ("Ruby", "Programming Languages", 0.90),
    "php": ("PHP", "Programming Languages", 0.90),
    "scala": ("Scala", "Programming Languages", 0.89),
    "r": ("R", "Programming Languages", 0.85),
    "dart": ("Dart", "Programming Languages", 0.88),
    "react": ("React", "Frontend", 0.95),
    "angular": ("Angular", "Frontend", 0.93),
    "vue": ("Vue.js", "Frontend", 0.93),
    "next.js": ("Next.js", "Frontend", 0.93),
    "svelte": ("Svelte", "Frontend", 0.90),
    "html": ("HTML", "Frontend", 0.88),
    "css": ("CSS", "Frontend", 0.88),
    "tailwind": ("Tailwind CSS", "Frontend", 0.90),
    "node.js": ("Node.js", "Backend", 0.95),
    "express": ("Express.js", "Backend", 0.92),
    "fastapi": ("FastAPI", "Backend", 0.93),
    "django": ("Django", "Backend", 0.93),
    "flask": ("Flask", "Backend", 0.92),
    "spring": ("Spring Boot", "Backend", 0.92),
    "nestjs": ("NestJS", "Backend", 0.91),
    "sql": ("SQL", "Databases", 0.90),
    "mysql": ("MySQL", "Databases", 0.93),
    "postgresql": ("PostgreSQL", "Databases", 0.93),
    "mongodb": ("MongoDB", "Databases", 0.93),
    "redis": ("Redis", "Databases", 0.92),
    "elasticsearch": ("Elasticsearch", "Databases", 0.91),
    "aws": ("AWS", "Cloud", 0.95),
    "azure": ("Azure", "Cloud", 0.94),
    "gcp": ("GCP", "Cloud", 0.94),
    "docker": ("Docker", "DevOps", 0.95),
    "kubernetes": ("Kubernetes", "DevOps", 0.95),
    "terraform": ("Terraform", "DevOps", 0.93),
    "ansible": ("Ansible", "DevOps", 0.92),
    "jenkins": ("Jenkins", "DevOps", 0.92),
    "machine learning": ("Machine Learning", "AI / ML", 0.90),
    "deep learning": ("Deep Learning", "AI / ML", 0.90),
    "tensorflow": ("TensorFlow", "AI / ML", 0.94),
    "pytorch": ("PyTorch", "AI / ML", 0.94),
    "scikit-learn": ("Scikit-learn", "AI / ML", 0.93),
    "nlp": ("NLP", "AI / ML", 0.88),
    "llm": ("LLM", "AI / ML", 0.88),
    "generative ai": ("Generative AI", "AI / ML", 0.90),
    "computer vision": ("Computer Vision", "AI / ML", 0.90),
    "pandas": ("Pandas", "AI / ML", 0.91),
    "numpy": ("NumPy", "AI / ML", 0.90),
    "tableau": ("Tableau", "Data Analytics", 0.90),
    "power bi": ("Power BI", "Data Analytics", 0.90),
    "cybersecurity": ("Cybersecurity", "Security", 0.90),
    "cloud security": ("Cloud Security", "Security", 0.90),
    "communication": ("Communication", "Soft Skills", 0.80),
    "leadership": ("Leadership", "Soft Skills", 0.80),
    "agile": ("Agile", "Soft Skills", 0.85),
    "scrum": ("Scrum", "Soft Skills", 0.85),
    "project management": ("Project Management", "Soft Skills", 0.85),
    "git": ("Git", "Tools", 0.90),
    "jira": ("Jira", "Tools", 0.88),
    "figma": ("Figma", "Tools", 0.88),
    "graphql": ("GraphQL", "Tools", 0.90),
    "kafka": ("Apache Kafka", "Tools", 0.90),
    "rest api": ("REST API", "Tools", 0.88),
}

ALIASES = {
    "py": "python", "js": "javascript", "ts": "typescript",
    "node": "node.js", "mongo": "mongodb", "pg": "postgresql",
    "k8s": "kubernetes", "tf": "tensorflow", "reactjs": "react",
    "spring boot": "spring", "sklearn": "scikit-learn",
}

EMAIL_RE    = re.compile(r'[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}')
PHONE_RE    = re.compile(r'(?:\+91[\s\-]?)?[6-9]\d{9}|(?:\+\d{1,3}[\s\-]?)?\(?\d{2,4}\)?[\s\-]\d{3,4}[\s\-]\d{3,4}')
URL_RE      = re.compile(r'https?://[^\s]+|linkedin\.com/in/[^\s]+|github\.com/[^\s]+')
DEGREE_RE   = re.compile(r'\b(B\.?Tech|M\.?Tech|B\.?E|B\.?Sc|M\.?Sc|MBA|MCA|BCA|PhD|Ph\.D)\b')
LOCATION_RE = re.compile(r'\b(Mumbai|Pune|Delhi|Bangalore|Hyderabad|Chennai|Nagpur|Nashik|Vidarbha|Marathwada|Maharashtra)\b')
NAME_RE     = re.compile(r'\b([A-Z][a-z]+(?:\s[A-Z][a-z]+){1,2})\b')
ORG_RE      = re.compile(r'\b([A-Z][A-Za-z&\s]{2,30}(?:Ltd|Limited|Inc|Corp|Pvt|Solutions|Technologies|Tech|Systems|Services|Labs|Digital)\.?)\b')


def extract_entities_from_text(text: str) -> Entities:
    STOPWORDS = {"Bachelor", "Master", "Senior", "Junior", "Lead", "Manager", "Engineer", "Developer"}
    names = list(set(n for n in NAME_RE.findall(text) if not any(w in STOPWORDS for w in n.split())))[:5]
    return Entities(
        names=names,
        emails=list(set(EMAIL_RE.findall(text)))[:5],
        phones=list(set(PHONE_RE.findall(text)))[:5],
        urls=list(set(URL_RE.findall(text)))[:5],
        organizations=list(set(ORG_RE.findall(text)))[:10],
        degrees=list(set(DEGREE_RE.findall(text)))[:5],
        locations=list(set(LOCATION_RE.findall(text)))[:10],
    )


def rule_based_extract(text: str) -> list[ExtractedSkill]:
    normalized = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    normalized = re.sub(r'\s+', ' ', normalized.lower().strip())
    found = {}
    for key in sorted(SKILL_KB.keys(), key=len, reverse=True):
        pat = re.compile(r'(?<![a-z0-9\-])' + re.escape(key) + r'(?![a-z0-9\-])', re.IGNORECASE)
        if pat.search(normalized) and key not in found:
            d, c, conf = SKILL_KB[key]
            found[key] = ExtractedSkill(name=d, normalizedName=key, confidence=conf, category=c)
    for alias, canonical in ALIASES.items():
        pat = re.compile(r'(?<![a-z0-9\-])' + re.escape(alias) + r'(?![a-z0-9\-])', re.IGNORECASE)
        if pat.search(normalized) and canonical in SKILL_KB and canonical not in found:
            d, c, conf = SKILL_KB[canonical]
            found[canonical] = ExtractedSkill(name=d, normalizedName=canonical, confidence=round(conf * 0.95, 2), category=c)
    return sorted(found.values(), key=lambda s: s.confidence, reverse=True)


# ─── LLM EXTRACTOR ───────────────────────────────────────────────────────────

def normalise_skill_name(name: str) -> str:
    return re.sub(r'\s+', ' ', name.strip().lower())


async def llm_extract(content: str, metadata: DocumentMetadata, source_type: str) -> ExtractionResult:
    """Use Ollama llama3.2:3b for extraction, fall back to rule-based on failure."""
    t0     = time.perf_counter()
    prompt = build_extraction_prompt(content, source_type)

    raw = await ollama_generate(prompt, system=SYSTEM_PROMPT)
    parsed = parse_json_from_response(raw) if raw else None

    engine = "rule-based"
    skills: list[ExtractedSkill] = []
    summary = ""
    orgs: list[str] = []
    locs: list[str] = []

    if parsed and isinstance(parsed, dict) and "skills" in parsed:
        engine = "llm"
        # Parse skills from LLM response
        llm_skills_raw = parsed.get("skills", [])
        seen = set()
        for s in llm_skills_raw:
            if not isinstance(s, dict):
                continue
            name = str(s.get("name", "")).strip()
            if not name:
                continue
            norm = normalise_skill_name(name)
            if norm in seen:
                continue
            seen.add(norm)
            try:
                conf = float(s.get("confidence", 0.88))
                conf = max(0.0, min(1.0, conf))
            except (ValueError, TypeError):
                conf = 0.88
            skills.append(ExtractedSkill(
                name           = name,
                normalizedName = norm,
                confidence     = round(conf, 2),
                category       = str(s.get("category", "Other")).strip(),
                level          = str(s.get("level", "")).strip(),
            ))

        # Sort by confidence descending
        skills.sort(key=lambda x: x.confidence, reverse=True)
        summary = str(parsed.get("summary", "")).strip()
        orgs    = [str(o) for o in parsed.get("organizations", []) if o][:10]
        locs    = [str(l) for l in parsed.get("locations", []) if l][:10]

        # Hybrid: also run rule-based and merge any skills LLM missed
        rb_skills = rule_based_extract(content)
        llm_norm_set = {s.normalizedName for s in skills}
        for rb_s in rb_skills:
            if rb_s.normalizedName not in llm_norm_set:
                skills.append(rb_s)
                llm_norm_set.add(rb_s.normalizedName)
        engine = "hybrid"

    else:
        # Full fallback to rule-based
        skills = rule_based_extract(content)
        engine = "rule-based"

    # Always extract entities from text (reliable, fast)
    ents = extract_entities_from_text(content)
    if orgs:
        ents = Entities(**{**ents.model_dump(), "organizations": list(set(ents.organizations + orgs))[:10]})
    if locs:
        ents = Entities(**{**ents.model_dump(), "locations": list(set(ents.locations + locs))[:10]})

    if not summary:
        type_labels = {"resume": "Resume", "job_description": "Job description", "curriculum": "Curriculum"}
        label = type_labels.get(source_type, "Document")
        cats  = list(set(s.category for s in skills))
        top   = ", ".join(s.name for s in skills[:5]) or "none detected"
        summary = f"{label} processed via {engine}. {len(skills)} skill(s) across {len(cats)} categories. Top: {top}."

    words = len(re.findall(r'\w+', content))
    ms    = int((time.perf_counter() - t0) * 1000)

    # Detect language
    non_ascii = sum(1 for w in content.split() if not w.isascii())
    language  = "en" if (not content.split() or non_ascii / len(content.split()) < 0.05) else "mixed"

    return ExtractionResult(
        extractedSkills=skills,
        entities=ents,
        summary=summary,
        language=language,
        wordCount=words,
        processingMs=ms,
        modelVersion=f"{OLLAMA_MODEL} ({engine})",
        extractedAt=datetime.now(timezone.utc).isoformat(),
        engine=engine,
    )


# ─── ROUTES ──────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    ollama_up = await is_ollama_available()
    return {
        "status":       "ok",
        "service":      "skillsync-ai",
        "version":      SERVICE_VERSION,
        "ollamaModel":  OLLAMA_MODEL,
        "ollamaStatus": "available" if ollama_up else "unavailable (using rule-based fallback)",
        "engine":       "llm+hybrid" if ollama_up else "rule-based",
        "timestamp":    datetime.now(timezone.utc).isoformat(),
    }


@app.post("/extract/resume", response_model=ExtractionResult, dependencies=[Depends(verify_api_key)])
async def extract_resume(req: DocumentRequest):
    if len(req.content.strip()) < 50:
        raise HTTPException(status_code=422, detail="content must be at least 50 characters")
    return await llm_extract(req.content, req.metadata, "resume")


@app.post("/extract/jd", response_model=ExtractionResult, dependencies=[Depends(verify_api_key)])
async def extract_jd(req: DocumentRequest):
    if len(req.content.strip()) < 50:
        raise HTTPException(status_code=422, detail="content must be at least 50 characters")
    return await llm_extract(req.content, req.metadata, "job_description")


@app.post("/extract/curriculum", response_model=ExtractionResult, dependencies=[Depends(verify_api_key)])
async def extract_curriculum(req: DocumentRequest):
    if len(req.content.strip()) < 50:
        raise HTTPException(status_code=422, detail="content must be at least 50 characters")
    return await llm_extract(req.content, req.metadata, "curriculum")


@app.get("/skills")
def list_known_skills(category: str = ""):
    skills = [
        {"normalizedName": k, "name": v[0], "category": v[1], "confidence": v[2]}
        for k, v in SKILL_KB.items()
        if not category or v[1].lower() == category.lower()
    ]
    return {"skills": skills, "count": len(skills)}


@app.get("/models")
async def list_models():
    """List available Ollama models."""
    import httpx
    from ollama_client import OLLAMA_BASE
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"{OLLAMA_BASE}/api/tags")
            return {"models": r.json().get("models", []), "current": OLLAMA_MODEL}
    except Exception:
        return {"models": [], "current": OLLAMA_MODEL, "error": "Ollama not reachable"}
