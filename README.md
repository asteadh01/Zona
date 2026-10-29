# Zona

A personal sports dashboard for one iPhone, fed by Garmin's Personal API. It shows when and how much you train, what you burn, how you slept, and a daily call from your Body Battery ("Go ahead with your run" … "Maybe stay in and rest a bit"). The water goal starts at a base and rises as each workout syncs, and you get a drink nudge after every session.

It's a home-screen web app (PWA) served by a small FastAPI server, which holds the Garmin key, pulls on a schedule, stores everything in SQLite and sends web push.

Design sketch and decisions: <https://claude.ai/artifact/MmNXJopb7NW6r5RFYVZLJN>. Knowledge base: `ObsidianVault/projects/Zona/`.

## Run it locally on sample data

```bash
uv venv --python 3.14 .venv
uv pip install --python .venv/Scripts/python.exe -r requirements-dev.txt
cp .env.example .env            # then set ZONA_PASSWORD (12+ chars) and ZONA_SESSION_SECRET; placeholders are refused
.venv/Scripts/python.exe -m uvicorn zona.main:app --env-file .env --port 8000
```

Open <http://localhost:8000> and sign in. With `ZONA_FAKE=1`, the app runs on generated history in Garmin's JSON shapes, and the Water tab has a button that finishes a 47-minute run, so you can watch the goal rise and the nudge arrive.

```bash
.venv/Scripts/python.exe -m pytest     # rules, Garmin mapping, sync and nudges, API and auth
```

## Connect your Garmin account

1. On the web, open Garmin Connect › Settings › Personal API Key. Create a key, ideally lasting a year. Garmin shows it once.
2. Put it in `GARMIN_PERSONAL_API_KEY` and set `ZONA_FAKE=0`.
3. Run `python -m zona inspect`. It prints the shape of each response Zona reads: field names and types, not your values. Garmin publishes paths but not response schemas, so check them against `zona/normalize.py`. Raw payloads are also saved in the `raw` table.

The first sync backfills 180 days of activities and 12 weeks of daily data, in chunks that respect Garmin's per-call date caps. After that, Zona checks every 5 minutes for 3 hours after a planned session starts and every 30 minutes otherwise, or every 15 minutes all day if you pick that.

## Notifications on the iPhone

1. Generate keys once with `python -m zona vapid` and put them in `ZONA_VAPID_PRIVATE_KEY` and `ZONA_VAPID_PUBLIC_KEY`.
2. Serve Zona over https (the tunnel does that).
3. In Safari, Share › Add to Home Screen, then open Zona from the icon.
4. In Train, under Zona, tap Turn on notifications.

iOS only allows web push for home-screen apps (16.4+). Your Garmin watch mirrors the notifications, and you can read and dismiss them there.

## Deploy (k3s + Cloudflare Tunnel)

**[docs/PHONE_SETUP.md](docs/PHONE_SETUP.md)** walks through every step, from the Garmin key to the watch buzzing.

In short:
1. Push to a private GitHub repo.
2. Add the repo secrets. `scripts/make_secrets.py` makes the app ones; the cluster ones are the same as SportCove's.
3. Add a `zona` route to the SportCove Cloudflare tunnel.

After that, `.github/workflows/deploy.yml` runs on every push to `main`: tests, an image on GHCR, a deploy over Tailscale, and a `/health` check through the tunnel, with automatic rollback.

It runs one replica on purpose: SQLite lives on a ReadWriteOnce volume, and a single sync loop means each nudge goes out once.

What the server already guards against:
- **Login:** wrong passwords are limited per client IP, using `CF-Connecting-IP` behind the tunnel.
- **Sign out:** revokes every cookie issued so far, and so does changing the password.
- **Requests:** API bodies are capped at 64 KB before anything parses them.
- **Push:** subscriptions are only accepted for Apple's, Google's, Mozilla's and Microsoft's push services. The host is checked with the same URL parser the push request uses, and redirects are refused.

## Layout

| Path | What |
|---|---|
| `zona/rules.py` | the daily call, water goal, nudge decisions, polling interval (pure, fully tested) |
| `zona/normalize.py` | Personal API JSON → `Activity` / `Day` records, tolerant of missing fields |
| `zona/sync.py` | backfill, incremental sync, nudges (with hold-and-merge for back-to-back sessions), morning call, reminders |
| `zona/service.py`, `zona/insights.py` | what each screen shows |
| `zona/garmin.py`, `zona/fake.py` | the live source (Garmin's official client) and the sample-data source |
| `zona/main.py`, `zona/auth.py` | API, one-password sign-in with a signed cookie, security headers |
| `web/` | the PWA: Home (Today · Month · Insights), Trends, Train, Water; service worker for offline and push |

## Not in v1

- **Workouts to the watch (v1.1).** The Personal API is read-only. The routes are the unofficial calendar client or a Connect IQ app that downloads FIT workouts.
- **The Zona watch app (v2).** A Connect IQ app that buzzes the moment a session ends (`registerForActivityCompletedEvent`) and logs +250 ml from the wrist.
