# Zona

A personal sports dashboard for one iPhone, fed by Garmin's Personal API. It shows when and how much you train, what you burn, how you slept, and a daily call from your Body Battery ("Go ahead with your run" … "Maybe stay in and rest a bit"). The water goal starts at a base and rises as each workout syncs, and you get a drink nudge after every session.

It's a native iPhone app built with Expo, the same stack as cucinIA, and installed from an EAS build. A small FastAPI server on Cloud Run holds the Garmin key and stores everything in Firestore. Cloud Scheduler wakes it every 5 minutes to pull from Garmin and send notifications through Expo's push service.

Design sketch and decisions: <https://claude.ai/artifact/MmNXJopb7NW6r5RFYVZLJN>. Knowledge base: `ObsidianVault/projects/Zona/`.

## Put it on your phone

**[docs/PHONE_SETUP.md](docs/PHONE_SETUP.md)** walks through every step, from the Firebase project to the watch buzzing. After setup, a server release is one command, and most app releases are one over-the-air update. Native changes need a new EAS build:

```bash
.venv/Scripts/python.exe scripts/zona_cloud.py deploy --project YOUR-PROJECT-ID
```

```bash
cd mobile && npx eas-cli update --channel phone --platform ios --message "what changed" --environment production
```

It runs on Firebase's Blaze plan, and one person's use stays inside Blaze's free allowances:
- **Cloud Run:** at most one instance, and it sleeps between requests.
- **Firestore:** only changed activities are written, and no query needs an index.
- **Secret Manager:** one secret holds everything.
- **Artifact Registry:** keeps the last two images.

## Run it locally on sample data

```bash
uv venv --python 3.14 .venv
uv pip install --python .venv/Scripts/python.exe -r requirements-dev.txt
cp .env.example .env            # then set ZONA_PASSWORD (12+ chars) and ZONA_SESSION_SECRET; placeholders are refused
.venv/Scripts/python.exe -m uvicorn zona.main:app --env-file .env --port 8000
```

Then, in a second terminal, start the app in a browser:

```bash
cd mobile && npm install && npm run web
```

Open <http://localhost:8081> and sign in. With `ZONA_FAKE=1`, the server runs on generated history in Garmin's JSON shapes, and the Water tab has a button that finishes a 47-minute run, so you can watch the goal rise and the nudge arrive. Local runs use SQLite and the in-process sync loop; set `ZONA_STORE=firestore` to use Firestore instead. The browser build is only for checking screens: it has no notifications, and `ZONA_DEV_CORS_ORIGIN` must match its address.

## Tests

```bash
.venv/Scripts/python.exe -m pytest
```

That runs everything on SQLite and skips the Firestore half. To run every storage, sync and API test against Firestore too, run it under the emulator. It needs Java and the Firebase CLI; this is what CI runs:

```bash
firebase emulators:exec --only firestore --project demo-zona "C:/Users/astea/Desktop/Workspace/Zona/.venv/Scripts/python.exe -m pytest"
```

The app has its own checks, in `mobile/`:

```bash
npm run typecheck && npm test
```

## Garmin data

Garmin publishes the Personal API's paths but not its response schemas. To check `zona/normalize.py` against real data, open **Train › Zona › Garmin data shapes** in the app. It shows field names and types, never values. With the key in your shell, `python -m zona inspect` prints the same.

The first sync backfills 180 days of activities and 12 weeks of daily data, in chunks that respect Garmin's per-call date caps. After that, Zona calls Garmin every 5 minutes for 3 hours after a planned session starts, and every 30 minutes otherwise, or every 15 minutes all day if you pick that. The scheduler wakes it every 5 minutes either way.

## What the server guards against

- **Login:** wrong passwords are limited per client, using the address Cloud Run appends rather than any the client claims. Past 60 attempts from anywhere in 15 minutes, nobody can log in until the window passes, but phones already signed in keep working.
- **Sessions:** the app holds a signed bearer token in the iPhone's Keychain. Signing out revokes every token and forgets every registered phone, and changing the password revokes every token too. With no cookies, there's nothing for cross-site requests to borrow.
- **Requests:** API bodies are capped at 64 KB before anything parses them. `/internal/tick` needs the scheduler's secret.
- **Push:** the server only accepts tokens shaped like Expo's and only ever sends to Expo's address, so a stored token can't redirect a request elsewhere. Tokens Expo reports as dead are dropped.
- **Notifications in the app:** a tapped notification can only open a known screen, and only a sane amount of water can be logged from one (`mobile/src/utils/notification-payload.ts`).
- **Firestore:** `firestore.rules` refuses all client access. Only the server's service account reads and writes.

## Layout

| Path | What |
|---|---|
| `zona/rules.py` | the daily call, water goal, nudge decisions, polling interval (pure, fully tested) |
| `zona/normalize.py` | Personal API JSON → `Activity` / `Day` records, tolerant of missing fields |
| `zona/sync.py` | backfill, incremental sync, nudges (with hold-and-merge for back-to-back sessions), morning call, reminders |
| `zona/db.py`, `zona/firestore_store.py` | the `Store`: SQLite for local runs, Firestore on Cloud Run |
| `zona/service.py`, `zona/insights.py` | what each screen shows |
| `zona/garmin.py`, `zona/fake.py` | the live source (Garmin's official client) and the sample-data source |
| `zona/push.py` | notifications through Expo's push service |
| `zona/main.py`, `zona/auth.py` | API, the scheduler tick, one-password sign-in with a signed bearer token |
| `mobile/src/app/` | the Expo app's routes: sign-in, Home (Today · Month · Insights), Trends, Train, Water |
| `mobile/src/features/`, `components/`, `services/` | what each screen draws, shared UI and charts, the API client and notifications |
| `firebase.json`, `firestore.rules`, `Dockerfile`, `scripts/zona_cloud.py` | how the server is deployed |
| `mobile/eas.json`, `mobile/app.json` | how the app is built and updated |

## Not in v1

- **Workouts to the watch (v1.1).** The Personal API is read-only. The routes are the unofficial calendar client or a Connect IQ app that downloads FIT workouts.
- **The Zona watch app (v2).** A Connect IQ app that buzzes the moment a session ends (`registerForActivityCompletedEvent`) and logs +250 ml from the wrist.
