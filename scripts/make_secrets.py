"""Make the six app secrets the deploy workflow needs, and put them in your GitHub repo.

Run from the repo root:
  .venv/Scripts/python.exe scripts/make_secrets.py                  # prints them, for GitHub's web form
  .venv/Scripts/python.exe scripts/make_secrets.py --gh OWNER/zona  # sets them with the GitHub CLI

It asks for your Garmin key, a contact email and the password you'll type on the phone, and generates the
cookie secret and the web push keys. Nothing is written to disk. Re-running it makes new push keys, which
means turning notifications on again on the phone, so run it once and only re-set single secrets later.
"""

from __future__ import annotations

import argparse
import getpass
import secrets
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from zona.config import MIN_PASSWORD_LEN, PLACEHOLDERS  # noqa: E402
from zona.push import generate_vapid_keys  # noqa: E402

PASSWORD_WORDS = 5


def ask_password() -> tuple[str, bool]:
    """Returns (password, generated)."""
    while True:
        first = getpass.getpass(f"Password for the app ({MIN_PASSWORD_LEN}+ characters, Enter to generate one): ")
        if not first:
            return "-".join(secrets.token_urlsafe(4) for _ in range(PASSWORD_WORDS)), True
        if len(first) < MIN_PASSWORD_LEN or any(p in first for p in PLACEHOLDERS):
            print(f"  Needs at least {MIN_PASSWORD_LEN} characters, and not a placeholder. Try again.")
            continue
        if getpass.getpass("Same password again: ") == first:
            return first, False
        print("  They didn't match. Try again.")


def ask_garmin_key() -> str:
    while True:
        key = getpass.getpass("Garmin Personal API key (Garmin Connect › Settings › Personal API Key; hidden): ").strip()
        if len(key) >= 20:
            return key
        print("  That looks too short for a Personal API key. Paste the whole key.")


def ask_contact() -> str:
    while True:
        email = input("An email of yours for the push services' contact field (they're the only ones who see it): ").strip()
        if "@" in email and "." in email.split("@")[-1] and " " not in email:
            return f"mailto:{email}"
        print("  That doesn't look like an email address.")


def set_with_gh(repo: str, values: dict[str, str]) -> None:
    gh = shutil.which("gh")
    if not gh:
        sys.exit("The GitHub CLI isn't installed (winget install GitHub.cli, then gh auth login), or run without --gh.")
    for name, value in values.items():
        # The value goes in on stdin, so it never shows up in the process list or shell history.
        done = subprocess.run([gh, "secret", "set", name, "--repo", repo], input=value, text=True, capture_output=True)
        if done.returncode != 0:
            sys.exit(f"gh secret set {name} failed: {done.stderr.strip()}")
        print(f"  ✓ {name}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--gh", metavar="OWNER/REPO", help="set the secrets on this repo with the GitHub CLI")
    args = parser.parse_args()

    garmin = ask_garmin_key()
    contact = ask_contact()
    password, generated = ask_password()
    vapid_private, vapid_public = generate_vapid_keys()
    values = {
        "GARMIN_PERSONAL_API_KEY": garmin,
        "ZONA_PASSWORD": password,
        "ZONA_SESSION_SECRET": secrets.token_urlsafe(48),
        "ZONA_VAPID_PRIVATE_KEY": vapid_private,
        "ZONA_VAPID_PUBLIC_KEY": vapid_public,
        "ZONA_VAPID_SUBJECT": contact,
    }

    print()
    if args.gh:
        print(f"Setting repo secrets on {args.gh}:")
        set_with_gh(args.gh, values)
    else:
        print("Add each of these at GitHub › your zona repo › Settings › Secrets and variables › Actions › "
              "New repository secret. Name on the left, value on the right. Don't paste them anywhere else.\n")
        for name, value in values.items():
            print(f"{name}\n    {value}\n")
    if generated:
        print(f"\nYour app password is: {password}\nSave it in your password manager; it's what you type on the phone once.")
    print("\nStill needed from your cluster setup: TS_OAUTH_CLIENT_ID, TS_OAUTH_SECRET, KUBECONFIG_RAW, GHCR_PULL_TOKEN "
          "(docs/PHONE_SETUP.md, step 3).")


if __name__ == "__main__":
    main()
