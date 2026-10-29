# Putting Zona on your iPhone

From nothing to a drink nudge buzzing on your watch. Plan on about 45 minutes the first time. After that, every push to `main` deploys by itself.

Zona runs on your home k3s cluster next to SportCove. It uses the same GitHub Actions + Tailscale + GHCR pipeline and the same Cloudflare Tunnel, with a new hostname: **zona.steaddev.cl**. The phone opens it as a home-screen app.

| Step | Where | What you end up with |
|---|---|---|
| 1 | Garmin Connect (web) | your Personal API key |
| 2 | GitHub | a private `zona` repo with this code |
| 3 | Tailscale, node 1, GitHub | the 4 secrets that let Actions reach the cluster |
| 4 | this PC | the 6 app secrets in the repo |
| 5 | Cloudflare | `zona.steaddev.cl` routed to Zona |
| 6 | GitHub Actions | Zona running, `/health` green |
| 7 | iPhone | Zona on the Home Screen, notifications on |
| 8 | Garmin Connect app | notifications mirrored to the watch |
| 9 | Zona | your week plan, and a check of Garmin's data |

---

## 1. Garmin Personal API key

1. On a computer, sign in at [connect.garmin.com](https://connect.garmin.com).
2. Open **Settings › Personal API Key** (or go straight to `connect.garmin.com/app/settings/personalApiToken`).
3. Create a key that lasts **1 year**. Garmin shows it **once**, so copy it somewhere safe for step 4.

Don't paste it into chat, a file in the repo, or anywhere else.

## 2. GitHub repo

1. Go to [github.com/new](https://github.com/new). Name it **zona**, make it **Private**, and don't add a README, .gitignore or license.
2. In a terminal in `Desktop\Workspace\Zona`, run these two commands, using your GitHub username in the URL:

```bash
git remote add origin https://github.com/YOUR-USERNAME/zona.git
```

```bash
git push -u origin main
```

The **Actions** tab starts a run right away. The tests pass, the image builds, and then the deploy stops at **"Check the repo secrets exist"**. That's expected until steps 3 and 4 are done.

## 3. Cluster access (the same four secrets SportCove uses)

Add each one at **GitHub › zona › Settings › Secrets and variables › Actions › New repository secret**. GitHub won't show you SportCove's values again, so either reuse them from wherever you saved them, or make new ones as below.

| Secret | How to get it |
|---|---|
| `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET` | Tailscale admin › **Settings › OAuth clients › Generate**. Scope: **Auth Keys: write**. Tags: **tag:ci**. The `tag:ci` ACL rule from SportCove's setup already grants it the API server. |
| `KUBECONFIG_RAW` | On node 1: `sudo cat /etc/rancher/k3s/k3s.yaml`. Replace `127.0.0.1` with node 1's **tailnet** IP (`tailscale ip -4` on that node) and paste the whole file as the value. |
| `GHCR_PULL_TOKEN` | GitHub › your avatar › **Settings › Developer settings › Personal access tokens › Tokens (classic) › Generate**. Only scope: **read:packages**. Expiry: 1 year, and put a reminder in your calendar, because the cluster can't pull the image once it expires. |

## 4. App secrets

In `Desktop\Workspace\Zona`, run:

```bash
.venv/Scripts/python.exe scripts/make_secrets.py
```

It asks for:
- **The Garmin key** from step 1. It's hidden as you type.
- **An email.** Apple's push service wants a contact address, and that's the only place it goes.
- **The app password.** You type it on the phone once, so pick 12+ characters or press Enter to have one generated.

It then generates the cookie secret and the push keys and prints six name/value pairs. Add each one as a repository secret, the same way as in step 3. If you install the GitHub CLI (`winget install GitHub.cli`, then `gh auth login`), it can set them for you instead:

```bash
.venv/Scripts/python.exe scripts/make_secrets.py --gh YOUR-USERNAME/zona
```

Run it **once**. Running it again makes new push keys, and you'd have to turn notifications on again on the phone.

*Only if you want a hostname other than `zona.steaddev.cl`:* add it under **Variables** (not Secrets) as `ZONA_HOST`.

## 5. Cloudflare: give Zona its address

Zona uses the tunnel SportCove's `cloudflared` already runs, with one more route on it.

1. Cloudflare dashboard › **Zero Trust › Networks › Tunnels** › your SportCove tunnel (`sportcove-prod`) › **Public hostnames** (newer dashboards call it **Published application routes**) › **Add**.
2. Fill in:
   - **Subdomain:** `zona`
   - **Domain:** `steaddev.cl`
   - **Service type:** `HTTP`
   - **URL:** `zona.zona.svc.cluster.local:80`
3. Save. Cloudflare creates the DNS record and the certificate for you.

Leave Cloudflare Access off for Zona. It has its own password, and an Access login page inside a home-screen app is clunky on iOS. If you add it anyway, give `/health` a Bypass policy, or the deploy's health check will fail.

## 6. Deploy

GitHub › zona › **Actions** › **Test, build and deploy** › open the last run › **Re-run all jobs**. You can also use **Run workflow**, or just push again.

All three jobs should go green. The last step opens `https://zona.steaddev.cl/health`. Open it yourself too: it should say `{"ok":true}`.

The first sync starts as soon as the pod is up. It pulls 180 days of activities and 12 weeks of daily data, which takes a minute or two.

## 7. iPhone

1. In **Safari**, open **https://zona.steaddev.cl** and sign in. Let Safari save the password.
2. Tap **Share › Add to Home Screen › Add**.
3. Open Zona **from the new icon**, not from Safari. Home-screen apps keep their own storage on iOS, so sign in once more.
4. Go to the **Train** tab › **Zona** card › **Turn on notifications** › **Allow**.
5. Tap **Send a test**. A "Zona is set up" notification should appear within seconds.
6. Check **iPhone Settings › Notifications › Zona**. **Allow Notifications** should be on, with **Lock Screen**, **Notification Center** and **Banners** all ticked.

Notifications only work in the home-screen app (iOS 16.4 or later). In a Safari tab, the button tells you to add Zona to the Home Screen first.

## 8. Your watch

Garmin mirrors whatever lands in the iPhone's Notification Center.

1. Open the **Garmin Connect** app › your watch › **Notifications & Alerts › Smart Notifications** and turn them on. Also turn them on **during activity** if you want nudges mid-session (Zona's are after the session anyway).
2. In Zona, go to **Train › Zona** and tap **Test the watch: send in 10 s, then lock the phone**. Lock the phone right away. The watch should buzz with Zona's message, since Garmin mirrors while the phone is locked.

You can read and dismiss Zona's notifications on the watch. Logging water happens on the phone, from the card the notification opens.

## 9. Make it yours

- **Train › Every week:** add the sessions you usually do. Zona uses them for:
  - the morning call ("Go ahead with your run");
  - checking Garmin every 5 minutes right after a planned session;
  - sending one nudge for back-to-back sessions.
- **Water:** the goal is 3 L + 500 ml per hour of sport. The steppers change both numbers, and Reminders sets how often you're reminded.
- **Check Garmin's data once:** go to **Train › Zona › Garmin data shapes** and send me what it shows. It lists field names and types only, never your numbers. Garmin doesn't publish its response formats, so this is how we confirm Zona reads calories, sleep, HRV and Body Battery from the right fields.

---

## Later

| When | Do this |
|---|---|
| Garmin emails that your key expires soon (or Home shows **"Garmin key refused"**) | Make a new key (step 1), update the `GARMIN_PERSONAL_API_KEY` secret, then **Actions › Run workflow** |
| The `GHCR_PULL_TOKEN` expires | Make a new one (step 3), update the secret, then **Run workflow** |
| You want a new password | Update `ZONA_PASSWORD`, then **Run workflow**. Every device is signed out |
| A code change | Commit and push to `main`. It tests, builds and deploys, and rolls back on its own if the new version doesn't come up |

## If something's off

| Symptom | Likely cause |
|---|---|
| The deploy stops at **Check the repo secrets exist** | The log lists the missing secret names. Add them (steps 3 and 4) |
| **Wait for the cluster API** times out | The Tailscale OAuth client lacks **Auth Keys: write** or **tag:ci**, or the kubeconfig still says `127.0.0.1` |
| **Wait for the rollout** fails with `ImagePullBackOff` | `GHCR_PULL_TOKEN` is wrong or expired, or lacks `read:packages` |
| **Wait for the rollout** fails with `CrashLoopBackOff` | The step prints the pod log. A `ConfigError` names the bad setting, such as a password under 12 characters |
| **Health check through the tunnel** fails | The Cloudflare route (step 5) is missing, or its URL isn't `zona.zona.svc.cluster.local:80` |
| "Add Zona to your Home Screen first" | You're in Safari. Open Zona from its icon |
| **Send a test** says nothing was sent | Notifications aren't on for this device yet. Tap **Turn on notifications** |
| The test shows on the phone but not the watch | Smart Notifications are off in Garmin Connect, or the watch isn't connected |
| The app shows **"Sync failed"** | Garmin didn't answer. Zona retries by itself, or tap the chip to retry now |
