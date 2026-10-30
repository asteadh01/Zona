"""Put Zona's server on Google Cloud: Cloud Run, Firestore, Secret Manager, Cloud Scheduler. The app itself ships with EAS.

Run from the repo root (docs/PHONE_SETUP.md walks through it):
  .venv/Scripts/python.exe scripts/zona_cloud.py setup   --project YOUR-PROJECT-ID   # once
  .venv/Scripts/python.exe scripts/zona_cloud.py secrets --project YOUR-PROJECT-ID   # once
  .venv/Scripts/python.exe scripts/zona_cloud.py deploy  --project YOUR-PROJECT-ID   # every release
  .venv/Scripts/python.exe scripts/zona_cloud.py secrets --project ID --only GARMIN_PERSONAL_API_KEY   # renew one

Every gcloud and firebase command is printed before it runs, with secrets masked. The bundle goes in on stdin, so it
never lands in shell history. Only the tick header is an argument, briefly, on your own PC. Nothing secret is written to disk.
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import secrets as rnd
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from zona.config import BUNDLED, MIN_PASSWORD_LEN, PLACEHOLDERS  # noqa: E402

REGION = "us-central1"  # in Cloud Run's free tier, and where (or next to where) Firestore lives
SERVICE, SECRET, JOB, ART_REPO = "zona", "zona-env", "zona-tick", "cloud-run-source-deploy"
SCHEDULE = "*/5 * * * *"
APIS = ("run.googleapis.com", "cloudbuild.googleapis.com", "artifactregistry.googleapis.com",
        "cloudscheduler.googleapis.com", "secretmanager.googleapis.com", "firestore.googleapis.com", "iam.googleapis.com")
# Zona's server runs as its own account, which can use Firestore and read its one secret and nothing else.
# The default compute account, which Google makes a project Editor, only builds the image from source.
RUN_ACCOUNT = "zona-run"
RUN_ROLE, BUILD_ROLE = "roles/datastore.user", "roles/run.builder"
ASKABLE = ("GARMIN_PERSONAL_API_KEY", "ZONA_PASSWORD")
BIND_TRIES, BIND_WAIT_S = 4, 5  # a brand-new service account takes a few seconds to be usable in IAM policies


class Step(RuntimeError):
    pass


# ---------- running commands ----------
def tool(name: str) -> list[str]:
    found = shutil.which(name)
    if found:
        return [found]
    if name == "firebase" and shutil.which("npx"):
        return [shutil.which("npx"), "--yes", "firebase-tools@15"]
    raise Step(f"`{name}` isn't installed. See docs/PHONE_SETUP.md, step 3.")


def run(cmd: list[str], *, stdin: str | None = None, capture: bool = False, check: bool = True,
        mask: tuple[str, ...] = ()) -> subprocess.CompletedProcess:
    shown = " ".join([Path(cmd[0]).stem, *cmd[1:]])
    for m in mask:
        shown = shown.replace(m, "***")
    print(f"\n$ {shown}", flush=True)
    done = subprocess.run(cmd, input=stdin, text=True, capture_output=capture, cwd=ROOT)
    if check and done.returncode != 0:
        raise Step((done.stderr or "").strip() or f"the command above failed (exit {done.returncode})")
    return done


def gcloud(*args: str, project: str, **kw) -> subprocess.CompletedProcess:
    # On Windows gcloud is a .cmd wrapper, and cmd can trip over parentheses, carets and ampersands in arguments.
    # So: --format=json instead of value(...), no --database=(default), and secrets only ever on stdin.
    return run([*tool("gcloud"), *args, f"--project={project}"], **kw)


def gcloud_json(*args: str, project: str) -> object:
    return json.loads(gcloud(*args, "--format=json", project=project, capture=True).stdout)


def quiet_ok(*args: str, project: str) -> bool:
    return gcloud(*args, project=project, capture=True, check=False).returncode == 0


def run_account(project: str) -> str:
    return f"{RUN_ACCOUNT}@{project}.iam.gserviceaccount.com"


def build_account(project: str) -> str:
    number = gcloud_json("projects", "describe", project, project=project)["projectNumber"]
    return f"{number}-compute@developer.gserviceaccount.com"


def bind(*args: str, project: str) -> None:
    """An add-iam-policy-binding, retried while a just-created service account propagates."""
    for attempt in range(1, BIND_TRIES + 1):
        done = gcloud(*args, "--format=none", project=project, check=attempt == BIND_TRIES, capture=attempt < BIND_TRIES)
        if done.returncode == 0:
            return
        print(f"  not ready yet, retrying in {BIND_WAIT_S}s")
        time.sleep(BIND_WAIT_S)


# ---------- setup ----------
def setup(project: str) -> None:
    gcloud("services", "enable", *APIS, project=project)
    if not quiet_ok("firestore", "databases", "describe", project=project):  # the (default) database
        print("\nNo Firestore database yet; creating it in nam5 (United States).")
        gcloud("firestore", "databases", "create", "--location=nam5", project=project)
    if not quiet_ok("iam", "service-accounts", "describe", run_account(project), project=project):
        gcloud("iam", "service-accounts", "create", RUN_ACCOUNT, "--display-name=zona-server", project=project)
    bind("projects", "add-iam-policy-binding", project, f"--member=serviceAccount:{run_account(project)}",
         f"--role={RUN_ROLE}", "--condition=None", "--quiet", project=project)
    bind("projects", "add-iam-policy-binding", project, f"--member=serviceAccount:{build_account(project)}",
         f"--role={BUILD_ROLE}", "--condition=None", "--quiet", project=project)
    print("\nOK: setup done. Next: secrets.")


# ---------- secrets ----------
def ask_password() -> tuple[str, bool]:
    while True:
        first = getpass.getpass(f"Password for the app ({MIN_PASSWORD_LEN}+ characters, Enter to generate one): ")
        if not first:
            return "-".join(rnd.token_urlsafe(4) for _ in range(5)), True
        if len(first) < MIN_PASSWORD_LEN or any(p in first for p in PLACEHOLDERS):
            print(f"  Needs at least {MIN_PASSWORD_LEN} characters, and not a placeholder.")
        elif getpass.getpass("Same password again: ") == first:
            return first, False
        else:
            print("  They didn't match.")


def need_console() -> None:
    """Git Bash's default window (mintty) gives Python no real console: hidden prompts would hang, or echo the key."""
    if not sys.stdin.isatty():
        raise Step("This step asks for hidden input, which needs a real console. Open PowerShell in the Zona folder "
                   "and run the same command there.")


def ask(name: str) -> tuple[str, bool]:
    need_console()
    if name == "ZONA_PASSWORD":
        return ask_password()
    if name == "GARMIN_PERSONAL_API_KEY":
        while len(key := getpass.getpass("Garmin Personal API key (hidden as you type): ").strip()) < 20:
            print("  That looks too short. Paste the whole key.")
        return key, False
    raise Step(f"Zona doesn't ask for {name}")


def current_bundle(project: str) -> dict[str, str] | None:
    got = gcloud("secrets", "versions", "access", "latest", f"--secret={SECRET}", project=project, capture=True, check=False)
    return json.loads(got.stdout) if got.returncode == 0 and got.stdout.strip() else None


def secrets(project: str, only: str | None) -> None:
    bundle = current_bundle(project)
    if only and bundle is None:
        raise Step("There are no secrets yet. Run `secrets` once without --only.")
    if bundle is not None and not only:
        need_console()
        answer = input("Zona's secrets already exist. Replace all of them? Every device gets signed out. [y/N] ").strip().lower()
        if answer != "y":
            print("Kept them. To change one, use --only NAME.")
            return
    generated_password = False
    if only:
        bundle = {k: v for k, v in bundle.items() if k in BUNDLED}  # drops the old web-push keys
        bundle[only], generated_password = ask(only)
    else:
        garmin, _ = ask("GARMIN_PERSONAL_API_KEY")
        password, generated_password = ask("ZONA_PASSWORD")
        bundle = {"GARMIN_PERSONAL_API_KEY": garmin, "ZONA_PASSWORD": password, "ZONA_SESSION_SECRET": rnd.token_urlsafe(48),
                  "ZONA_TICK_SECRET": rnd.token_urlsafe(32)}
    if not quiet_ok("secrets", "describe", SECRET, project=project):
        gcloud("secrets", "create", SECRET, "--replication-policy=automatic", project=project)
    gcloud("secrets", "versions", "add", SECRET, "--data-file=-", stdin=json.dumps(bundle), project=project, capture=True)
    # Only the newest version stays: Secret Manager's free tier counts active versions.
    listed = [v["name"] for v in gcloud_json("secrets", "versions", "list", SECRET, "--filter=state:ENABLED", project=project)]
    for old in sorted((v.rsplit("/", 1)[-1] for v in listed), key=int)[:-1]:
        gcloud("secrets", "versions", "destroy", old, f"--secret={SECRET}", "--quiet", project=project, capture=True)
    bind("secrets", "add-iam-policy-binding", SECRET, f"--member=serviceAccount:{run_account(project)}",
         "--role=roles/secretmanager.secretAccessor", project=project)
    if generated_password:
        print(f"\nYour app password is: {bundle['ZONA_PASSWORD']}\nSave it in your password manager now; it isn't shown again.")
    print("\nOK: secrets stored." + (" Run `deploy` so the server picks up the change." if only else " Next: deploy."))


# ---------- deploy ----------
def deploy(project: str) -> None:
    bundle = current_bundle(project)
    if bundle is None:
        raise Step("No secrets yet. Run `secrets` first.")
    tick = bundle["ZONA_TICK_SECRET"]
    env = {"ZONA_STORE": "firestore", "ZONA_SYNC": "0", "ZONA_TZ": "America/Santiago"}
    with tempfile.NamedTemporaryFile("w", suffix=".yaml", delete=False) as fh:
        fh.write("".join(f"{k}: {json.dumps(v)}\n" for k, v in env.items()))
        env_file = fh.name
    try:
        gcloud("run", "deploy", SERVICE, "--source=.", f"--region={REGION}", "--allow-unauthenticated",
               f"--service-account={run_account(project)}",
               "--max-instances=1", "--min-instances=0", "--memory=512Mi", "--cpu=1", "--concurrency=20", "--timeout=300",
               f"--set-secrets=ZONA_SECRETS={SECRET}:latest", f"--env-vars-file={env_file}", "--quiet", project=project)
    finally:
        os.unlink(env_file)
    url = gcloud_json("run", "services", "describe", SERVICE, f"--region={REGION}", project=project)["status"]["url"]
    gcloud("artifacts", "repositories", "set-cleanup-policies", ART_REPO, f"--location={REGION}",
           "--policy=deploy/artifact-cleanup.json", "--no-dry-run", "--quiet", project=project, check=False)
    run([*tool("firebase"), "deploy", "--only", "firestore:rules", "--project", project, "--non-interactive"])
    job = [f"--location={REGION}", f"--schedule={SCHEDULE}", f"--uri={url}/internal/tick", "--http-method=POST",
           "--attempt-deadline=320s"]
    if quiet_ok("scheduler", "jobs", "describe", JOB, f"--location={REGION}", project=project):
        gcloud("scheduler", "jobs", "update", "http", JOB, *job, f"--update-headers=X-Zona-Tick={tick}", project=project, mask=(tick,))
    else:
        gcloud("scheduler", "jobs", "create", "http", JOB, *job, f"--headers=X-Zona-Tick={tick}", project=project, mask=(tick,))
    gcloud("scheduler", "jobs", "run", JOB, f"--location={REGION}", project=project)  # the first sync starts now
    try:
        with urllib.request.urlopen(f"{url}/health", timeout=30) as r:
            print(f"\nOK: {url}/health answered {r.status}.")
    except Exception as exc:  # the first request after a deploy can be slow
        print(f"\nNot yet: {url}/health didn't answer ({type(exc).__name__}). Try it again in a minute.")
    print(f"\nThe app's API address is {url}. It belongs in mobile/src/utils/api-base.ts as LIVE_API.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=("setup", "secrets", "deploy"))
    parser.add_argument("--project", required=True, help="your Firebase project ID, e.g. zona-12ab3")
    parser.add_argument("--only", choices=ASKABLE, help="secrets: change just this one")
    args = parser.parse_args()
    try:
        {"setup": lambda: setup(args.project), "secrets": lambda: secrets(args.project, args.only),
         "deploy": lambda: deploy(args.project)}[args.command]()
    except Step as exc:
        sys.exit(f"\nStopped: {exc}")
    except KeyboardInterrupt:
        sys.exit("\nStopped.")


if __name__ == "__main__":
    main()
