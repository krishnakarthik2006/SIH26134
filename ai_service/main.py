"""
SkillSync AI Extraction Service — Phase B7
==========================================
FastAPI microservice that extracts skills and entities from:
  - Resumes
  - Job descriptions
  - Curriculum documents

Run:
    pip install -r requirements.txt
    uvicorn main:app --host 0.0.0.0 --port 8000 --reload

Or with the helper script:
    python run.py

Environment variables (all optional):
    AI_SERVICE_PORT      = 8000
    AI_SERVICE_API_KEY   = ""          # if set, X-Api-Key header is required
    AI_SERVICE_LOG_LEVEL = "info"
"""

import os
import re
import time
import unicodedata
from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ─── APP SETUP ───────────────────────────────────────────────────────────────

SERVICE_VERSION = "1.0.0"
MODEL_VERSION   = "rule-based-v1"
API_KEY         = os.getenv("AI_SERVICE_API_KEY", "")

app = FastAPI(
    title="SkillSync AI Extraction Service",
    description="NLP pipeline for skill extraction from resumes, JDs, and curricula.",
    version=SERVICE_VERSION,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── AUTH ────────────────────────────────────────────────────────────────────

def verify_api_key(request: Request):
    """Optional API key check — only enforced if AI_SERVICE_API_KEY is set."""
    if not API_KEY:
        return
    key = request.headers.get("X-Api-Key", "")
    if key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")

# ─── MODELS ──────────────────────────────────────────────────────────────────

class DocumentMetadata(BaseModel):
    sourceType:         str  = ""
    sourceId:           str  = ""
    candidateName:      str  = ""
    targetRole:         str  = ""
    jobTitle:           str  = ""
    industryId:         str  = ""
    jobRoleId:          str  = ""
    programName:        str  = ""
    trainingProgramId:  str  = ""
    curriculumId:       str  = ""

class DocumentRequest(BaseModel):
    content:  str              = Field(..., min_length=10)
    metadata: DocumentMetadata = Field(default_factory=DocumentMetadata)

class ExtractedSkill(BaseModel):
    name:           str
    normalizedName: str
    confidence:     float
    category:       str  = ""
    level:          str  = ""

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

# ─── SKILL KNOWLEDGE BASE ────────────────────────────────────────────────────
# Curated list of skills with their categories and confidence weights.
# Organized as: { normalized_term: (display_name, category, base_confidence) }

SKILL_KB: dict[str, tuple[str, str, float]] = {
    # Programming Languages
    "python":       ("Python",       "Programming Languages", 0.95),
    "javascript":   ("JavaScript",   "Programming Languages", 0.95),
    "typescript":   ("TypeScript",   "Programming Languages", 0.93),
    "java":         ("Java",         "Programming Languages", 0.93),
    "kotlin":       ("Kotlin",       "Programming Languages", 0.92),
    "swift":        ("Swift",        "Programming Languages", 0.92),
    "c++":          ("C++",          "Programming Languages", 0.92),
    "c#":           ("C#",           "Programming Languages", 0.92),
    "go":           ("Go",           "Programming Languages", 0.90),
    "rust":         ("Rust",         "Programming Languages", 0.90),
    "ruby":         ("Ruby",         "Programming Languages", 0.90),
    "php":          ("PHP",          "Programming Languages", 0.90),
    "scala":        ("Scala",        "Programming Languages", 0.89),
    "r":            ("R",            "Programming Languages", 0.85),
    "matlab":       ("MATLAB",       "Programming Languages", 0.88),
    "dart":         ("Dart",         "Programming Languages", 0.88),
    # Web Frameworks
    "react":        ("React",        "Frontend",  0.95),
    "reactjs":      ("React",        "Frontend",  0.95),
    "angular":      ("Angular",      "Frontend",  0.93),
    "vue":          ("Vue.js",       "Frontend",  0.93),
    "vuejs":        ("Vue.js",       "Frontend",  0.93),
    "next.js":      ("Next.js",      "Frontend",  0.93),
    "nextjs":       ("Next.js",      "Frontend",  0.93),
    "nuxt":         ("Nuxt.js",      "Frontend",  0.91),
    "svelte":       ("Svelte",       "Frontend",  0.90),
    "html":         ("HTML",         "Frontend",  0.88),
    "css":          ("CSS",          "Frontend",  0.88),
    "tailwind":     ("Tailwind CSS", "Frontend",  0.90),
    "sass":         ("SASS/SCSS",    "Frontend",  0.87),
    # Backend Frameworks
    "node.js":      ("Node.js",      "Backend",   0.95),
    "nodejs":       ("Node.js",      "Backend",   0.95),
    "express":      ("Express.js",   "Backend",   0.92),
    "fastapi":      ("FastAPI",      "Backend",   0.93),
    "django":       ("Django",       "Backend",   0.93),
    "flask":        ("Flask",        "Backend",   0.92),
    "spring":       ("Spring Boot",  "Backend",   0.92),
    "springboot":   ("Spring Boot",  "Backend",   0.92),
    "rails":        ("Ruby on Rails","Backend",   0.91),
    "laravel":      ("Laravel",      "Backend",   0.91),
    "nestjs":       ("NestJS",       "Backend",   0.91),
    "fastify":      ("Fastify",      "Backend",   0.90),
    # Databases
    "sql":          ("SQL",          "Databases", 0.90),
    "mysql":        ("MySQL",        "Databases", 0.93),
    "postgresql":   ("PostgreSQL",   "Databases", 0.93),
    "postgres":     ("PostgreSQL",   "Databases", 0.93),
    "mongodb":      ("MongoDB",      "Databases", 0.93),
    "redis":        ("Redis",        "Databases", 0.92),
    "elasticsearch":("Elasticsearch","Databases", 0.91),
    "cassandra":    ("Cassandra",    "Databases", 0.91),
    "dynamodb":     ("DynamoDB",     "Databases", 0.91),
    "firebase":     ("Firebase",     "Databases", 0.90),
    "sqlite":       ("SQLite",       "Databases", 0.89),
    "oracle":       ("Oracle DB",    "Databases", 0.90),
    # Cloud & DevOps
    "aws":          ("AWS",          "Cloud",     0.95),
    "azure":        ("Azure",        "Cloud",     0.94),
    "gcp":          ("GCP",          "Cloud",     0.94),
    "docker":       ("Docker",       "DevOps",    0.95),
    "kubernetes":   ("Kubernetes",   "DevOps",    0.95),
    "k8s":          ("Kubernetes",   "DevOps",    0.93),
    "terraform":    ("Terraform",    "DevOps",    0.93),
    "ansible":      ("Ansible",      "DevOps",    0.92),
    "jenkins":      ("Jenkins",      "DevOps",    0.92),
    "gitlab":       ("GitLab CI",    "DevOps",    0.90),
    "github actions":("GitHub Actions","DevOps",  0.91),
    "helm":         ("Helm",         "DevOps",    0.90),
    "nginx":        ("Nginx",        "DevOps",    0.89),
    # AI / ML
    "machine learning":  ("Machine Learning",  "AI / ML", 0.90),
    "deep learning":     ("Deep Learning",     "AI / ML", 0.90),
    "tensorflow":        ("TensorFlow",        "AI / ML", 0.94),
    "pytorch":           ("PyTorch",           "AI / ML", 0.94),
    "scikit-learn":      ("Scikit-learn",      "AI / ML", 0.93),
    "sklearn":           ("Scikit-learn",      "AI / ML", 0.91),
    "keras":             ("Keras",             "AI / ML", 0.92),
    "nlp":               ("NLP",               "AI / ML", 0.88),
    "llm":               ("LLM",               "AI / ML", 0.88),
    "generative ai":     ("Generative AI",     "AI / ML", 0.90),
    "computer vision":   ("Computer Vision",   "AI / ML", 0.90),
    "pandas":            ("Pandas",            "AI / ML", 0.91),
    "numpy":             ("NumPy",             "AI / ML", 0.90),
    "matplotlib":        ("Matplotlib",        "AI / ML", 0.88),
    "tableau":           ("Tableau",           "Data Analytics", 0.90),
    "power bi":          ("Power BI",          "Data Analytics", 0.90),
    # Security
    "cybersecurity":     ("Cybersecurity",     "Security", 0.90),
    "cloud security":    ("Cloud Security",    "Security", 0.90),
    "penetration testing":("Penetration Testing","Security",0.90),
    "owasp":             ("OWASP",             "Security", 0.89),
    "siem":              ("SIEM",              "Security", 0.88),
    "soc":               ("SOC",               "Security", 0.87),
    # Soft skills
    "communication":     ("Communication",     "Soft Skills", 0.80),
    "leadership":        ("Leadership",        "Soft Skills", 0.80),
    "teamwork":          ("Teamwork",          "Soft Skills", 0.78),
    "problem solving":   ("Problem Solving",   "Soft Skills", 0.80),
    "critical thinking": ("Critical Thinking", "Soft Skills", 0.80),
    "agile":             ("Agile",             "Soft Skills", 0.85),
    "scrum":             ("Scrum",             "Soft Skills", 0.85),
    "project management":("Project Management","Soft Skills", 0.85),
    # Tools
    "git":           ("Git",           "Tools", 0.90),
    "jira":          ("Jira",          "Tools", 0.88),
    "figma":         ("Figma",         "Tools", 0.88),
    "postman":       ("Postman",       "Tools", 0.87),
    "graphql":       ("GraphQL",       "Tools", 0.90),
    "rest api":      ("REST API",      "Tools", 0.88),
    "grpc":          ("gRPC",          "Tools", 0.88),
    "kafka":         ("Apache Kafka",  "Tools", 0.90),
    "rabbitmq":      ("RabbitMQ",      "Tools", 0.89),
}

# Alias map — alternative spellings that map to canonical keys
ALIASES: dict[str, str] = {
    "py":           "python",
    "js":           "javascript",
    "ts":           "typescript",
    "node":         "node.js",
    "mongo":        "mongodb",
    "pg":           "postgresql",
    "k8":           "kubernetes",
    "tf":           "tensorflow",
    "ml":           "machine learning",
    "dl":           "deep learning",
    "ai":           "generative ai",
    "cv":           "computer vision",
    "react.js":     "react",
    "vue.js":       "vue",
    "spring boot":  "spring",
    "scikit":       "scikit-learn",
    "sklearn":      "scikit-learn",
    "pandas":       "pandas",
}

# ─── ENTITY PATTERNS ─────────────────────────────────────────────────────────

EMAIL_RE   = re.compile(r'[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}')
PHONE_RE   = re.compile(r'(?:\+91[\s\-]?)?[6-9]\d{9}|(?:\+\d{1,3}[\s\-]?)?\(?\d{2,4}\)?[\s\-]\d{3,4}[\s\-]\d{3,4}')
URL_RE     = re.compile(r'https?://[^\s]+|www\.[^\s]+|linkedin\.com/in/[^\s]+|github\.com/[^\s]+')
DEGREE_RE  = re.compile(
    r'\b(B\.?Tech|M\.?Tech|B\.?E|B\.?Sc|M\.?Sc|MBA|MCA|BCA|PhD|Ph\.D|B\.?Com|M\.?Com'
    r'|Bachelor of [A-Z][a-z]+|Master of [A-Z][a-z]+|Diploma in [A-Z][a-z]+)\b'
)
LOCATION_RE = re.compile(
    r'\b(Mumbai|Pune|Delhi|Bangalore|Bengaluru|Hyderabad|Chennai|Kolkata|Ahmedabad'
    r'|Nagpur|Nashik|Aurangabad|Thane|Navi Mumbai|Vidarbha|Marathwada'
    r'|Maharashtra|Karnataka|Tamil Nadu|Andhra Pradesh|Telangana|Gujarat)\b'
)
# Simple name heuristic: 2-3 capitalised words not followed by common non-name patterns
NAME_RE = re.compile(r'\b([A-Z][a-z]+(?:\s[A-Z][a-z]+){1,2})\b')
ORG_SUFFIXES = re.compile(
    r'\b([A-Z][A-Za-z&\s]{2,40}'
    r'(?:Ltd|Limited|Inc|Corp|Corporation|Pvt|Private|LLP|Solutions|Technologies|Tech'
    r'|Systems|Services|Consulting|Analytics|Labs|Digital|Innovations)\.?)\b'
)

# ─── EXTRACTION ENGINE ───────────────────────────────────────────────────────

def normalize_text(text: str) -> str:
    """Lowercase, strip accents, collapse whitespace."""
    text = unicodedata.normalize("NFKD", text)
    text = text.encode("ascii", "ignore").decode("ascii")
    return re.sub(r'\s+', ' ', text.lower().strip())

def extract_skills(text: str) -> list[ExtractedSkill]:
    """
    Multi-pass skill extraction:
      Pass 1 — scan for multi-word skill phrases (longest match first)
      Pass 2 — resolve aliases
      Pass 3 — single-word fallback scan
    Returns deduplicated list sorted by confidence descending.
    """
    normalized = normalize_text(text)
    found: dict[str, ExtractedSkill] = {}  # normalizedName → skill

    # Sort KB keys longest-first so multi-word matches win over partials
    sorted_keys = sorted(SKILL_KB.keys(), key=len, reverse=True)

    for key in sorted_keys:
        # Use word-boundary aware pattern
        pattern = re.compile(
            r'(?<![a-z0-9\-])' + re.escape(key) + r'(?![a-z0-9\-])',
            re.IGNORECASE,
        )
        if pattern.search(normalized):
            display, category, confidence = SKILL_KB[key]
            norm_name = key
            if norm_name not in found:
                found[norm_name] = ExtractedSkill(
                    name=display,
                    normalizedName=norm_name,
                    confidence=round(confidence, 2),
                    category=category,
                )

    # Alias pass
    for alias, canonical in ALIASES.items():
        pattern = re.compile(
            r'(?<![a-z0-9\-])' + re.escape(alias) + r'(?![a-z0-9\-])',
            re.IGNORECASE,
        )
        if pattern.search(normalized) and canonical in SKILL_KB and canonical not in found:
            display, category, confidence = SKILL_KB[canonical]
            found[canonical] = ExtractedSkill(
                name=display,
                normalizedName=canonical,
                confidence=round(confidence * 0.95, 2),  # slight penalty for alias match
                category=category,
            )

    return sorted(found.values(), key=lambda s: s.confidence, reverse=True)

def extract_entities(text: str) -> Entities:
    emails    = list(set(EMAIL_RE.findall(text)))
    phones    = list(set(PHONE_RE.findall(text)))
    urls      = list(set(URL_RE.findall(text)))
    degrees   = list(set(DEGREE_RE.findall(text)))
    locations = list(set(LOCATION_RE.findall(text)))
    orgs      = list(set(ORG_SUFFIXES.findall(text)))

    # Name heuristic: capitalised 2-3 word sequences, exclude known non-names
    STOPWORDS = {"Bachelor", "Master", "Doctor", "Senior", "Junior", "Lead",
                 "Manager", "Engineer", "Developer", "Analyst"}
    raw_names = NAME_RE.findall(text)
    names = list(set(
        n for n in raw_names
        if not any(w in STOPWORDS for w in n.split())
    ))[:5]  # cap at 5 likely names

    return Entities(
        names=names,
        emails=emails[:5],
        phones=phones[:5],
        urls=urls[:5],
        organizations=orgs[:10],
        degrees=degrees[:5],
        locations=locations[:10],
    )

def count_words(text: str) -> int:
    return len(re.findall(r'\w+', text))

def detect_language(text: str) -> str:
    """Simple heuristic: if >5% of words are non-ASCII, flag as non-English."""
    words = text.split()
    if not words:
        return "unknown"
    non_ascii = sum(1 for w in words if not w.isascii())
    return "en" if non_ascii / len(words) < 0.05 else "mixed"

def generate_summary(text: str, source_type: str, skills: list[ExtractedSkill]) -> str:
    """Generate a brief human-readable summary of the extraction."""
    skill_names = [s.name for s in skills[:5]]
    skill_str   = ", ".join(skill_names) if skill_names else "none detected"
    categories  = list(set(s.category for s in skills))
    cat_str     = ", ".join(categories[:4]) if categories else "general"
    word_count  = count_words(text)

    type_labels = {
        "resume":         "Resume",
        "job_description":"Job description",
        "curriculum":     "Curriculum",
    }
    label = type_labels.get(source_type, "Document")

    return (
        f"{label} processed. "
        f"{len(skills)} skill(s) extracted across {len(categories)} categories ({cat_str}). "
        f"Top skills: {skill_str}. "
        f"Document length: {word_count} words."
    )

def run_extraction(content: str, metadata: DocumentMetadata, source_type: str) -> ExtractionResult:
    t0     = time.perf_counter()
    skills = extract_skills(content)
    ents   = extract_entities(content)
    words  = count_words(content)
    lang   = detect_language(content)
    summ   = generate_summary(content, source_type, skills)
    ms     = int((time.perf_counter() - t0) * 1000)

    return ExtractionResult(
        extractedSkills=skills,
        entities=ents,
        summary=summ,
        language=lang,
        wordCount=words,
        processingMs=ms,
        modelVersion=MODEL_VERSION,
        extractedAt=datetime.now(timezone.utc).isoformat(),
    )

# ─── ROUTES ──────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status":         "ok",
        "service":        "skillsync-ai",
        "version":        SERVICE_VERSION,
        "modelVersion":   MODEL_VERSION,
        "timestamp":      datetime.now(timezone.utc).isoformat(),
    }

@app.post("/extract/resume", response_model=ExtractionResult, dependencies=[Depends(verify_api_key)])
def extract_resume(req: DocumentRequest):
    """
    Extract skills and entities from a resume.
    Detects: technical skills, programming languages, frameworks, tools.
    Also extracts: candidate name candidates, email, phone, LinkedIn/GitHub URLs, degrees.
    """
    if len(req.content.strip()) < 50:
        raise HTTPException(status_code=422, detail="content must be at least 50 characters")
    return run_extraction(req.content, req.metadata, "resume")

@app.post("/extract/jd", response_model=ExtractionResult, dependencies=[Depends(verify_api_key)])
def extract_jd(req: DocumentRequest):
    """
    Extract required skills from a job description.
    Detects: required technologies, experience keywords, role-specific skills.
    """
    if len(req.content.strip()) < 50:
        raise HTTPException(status_code=422, detail="content must be at least 50 characters")
    return run_extraction(req.content, req.metadata, "job_description")

@app.post("/extract/curriculum", response_model=ExtractionResult, dependencies=[Depends(verify_api_key)])
def extract_curriculum(req: DocumentRequest):
    """
    Extract skills and topics covered in a curriculum document.
    Detects: technologies taught, frameworks covered, domain knowledge.
    """
    if len(req.content.strip()) < 50:
        raise HTTPException(status_code=422, detail="content must be at least 50 characters")
    return run_extraction(req.content, req.metadata, "curriculum")

@app.get("/skills")
def list_known_skills(category: str = ""):
    """List all skills in the knowledge base, optionally filtered by category."""
    skills = [
        {"normalizedName": k, "name": v[0], "category": v[1], "confidence": v[2]}
        for k, v in SKILL_KB.items()
        if not category or v[1].lower() == category.lower()
    ]
    return {"skills": skills, "count": len(skills)}
