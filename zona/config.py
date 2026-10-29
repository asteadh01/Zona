"""Settings read once from the environment at startup."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from zoneinfo import ZoneInfo

MIN_SECRET_LEN = 32
MIN_PASSWORD_LEN = 12  # the app faces the internet; the login limiter is per client, so length is the real defence
PLACEHOLDERS = ("change-me", "replace-with", "you@example.com")  # the values .env.example ships with


class ConfigError(RuntimeError):
    """Raised when a required setting is missing or invalid."""


@dataclass(frozen=True)
class Config:
    data_dir: Path
    tz: ZoneInfo
    garmin_api_key: str | None
    fake: bool
    password: str
    session_secret: bytes
    vapid_private_key: str | None
    vapid_public_key: str | None
    vapid_subject: str
    secure_cookies: bool
    sync_enabled: bool

    @property
    def db_path(self) -> Path:
        return self.data_dir / "zona.sqlite3"

    @property
    def token_cache(self) -> Path:
        return self.data_dir / "garmin-bearer-token.json"

    @property
    def push_enabled(self) -> bool:
        return bool(self.vapid_private_key and self.vapid_public_key)


def _flag(env: dict[str, str], name: str, default: bool) -> bool:
    raw = env.get(name)
    if raw is None or raw == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def load_config(env: dict[str, str] | None = None) -> Config:
    """Build the config, failing fast on missing secrets rather than at first request."""
    env = dict(os.environ if env is None else env)
    password = env.get("ZONA_PASSWORD", "")
    secret = env.get("ZONA_SESSION_SECRET", "")
    if len(password) < MIN_PASSWORD_LEN or any(p in password for p in PLACEHOLDERS):
        raise ConfigError(f"ZONA_PASSWORD must be your own, at least {MIN_PASSWORD_LEN} characters")
    if len(secret) < MIN_SECRET_LEN or any(p in secret for p in PLACEHOLDERS):
        raise ConfigError(f"ZONA_SESSION_SECRET must be random, at least {MIN_SECRET_LEN} characters")
    vapid_private, vapid_public = env.get("ZONA_VAPID_PRIVATE_KEY") or None, env.get("ZONA_VAPID_PUBLIC_KEY") or None
    subject = env.get("ZONA_VAPID_SUBJECT", "")
    if vapid_private and vapid_public and not (subject.startswith(("mailto:", "https://")) and len(subject) > 10):
        raise ConfigError("ZONA_VAPID_SUBJECT must be a mailto: or https: contact of yours when push keys are set")
    fake = _flag(env, "ZONA_FAKE", False)
    api_key = env.get("GARMIN_PERSONAL_API_KEY") or None
    if not fake and not api_key:
        raise ConfigError("Set GARMIN_PERSONAL_API_KEY, or ZONA_FAKE=1 to run on sample data")
    try:
        tz = ZoneInfo(env.get("ZONA_TZ", "America/Santiago"))
    except Exception as exc:  # ZoneInfoNotFoundError and malformed keys
        raise ConfigError(f"ZONA_TZ is not a known time zone: {exc}") from exc
    data_dir = Path(env.get("ZONA_DATA_DIR", "./data")).expanduser()
    data_dir.mkdir(parents=True, exist_ok=True)
    return Config(
        data_dir=data_dir,
        tz=tz,
        garmin_api_key=api_key,
        fake=fake,
        password=password,
        session_secret=secret.encode(),
        vapid_private_key=vapid_private,
        vapid_public_key=vapid_public,
        vapid_subject=subject,
        secure_cookies=_flag(env, "ZONA_SECURE_COOKIES", True),
        sync_enabled=_flag(env, "ZONA_SYNC", True),
    )
