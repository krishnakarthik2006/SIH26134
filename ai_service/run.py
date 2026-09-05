"""
Convenience launcher for the SkillSync AI service.
Usage: python run.py
"""
import os
import uvicorn

if __name__ == "__main__":
    port    = int(os.getenv("AI_SERVICE_PORT", 8000))
    log_lvl = os.getenv("AI_SERVICE_LOG_LEVEL", "info")
    reload  = os.getenv("AI_SERVICE_RELOAD", "true").lower() == "true"

    model   = os.getenv("OLLAMA_MODEL", "llama3.2:3b")
    ollama  = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")

    print(f"SkillSync AI Service v2.0 — Ollama Edition")
    print(f"  Model  : {model}")
    print(f"  Ollama : {ollama}")
    print(f"  Port   : {port}")
    print(f"  Reload : {reload}")

    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=reload, log_level=log_lvl)
