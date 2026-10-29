# Zona

Personal iPhone sports dashboard on Garmin's Personal API: a FastAPI + SQLite server (sync loop, rules, web push) plus a no-build PWA in `web/`. One user, one replica.

- Run: `.venv/Scripts/python.exe -m uvicorn zona.main:app --env-file .env --port 8000`, with `ZONA_FAKE=1` for sample data.
- Test: `.venv/Scripts/python.exe -m pytest`. Rules in `zona/rules.py` are pure, so add a test there first when a rule changes.
- `main.py` uses postponed annotations, so FastAPI dependencies and request models must live at module level. A dependency defined inside `create_app()` turns into a query parameter.
- Garmin response field names are unverified until real data has been checked with `python -m zona inspect`. Keep `normalize.py` tolerant (`dig` with fallbacks) and never zero-fill missing fields.
- Never push to a remote; local commits only.

## Knowledge Base
Path: C:\Users\astea\Desktop\Workspace\ObsidianVault\projects\Zona

When you need context not in this repo (why a decision was made, what the sketch settled), read that project's Home.md first, then drill into product/dev/features.
