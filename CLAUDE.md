# Zona

Personal iPhone sports dashboard on Garmin's Personal API: a FastAPI server (sync, rules, web push) plus a no-build PWA in `web/`. In production that's Firebase Hosting + Cloud Run (one instance) + Firestore + Cloud Scheduler, deployed with `scripts/zona_cloud.py` (docs/PHONE_SETUP.md). Locally it's SQLite with an in-process loop. One user.

- **Run:** `.venv/Scripts/python.exe -m uvicorn zona.main:app --env-file .env --port 8000`, with `ZONA_FAKE=1` for sample data.
- **Test:** `.venv/Scripts/python.exe -m pytest` (SQLite). Add the Firestore emulator for the full run: `firebase emulators:exec --only firestore --project demo-zona "<venv python> -m pytest"`.
  - The `store` fixture runs every storage test on both, so a change to one store needs the same change in the other (`db.Repo` / `firestore_store.FirestoreStore`, both following `db.Store`).
- **Rules:** `zona/rules.py` is pure. Add a test there first when a rule changes.
- **FastAPI and postponed annotations:** `main.py` uses them, so FastAPI dependencies and request models must live at module level. A dependency defined inside `create_app()` turns into a query parameter.
- **Cloud Run CPU:** Cloud Run gives CPU only while a request is open, so never leave work for after the response (no BackgroundTasks). The scheduler's `/internal/tick` does the syncing there; `ZONA_SYNC=0` turns the loop off.
- **Behind Firebase Hosting:**
  - Only the `__session` cookie reaches Cloud Run.
  - Cloud Run sees its own `run.app` Host, so the same-origin check uses `X-Forwarded-Host` and `ZONA_ORIGINS`.
  - Hosting rewrites time out at 60 s.
- **Security headers:** static files get theirs from `firebase.json`, API responses from `main.py`. A test keeps the CSPs identical.
- **Garmin field names:** unverified until real data has been checked (Train › Zona › Garmin data shapes, or `python -m zona inspect`). Keep `normalize.py` tolerant (`dig` with fallbacks) and never zero-fill missing fields.
- **Git:** never push to a remote; local commits only. Deploying is the user's command, never run with their project.

## Knowledge Base
Path: C:\Users\astea\Desktop\Workspace\ObsidianVault\projects\Zona

When you need context not in this repo (why a decision was made, what the sketch settled), read that project's Home.md first, then drill into product/dev/features.
