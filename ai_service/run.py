"""
Convenience launcher for the SkillSync AI service.
Usage: python run.py
"""
import os
import uvicorn

if __name__ == "__main__":
    port     = int(os.getenv("AI_SERVICE_PORT", 8000))
    log_lvl  = os.getenv("AI_SERVICE_LOG_LEVEL", "info")
    reload   = os.getenv("AI_SERVICE_RELOAD", "true").lower() == "true"

    print(f"Starting SkillSync AI service on port {port}  (reload={reload})")
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=reload, log_level=log_lvl)
