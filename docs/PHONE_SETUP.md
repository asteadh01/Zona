# Putting Zona on your iPhone (Firebase)

From nothing to a drink nudge buzzing on your watch, in about 40 minutes. After that, a release is one command.

## How it fits together

- **Firebase Hosting** serves the app: the screens, the icon, the service worker.
- **Cloud Run** runs Zona's server, the same container as before. It sleeps when nobody's using it.
- **Cloud Scheduler** wakes the server every 5 minutes, so it can check Garmin and send nudges.
- **Firestore** holds your data.
- **Secret Manager** holds the Garmin key, the app password and the push keys, in one secret.

**Cost:** all of this needs the **Blaze** plan, because the free Spark plan can't run any server code. One person's use stays well inside Blaze's free allowances, and you already have a Blaze billing account from cucinIA. The step-1 budget alert tells you if anything ever costs money.

| Step | Where | What you end up with |
|---|---|---|
| 1 | Firebase console | the `zona` project on Blaze, with a $1 budget alert |
| 2 | Firestore | the database |
| 3 | this PC | the two command-line tools, signed in |
| 4 | Garmin Connect (web) | a new Personal API key |
| 5 | this PC | `setup` and `secrets` done |
| 6 | this PC | `deploy`: Zona is live at `https://YOUR-PROJECT.web.app` |
| 7 | GitHub | the code pushed; tests run on every push |
| 8 | iPhone | Zona on the Home Screen, with notifications on |
| 9 | Garmin Connect app | notifications mirrored to the watch |
| 10 | Zona | your week plan, and a check of Garmin's data |

---

## 1. Firebase project on Blaze, with a budget alert

1. Go to [console.firebase.google.com](https://console.firebase.google.com) › **Add project**. Name it **zona**; Google Analytics isn't needed. Write down the **project ID** it shows, such as `zona-12ab3`. Every command below uses it.
2. Bottom left: **Spark › Upgrade** › **Blaze** › choose your **existing billing account** (the one cucinIA uses).
3. When it offers a budget, set **$1**. If it doesn't, open [console.cloud.google.com/billing](https://console.cloud.google.com/billing) › your billing account › **Budgets & alerts › Create budget**:
   - **Scope:** project `zona`.
   - **Amount:** $1.
   - **Alerts:** at 50%, 90% and 100%.

   It's an email warning, not a spending cap.

## 2. Firestore

In the console: **Build › Firestore Database › Create database**.
1. **Edition:** **Standard**, if it asks.
2. **Database ID:** leave it as `(default)`.
3. **Location:** **`nam5 (United States)`**. Zona's server runs in `us-central1`, which is inside that region, and both stay in the free allowance there.
4. **Rules:** **Start in production mode**. Zona's server uses its own credentials, and every deploy also ships `firestore.rules`, which keeps all browser access closed.

## 3. The two command-line tools

You already have the Google Cloud CLI (`gcloud`). Install the Firebase CLI once, then sign both in:

```bash
npm install -g firebase-tools
```

```bash
firebase login
```

```bash
gcloud auth login
```

Both open a browser to sign in with your Google account.

## 4. A new Garmin Personal API key

The key you pasted into the chat earlier should be treated as exposed. On [connect.garmin.com](https://connect.garmin.com) › **Settings › Personal API Key**:
1. Delete the old key.
2. Create a new one that lasts **1 year**.
3. Keep it handy for step 5. Garmin shows it once.

## 5. Setup and secrets

In a terminal in `Desktop\Workspace\Zona`, with your project ID instead of `zona-12ab3`:

```bash
.venv/Scripts/python.exe scripts/zona_cloud.py setup --project zona-12ab3
```

This turns on the seven Google services Zona uses. It creates **`zona-run`**, the account Zona's server runs as, which can use Firestore and read its one secret and nothing else. It also lets the default compute account build the image from source. It's safe to run again.

```bash
.venv/Scripts/python.exe scripts/zona_cloud.py secrets --project zona-12ab3
```

It asks for three things:
- **The Garmin key:** hidden as you type.
- **An email:** Apple's push service wants a contact address, and that's the only place it goes.
- **The app password:** 12+ characters, or press Enter to have one generated.

It generates everything else and stores it all as **one** Secret Manager secret, so it stays inside the free tier. Nothing is written to your disk.

## 6. Deploy

```bash
.venv/Scripts/python.exe scripts/zona_cloud.py deploy --project zona-12ab3
```

The first run takes about 5 minutes. It:
1. builds the server in Google Cloud Build, so nothing builds on this PC;
2. deploys it to Cloud Run;
3. publishes the app and the database rules to Firebase Hosting;
4. creates the 5-minute schedule and fires it once, which starts the first sync: 180 days of activities and 12 weeks of daily data.

It ends by opening `https://zona-12ab3.web.app/health`, which should say `{"ok":true}`. A brand-new site can take a minute to answer.

## 7. GitHub

The repo is still empty. Make it **private** first: **Settings › General › Danger Zone › Change visibility**. Then push:

```bash
git push -u origin main
```

GitHub runs the tests on every push, on SQLite and on the Firestore emulator. Deploying stays a command on your PC, so no cloud credentials live in GitHub.

## 8. iPhone

1. In **Safari**, open **https://zona-12ab3.web.app** and sign in. Let Safari save the password.
2. Tap **Share › Add to Home Screen › Add**.
3. Open Zona **from the new icon**, not from Safari, and sign in once more. iOS keeps home-screen apps separate from Safari.
4. Go to the **Train** tab › **Zona** card › **Turn on notifications** › **Allow**.
5. Tap **Send a test**. "Zona is set up" should arrive within seconds.
6. In **iPhone Settings › Notifications › Zona**, make sure **Lock Screen**, **Notification Center** and **Banners** are all on.

## 9. Your watch

1. Open the **Garmin Connect** app › your watch › **Notifications & Alerts › Smart Notifications** and turn them on.
2. In Zona, go to **Train › Zona**, tap **Test the watch: send in 10 s, then lock the phone**, and lock the phone right away. The watch should buzz.

## 10. Make it yours

- **Train › Every week:** add the sessions you usually do. Zona uses them for:
  - the morning call ("Go ahead with your run");
  - checking Garmin every 5 minutes right after a planned session;
  - sending one nudge for back-to-back sessions.
- **Check Garmin's data once:** go to **Train › Zona › Garmin data shapes** and send me what it shows. It lists field names and types only, never your numbers, so it's safe to share. It confirms Zona reads calories, sleep, HRV and Body Battery from the right fields.

---

## Later

| When | Run this |
|---|---|
| Code changed | `scripts/zona_cloud.py deploy --project ID` |
| Garmin key expiring, or Home shows **"Garmin key refused"** | `scripts/zona_cloud.py secrets --project ID --only GARMIN_PERSONAL_API_KEY`, then `deploy` |
| New app password | `secrets --only ZONA_PASSWORD`, then `deploy`. Every device is signed out |
| Your own address, e.g. `zona.steaddev.cl` | Firebase console › **Hosting › Add custom domain**. In Cloudflare DNS, add the records it gives you with the proxy **off** (grey cloud). Then `deploy --origin https://zona.steaddev.cl` |

## If something's off

| Symptom | Likely cause |
|---|---|
| `gcloud` or `firebase` says permission denied | You're signed in as a different Google account. Run `gcloud auth login` or `firebase login` again |
| `setup` fails enabling services | The project isn't on Blaze yet (step 1) |
| `deploy` fails while building | `setup` wasn't run, or it ran before Blaze. Run it again. It's safe to repeat |
| `/health` doesn't answer after a few minutes | In the Cloud Run console, open the **zona** service's **Logs**. A `ConfigError` names the bad setting |
| Signing in works but nothing saves | You opened a `run.app` address. Use the `web.app` one, or add your custom domain with `--origin` |
| "Sync failed" on Home | Garmin didn't answer. The next 5-minute tick retries, or tap the chip to retry now |
| No notification arrives | iPhone Settings › Notifications › Zona, Focus modes, and in Zona, Train › Zona › devices registered |
| A Firebase budget email arrives | Tell me what it says. Something is outside the free allowances |
