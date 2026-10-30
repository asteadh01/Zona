# Putting Zona on your iPhone

Zona is a real iPhone app, built the same way as cucinIA: Expo, built in the cloud by EAS, and installed from a link. You don't need a Mac.

**You've already done steps 1 to 5** with the web version. Start at **step 6**. Steps 1 to 5 stay here in case you ever rebuild the project from nothing.

## How it fits together

- **The app** (`mobile/`) runs on your iPhone. It keeps its sign-in in the iPhone's Keychain.
- **Cloud Run** runs Zona's server. It sleeps when nobody's using it.
- **Cloud Scheduler** wakes the server every 5 minutes, so it can check Garmin and send nudges.
- **Firestore** holds your data.
- **Secret Manager** holds the Garmin key and the app password, in one secret.
- **Expo's push service** passes notifications to Apple, and Apple delivers them to your phone. Your watch mirrors them.

**Cost:** the Firebase side stays inside the Blaze plan's free allowances, and the step-1 budget alert tells you if it ever doesn't. The app needs your Apple Developer account, which you already pay for with cucinIA, and Expo's free plan covers the occasional build.

| Step | Where | What you end up with |
|---|---|---|
| 1 to 5 | Firebase, Garmin, this PC | the project, the database, the Garmin key and the secrets (done) |
| 6 | this PC | the new server live, and the old web app switched off |
| 7 | this PC | the Zona project on EAS |
| 8 | this PC + iPhone | your iPhone registered, and Developer Mode on |
| 9 | this PC | the app built |
| 10 | iPhone | Zona installed, with notifications on |
| 11 | Garmin Connect app | notifications mirrored to the watch |
| 12 | Zona | your week plan, and a check of Garmin's data |

**Run everything in PowerShell.** Git Bash's default window can't handle sign-in or hidden prompts properly.

---

## Done already: steps 1 to 5

<details>
<summary>Only needed if you start again from nothing</summary>

### 1. Firebase project on Blaze, with a budget alert

1. Go to [console.firebase.google.com](https://console.firebase.google.com) › **Add project**. Name it **zona**; Google Analytics isn't needed. The project ID is `zona-624e5`; every command below uses it.
2. Bottom left: **Spark › Upgrade** › **Blaze** › choose your **existing billing account** (the one cucinIA uses).
3. When it offers a budget, set **$1**, with alerts at 50%, 90% and 100%. It's an email warning, not a spending cap.

### 2. Firestore

In the console: **Build › Firestore Database › Create database**. Choose **Standard** edition, the `(default)` database ID, **`nam5 (United States)`**, and **production mode**.

### 3. The two command-line tools

You need the Google Cloud CLI (`gcloud`). The Firebase CLI runs through `npx`. Sign both in, in `Desktop\Workspace\Zona`:

```powershell
npx.cmd --yes firebase-tools@15 login
```

```powershell
gcloud auth login
```

### 4. A Garmin Personal API key

On [connect.garmin.com](https://connect.garmin.com) › **Settings › Personal API Key**, create a key that lasts **1 year**. Garmin shows it once.

### 5. Setup and secrets

```powershell
.venv/Scripts/python.exe scripts/zona_cloud.py setup --project zona-624e5
```

```powershell
.venv/Scripts/python.exe scripts/zona_cloud.py secrets --project zona-624e5
```

It asks for the Garmin key and the app password, both hidden as you type. Press Enter at the password prompt to have one generated.

</details>

---

## 6. Update the server and switch off the old web app

In `Desktop\Workspace\Zona`, first clear the old web app's push keys out of the secret. It asks for the app password; type the same one again, or a new one:

```powershell
.venv/Scripts/python.exe scripts/zona_cloud.py secrets --project zona-624e5 --only ZONA_PASSWORD
```

Then deploy:

```powershell
.venv/Scripts/python.exe scripts/zona_cloud.py deploy --project zona-624e5
```

This takes about 5 minutes and ends with `OK: .../health answered 200`. The server now signs in with app tokens and sends notifications through Expo. **From this moment the old home-screen web app stops working**, so delete its icon from your phone.

Then take the old site offline:

```powershell
npx.cmd --yes firebase-tools@15 hosting:disable --project zona-624e5
```

And delete the old web app's notification subscriptions, which nothing reads anymore. It asks you to confirm:

```powershell
npx.cmd --yes firebase-tools@15 firestore:delete push_subs --recursive --project zona-624e5
```

## 7. The Zona project on EAS

Move to the app's folder. Every command from here on runs in `Desktop\Workspace\Zona\mobile`:

```powershell
cd mobile
```

```powershell
npm install
```

Sign in with your Expo account, `asteadh01`, the same one as cucinIA:

```powershell
npx.cmd --yes eas-cli login
```

```powershell
npx.cmd --yes eas-cli init
```

Say **yes** to creating the project `@asteadh01/zona`. This writes the project's ID into `app.json`, which notifications need, so commit that change afterwards.

## 8. Your iPhone

Your phone needs to be on the app's device list, and iOS needs Developer Mode on to open apps installed this way.

1. Check whether your phone is already registered from cucinIA. This list should include it:

   ```powershell
   npx.cmd --yes eas-cli device:list
   ```

2. If it isn't, run this, open the link it gives you on the iPhone, and install the profile:

   ```powershell
   npx.cmd --yes eas-cli device:create
   ```

3. Turn on Developer Mode: **Settings › Privacy & Security › Developer Mode**. The phone restarts and asks you to confirm.

## 9. Build the app

```powershell
npx.cmd --yes eas-cli build --profile phone --platform ios
```

Answer the prompts like this:

| It asks | Answer |
|---|---|
| Log in to your Apple account | **Yes**, and sign in with your Apple Developer account |
| Generate a new Distribution Certificate, or reuse one | Either is fine; reuse the one cucinIA has if it's offered |
| Which devices to include | Your iPhone |
| Set up Push Notifications / generate a new Apple Push Notifications key | **Yes**. Without this, notifications can't reach the phone |

The build runs in Expo's cloud and takes about 15 minutes. It ends with a link and a QR code.

## 10. Install it

1. Open the link or scan the QR code on the iPhone, then tap **Install**. Zona appears on your Home Screen.
2. Open Zona and sign in with the app password from step 5.
3. Go to the **Train** tab › **Zona** card › **Turn on notifications** › **Allow**.
4. Tap **Send a test**. "Zona is set up" should arrive within seconds.
5. In **iPhone Settings › Notifications › Zona**, make sure **Lock Screen**, **Notification Center** and **Banners** are all on.

## 11. Your watch

1. Open the **Garmin Connect** app › your watch › **Notifications & Alerts › Smart Notifications** and turn them on.
2. In Zona, go to **Train › Zona**, tap **Test the watch: send in 10 s, then lock**, and lock the phone right away. The watch should buzz.

## 12. Make it yours

- **Train › Every week:** add the sessions you usually do. Zona uses them for:
  - the morning call ("Go ahead with your run");
  - checking Garmin every 5 minutes right after a planned session;
  - sending one nudge for back-to-back sessions.
- **Check Garmin's data once:** go to **Train › Zona › Garmin data shapes**, tap **Share**, and send me what it shows. It lists field names and types only, never your numbers, so it's safe to share. It confirms Zona reads calories, sleep, HRV and Body Battery from the right fields.

---

## Later

| When | Run this |
|---|---|
| The app's screens or logic changed (`mobile/`) | An over-the-air update, see below |
| A native package or `app.json` changed, or Expo was upgraded | A new build, see below |
| The server changed (`zona/`) | In `Zona`: `scripts/zona_cloud.py deploy --project zona-624e5` |
| A new iPhone | `eas-cli device:create`, then build again |
| The app stops opening after about a year | The Apple certificate expired. Build again; EAS offers to renew it |
| You'd rather install through TestFlight | `eas-cli build --profile production --platform ios --auto-submit`. It needs the app created in App Store Connect first, and TestFlight builds last 90 days |
| Garmin key expiring, or Home shows **"Garmin key refused"** | `scripts/zona_cloud.py secrets --project zona-624e5 --only GARMIN_PERSONAL_API_KEY`, then `deploy` |
| New app password | `secrets --only ZONA_PASSWORD`, then `deploy`. Every device is signed out |

## Updating the app

**Over the air, for screens, text, logic and images.** In `mobile`:

```bash
npx --yes eas-cli update --channel phone --platform ios --message "what changed" --environment production
```

The phone downloads it the next time Zona opens and uses it from the launch after that. To get it right away, tap **Train › Zona › Check for an app update**, which restarts the app into it. The line under that button says what's running.

**A new build, for anything native:** a new native package, a change to `app.json` such as the icon, or an Expo upgrade.

1. Raise `version` in `mobile/app.json`, for example from `1.0.0` to `1.1.0`. An update only reaches builds with the same version, so this stops a new update landing on an app that lacks the native parts it needs.
2. Build, then install from the new link. Your sign-in and data stay:

   ```bash
   winpty npx.cmd --yes eas-cli build --profile phone --platform ios
   ```

To undo a bad update, run `npx --yes eas-cli update:roll-back-to-embedded --channel phone --platform ios --message "undo"`. Phones go back to what the build shipped with.

## If something's off

| Symptom | Likely cause |
|---|---|
| `eas-cli` can't prompt, or says it's non-interactive | You're in Git Bash. Use PowerShell |
| `npx` is blocked by "running scripts is disabled" | Type `npx.cmd` instead of `npx` |
| Tapping **Install** does nothing, or the app says "Unable to Install" | Your iPhone wasn't on the list when the app was built. Do step 8, then build again |
| The app won't open and mentions Developer Mode | Turn it on (step 8) |
| "This build has no EAS project ID" in Zona | `eas-cli init` hadn't run before the build. Run it, then build again |
| "Send a test" does nothing | The push key wasn't set up. Run `eas-cli credentials`, choose iOS › **Push Notifications**, add a key, and try again; no new build is needed |
| Zona says it can't reach the server | Open `https://zona-jzdswiuy2a-uc.a.run.app/health` in Safari; it should say `{"ok":true}`. If that fails, open the **zona** service's **Logs** in the Cloud Run console. A `ConfigError` names the bad setting |
| "Too many wrong passwords" at sign-in | Five wrong tries from your address, or a lot of wrong tries from anywhere. Wait 15 minutes. A phone that's already signed in keeps working |
| "Sync failed" on Home | Garmin didn't answer. The next 5-minute tick retries, or tap the chip to retry now |
| No notification arrives | iPhone Settings › Notifications › Zona, Focus modes, and in Zona, Train › Zona › devices registered |
| `gcloud` or `firebase` says permission denied | You're signed in as a different Google account. Run `gcloud auth login` or `npx.cmd --yes firebase-tools@15 login` again |
| "Zona is up to date" right after publishing | The update's `version` doesn't match the installed build, or that build predates updates. Compare with **Train › Zona**, and build again if needed |
| A Firebase budget email arrives | Tell me what it says. Something is outside the free allowances |
