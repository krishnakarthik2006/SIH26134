"""
Ollama client for SkillSync AI service.
Calls the local Ollama HTTP API (default: http://localhost:11434).
"""

import os
import json
import httpx
from typing import Optional

OLLAMA_BASE  = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:3b")
OLLAMA_TIMEOUT = int(os.getenv("OLLAMA_TIMEOUT_SECONDS", "60"))


async def is_ollama_available() -> bool:
    """Check whether Ollama is running and the model is loaded."""
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            r = await client.get(f"{OLLAMA_BASE}/api/tags")
            if r.status_code != 200:
                return False
            models = [m["name"] for m in r.json().get("models", [])]
            return any(OLLAMA_MODEL in m for m in models)
    except Exception:
        return False


async def ollama_generate(prompt: str, system: str = "") -> Optional[str]:
    """
    Call Ollama /api/generate and return the response text.
    Returns None if Ollama is unavailable or errors.
    """
    payload = {
        "model":  OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": 0.1,   # low temp → deterministic, factual output
            "top_p":        0.9,
            "num_predict":  1024, # max tokens in response
        },
    }
    if system:
        payload["system"] = system

    try:
        async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT) as client:
            r = await client.post(f"{OLLAMA_BASE}/api/generate", json=payload)
            r.raise_for_status()
            return r.json().get("response", "").strip()
    except Exception as e:
        print(f"[ollama] generate error: {e}")
        return None


def parse_json_from_response(text: str) -> Optional[dict]:
    """
    Extract the first JSON object or array from the LLM response text.
    LLMs sometimes wrap JSON in markdown code fences — this handles both.
    """
    if not text:
        return None

    # Strip markdown code fences
    cleaned = text
    for fence in ("```json", "```"):
        if fence in cleaned:
            start = cleaned.find(fence) + len(fence)
            end   = cleaned.find("```", start)
            if end != -1:
                cleaned = cleaned[start:end].strip()
                break

    # Find the outermost { } or [ ]
    for start_char, end_char in [('{', '}'), ('[', ']')]:
        start = cleaned.find(start_char)
        if start == -1:
            continue
        # Walk from the end to find matching bracket
        depth = 0
        for i, ch in enumerate(cleaned[start:], start=start):
            if ch == start_char:
                depth += 1
            elif ch == end_char:
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(cleaned[start:i + 1])
                    except json.JSONDecodeError:
                        break
    return None
