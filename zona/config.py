"""Settings read once from the environment at startup."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from zoneinfo import ZoneInfo

MIN_SECRET_LEN = 32
MIN_PASSWORD_LEN = 12  # the app faces the internet; the login limiter is per client, so length is the real defence
PLACEHOLDERS = ("change-me", "replace-with")  # the values .env.example ships with
# What may arrive bundled in ZONA_SECRETS: one Secret Manager secret holding all of them as JSON,
# so the whole app costs one secret version (Secret Manager's free tier covers six).
BUNDLED = ("GARMIN_PERSONAL_API_KEY", "ZONA_PASSWORD", "ZONA_SESSION_SECRET", "ZONA_TICK_SECRET")
RETIRED = ("ZONA_VAPID_PRIVATE_KEY", "ZONA_VAPID_PUBLIC_KEY", "ZONA_VAPID_SUBJECT")  # from the web app; ignored if still stored
STORES = ("sqlite", "firestore")


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
    sync_enabled: bool  # the in-process loop; off on Cloud Run, where Cloud Scheduler calls /internal/tick instead
    store: str
    tick_secret: str | None
    dev_cors_origin: str | None = None  # local only, for `expo start --web`

    @property
    def db_path(self) -> Path:
        return self.data_dir / "zona.sqlite3"

    @property
    def token_cache(self) -> Path:
        return self.data_dir / "garmin-bearer-token.json"


def _flag(env: dict[str, str], name: str, default: bool) -> bool:
    raw = env.get(name)
    if raw is None or raw == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _unbundle(env: dict[str, str]) -> dict[str, str]:
    """Spread ZONA_SECRETS (a JSON object) into the environment. Values set directly still win."""
    raw = env.get("ZONA_SECRETS")
    if not raw:
        return env
    try:
        bundle = json.loads(raw)
    except json.JSONDecodeError:
        raise ConfigError("ZONA_SECRETS isn't valid JSON") from None
    if not isinstance(bundle, dict) or any(k not in BUNDLED + RETIRED or not isinstance(v, str) for k, v in bundle.items()):
        raise ConfigError(f"ZONA_SECRETS may only hold string values for: {', '.join(BUNDLED)}")
    return {**bundle, **{k: v for k, v in env.items() if v}}


def load_config(env: dict[str, str] | None = None) -> Config:
    """Build the config, failing fast on missing secrets rather than at first request."""
    env = _unbundle(dict(os.environ if env is None else env))
    password = env.get("ZONA_PASSWORD", "")
    secret = env.get("ZONA_SESSION_SECRET", "")
    if len(password) < MIN_PASSWORD_LEN or any(p in password for p in PLACEHOLDERS):
        raise ConfigError(f"ZONA_PASSWORD must be your own, at least {MIN_PASSWORD_LEN} characters")
    if len(secret) < MIN_SECRET_LEN or any(p in secret for p in PLACEHOLDERS):
        raise ConfigError(f"ZONA_SESSION_SECRET must be random, at least {MIN_SECRET_LEN} characters")
    fake = _flag(env, "ZONA_FAKE", False)
    api_key = env.get("GARMIN_PERSONAL_API_KEY") or None
    if not fake and not api_key:
        raise ConfigError("Set GARMIN_PERSONAL_API_KEY, or ZONA_FAKE=1 to run on sample data")
    store = env.get("ZONA_STORE", "sqlite")
    if store not in STORES:
        raise ConfigError(f"ZONA_STORE must be one of: {', '.join(STORES)}")
    sync_enabled = _flag(env, "ZONA_SYNC", True)
    tick_secret = env.get("ZONA_TICK_SECRET") or None
    if tick_secret is not None and len(tick_secret) < MIN_SECRET_LEN:
        raise ConfigError(f"ZONA_TICK_SECRET must be at least {MIN_SECRET_LEN} characters")
    if not sync_enabled and not tick_secret:
        raise ConfigError("With ZONA_SYNC=0 nothing would ever sync: set ZONA_TICK_SECRET for Cloud Scheduler")
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
        sync_enabled=sync_enabled,
        store=store,
        tick_secret=tick_secret,
        dev_cors_origin=env.get("ZONA_DEV_CORS_ORIGIN") or None,
    )
