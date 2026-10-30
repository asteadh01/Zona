# Zona

Personal iPhone sports dashboard on Garmin's Personal API: a FastAPI server (sync, rules, Expo push) plus a native Expo app in `mobile/`, the same stack as cucinIA. In production the server is Cloud Run (one instance) + Firestore + Cloud Scheduler, deployed with `scripts/zona_cloud.py`, and the app is an EAS build (docs/PHONE_SETUP.md). Locally it's SQLite with an in-process loop. One user.

- **Run:** `.venv/Scripts/python.exe -m uvicorn zona.main:app --env-file .env --port 8000`, with `ZONA_FAKE=1` for sample data. For the app, `npm run web` in `mobile/` previews the screens at `localhost:8081` (needs `ZONA_DEV_CORS_ORIGIN=http://localhost:8081`). Notifications only work in a real iPhone build.
- **Test:** `.venv/Scripts/python.exe -m pytest` (SQLite). Add the Firestore emulator for the full run: `firebase emulators:exec --only firestore --project demo-zona "<venv python> -m pytest"`.
  - The `store` fixture runs every storage test on both, so a change to one store needs the same change in the other (`db.Repo` / `firestore_store.FirestoreStore`, both following `db.Store`).
- **Test the app:** in `mobile/`, `npm run typecheck` and `npm test`. Run `npx expo-doctor` after changing dependencies.
- **Rules:** `zona/rules.py` is pure. Add a test there first when a rule changes.
- **FastAPI and postponed annotations:** `main.py` uses them, so FastAPI dependencies and request models must live at module level. A dependency defined inside `create_app()` turns into a query parameter.
- **Cloud Run CPU:** Cloud Run gives CPU only while a request is open, so never leave work for after the response (no BackgroundTasks). The scheduler's `/internal/tick` does the syncing there; `ZONA_SYNC=0` turns the loop off.
- **Auth:** bearer tokens only, kept in the Keychain (`expo-secure-store`). No cookies, so no origin checks or CSP. Logout revokes every token and deletes every push token.
- **App conventions:** as of Expo SDK 56, import navigation from `expo-router/react-navigation`, not `@react-navigation/native`. Anything from a notification or a deep link gets validated before use (`utils/notification-payload.ts`). Change `src/types/api.ts` when an API response changes.
- **App updates:** `eas update` covers JavaScript and images only, and reaches builds with the same `version` in `app.json` (`runtimeVersion` follows it). A native change needs that version raised and a new build. The server's address lives in `utils/api-base.ts`, because `eas.json` settings don't reach updates.
- **Server and app ship separately:** the app must draw with a server that's behind. Make new API fields optional in `src/types/api.ts` and give them a default; on 2026-10-30 a required `sessions.maybe` crashed the app on launch when an update went out before the deploy. `components/app-error.tsx` is the last line of defence: it keeps **Check for an app update** reachable when a screen fails, so don't make it depend on the API.
- **Garmin field names:** checked against real responses on 2026-10-30; Garmin can still change them (Train › Zona › Garmin data shapes, or `python -m zona inspect`). Keep `normalize.py` tolerant (`dig` with fallbacks) and never zero-fill missing fields. After changing how daily data is read, bump `sync.WELLNESS_VERSION` so stored days are read again.
- **Git:** never push to a remote; local commits only. Deploying, EAS builds and EAS updates are the user's commands, never run with their project.

## Knowledge Base
Path: C:\Users\astea\Desktop\Workspace\ObsidianVault\projects\Zona

When you need context not in this repo (why a decision was made, what the sketch settled), read that project's Home.md first, then drill into product/dev/features.
