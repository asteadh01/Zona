"""Storage. Repo is SQLite, for local runs and tests; firestore_store.FirestoreStore is the same Store on
Firestore, for Cloud Run. One short-lived SQLite connection per call keeps the sync thread and API threads independent."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Protocol
from zoneinfo import ZoneInfo

from .models import SPORTS, Activity, Day, PlanItem

SCHEMA = """
CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY, start TEXT NOT NULL, date TEXT NOT NULL, sport TEXT NOT NULL, name TEXT NOT NULL,
  minutes REAL NOT NULL, kcal REAL NOT NULL, km REAL, avg_hr INTEGER, zones TEXT NOT NULL, synced_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS activities_date ON activities(date);
CREATE TABLE IF NOT EXISTS days (
  date TEXT PRIMARY KEY, total_kcal REAL, active_kcal REAL, resting_kcal REAL, steps INTEGER, intensity_min REAL,
  sleep_score INTEGER, sleep_min REAL, hrv REAL, hrv_week REAL, hrv_low REAL, hrv_high REAL, bb_wake INTEGER, bb_now INTEGER);
CREATE TABLE IF NOT EXISTS water (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, date TEXT NOT NULL, ml INTEGER NOT NULL, source TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS water_date ON water(date);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS plan (
  id INTEGER PRIMARY KEY AUTOINCREMENT, weekday INTEGER NOT NULL, start_h REAL, minutes INTEGER NOT NULL,
  sport TEXT NOT NULL, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS push_tokens (token TEXT PRIMARY KEY, created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS nudges (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, key TEXT NOT NULL UNIQUE, created TEXT NOT NULL,
  status TEXT NOT NULL, reason TEXT, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS raw (endpoint TEXT NOT NULL, key TEXT NOT NULL, fetched_at TEXT NOT NULL, body TEXT NOT NULL,
  PRIMARY KEY (endpoint, key));
"""

DAY_FIELDS = ("total_kcal", "active_kcal", "resting_kcal", "steps", "intensity_min", "sleep_score", "sleep_min",
              "hrv", "hrv_week", "hrv_low", "hrv_high", "bb_wake", "bb_now")

DEFAULT_SETTINGS: dict[str, Any] = {
    "base": 3000, "per_hour": 500, "count_planned": False, "nudge": True, "poll": 5, "call_rule": "full",
    "remind_every": 60, "pause_in_workouts": True, "active_from": 8, "active_to": 21, "call_push": True,
}
_is_bool = lambda v: isinstance(v, bool)  # noqa: E731
_int_in = lambda lo, hi: lambda v: isinstance(v, int) and not isinstance(v, bool) and lo <= v <= hi  # noqa: E731
SETTING_CHECKS = {
    "base": _int_in(1500, 5000), "per_hour": _int_in(0, 1000), "count_planned": _is_bool, "nudge": _is_bool,
    # type(v) is int: without it 5.0 and False slip through, since False == 0 and 5.0 == 5
    "poll": lambda v: type(v) is int and v in (5, 15), "call_rule": lambda v: v in ("full", "bb"),
    "remind_every": lambda v: type(v) is int and v in (0, 45, 60, 90), "pause_in_workouts": _is_bool,
    "active_from": _int_in(0, 23), "active_to": _int_in(1, 24), "call_push": _is_bool,
}


def merged_settings(current: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    """current + patch, or ValueError. Shared by both stores so the rules can't drift apart."""
    bad = [k for k, v in patch.items() if k not in SETTING_CHECKS or not SETTING_CHECKS[k](v)]
    if bad:
        raise ValueError(f"Invalid setting: {', '.join(sorted(bad))}")
    merged = {**current, **patch}
    if merged["active_from"] >= merged["active_to"]:
        raise ValueError("active_from must be before active_to")
    return merged


def check_plan_item(weekday: int, start_h: float | None, minutes: int, sport: str, name: str) -> None:
    good_start = start_h is None or 0 <= start_h < 24
    if not (0 <= weekday <= 6 and good_start and 5 <= minutes <= 600 and sport in SPORTS and 0 < len(name) <= 60):
        raise ValueError("Invalid plan item")


class Store(Protocol):
    """What the service, sync and API need from storage. Repo (SQLite) and FirestoreStore both implement it."""

    tz: ZoneInfo
    def upsert_activities(self, acts: list[Activity], seen_at: datetime) -> list[Activity]: ...
    def activities_between(self, first: str, last: str) -> list[Activity]: ...
    def activity_count(self) -> int: ...
    def update_days(self, by_date: dict[str, dict[str, Any]]) -> None: ...
    def days_between(self, first: str, last: str) -> dict[str, Day]: ...
    def add_water(self, at: datetime, ml: int, source: str) -> int: ...
    def delete_water(self, water_id: int) -> bool: ...
    def water_on(self, date: str) -> list[dict]: ...
    def settings(self) -> dict[str, Any]: ...
    def update_settings(self, patch: dict[str, Any]) -> dict[str, Any]: ...
    def plan(self) -> list[PlanItem]: ...
    def add_plan(self, weekday: int, start_h: float | None, minutes: int, sport: str, name: str) -> PlanItem: ...
    def delete_plan(self, plan_id: int) -> bool: ...
    def add_push_token(self, token: str, now: datetime) -> None: ...
    def push_tokens(self) -> list[str]: ...
    def delete_push_token(self, token: str) -> None: ...
    def save_nudge(self, kind: str, key: str, now: datetime, status: str, payload: dict, reason: str | None = None) -> None: ...
    def nudge(self, key: str) -> dict | None: ...
    def nudges(self, kind: str, statuses: tuple[str, ...], since: datetime) -> list[dict]: ...
    def state(self, key: str, default: Any = None) -> Any: ...
    def set_state(self, key: str, value: Any) -> None: ...
    def latest_raw(self) -> dict[str, Any]: ...
    def save_raw(self, endpoint: str, key: str, now: datetime, body: Any) -> None: ...


class Repo:
    def __init__(self, path: Path, tz: ZoneInfo) -> None:
        self.path = path
        self.tz = tz
        with self._db() as con:
            con.execute("PRAGMA journal_mode=WAL")
            con.executescript(SCHEMA)
            self._let_plan_times_be_empty(con)

    @staticmethod
    def _let_plan_times_be_empty(con: sqlite3.Connection) -> None:
        """Databases made before sessions could have no set time have start_h NOT NULL, which SQLite can't alter in place."""
        start_h = next(c for c in con.execute("PRAGMA table_info(plan)") if c["name"] == "start_h")
        if start_h["notnull"]:
            con.execute("ALTER TABLE plan RENAME TO plan_old")
            con.executescript(SCHEMA)
            con.execute("INSERT INTO plan SELECT * FROM plan_old")
            con.execute("DROP TABLE plan_old")

    @contextmanager
    def _db(self) -> Iterator[sqlite3.Connection]:
        con = sqlite3.connect(self.path, timeout=10)
        con.row_factory = sqlite3.Row
        try:
            with con:
                yield con
        finally:
            con.close()

    # ---------- activities ----------
    def upsert_activities(self, acts: list[Activity], seen_at: datetime) -> list[Activity]:
        """Store or refresh activities in one transaction. Returns the ones Zona hadn't seen; synced_at never moves after that."""
        new: list[Activity] = []
        with self._db() as con:
            for a in acts:
                if con.execute("SELECT 1 FROM activities WHERE id = ?", (a.id,)).fetchone() is None:
                    new.append(a)
                con.execute(
                    """INSERT INTO activities (id, start, date, sport, name, minutes, kcal, km, avg_hr, zones, synced_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                       ON CONFLICT(id) DO UPDATE SET start=excluded.start, date=excluded.date, sport=excluded.sport,
                         name=excluded.name, minutes=excluded.minutes, kcal=excluded.kcal, km=excluded.km,
                         avg_hr=excluded.avg_hr, zones=excluded.zones""",
                    (a.id, a.start.isoformat(), a.date, a.sport, a.name, a.minutes, a.kcal, a.km, a.avg_hr,
                     json.dumps(list(a.zones)), seen_at.isoformat()))
        return new

    def activities_between(self, first: str, last: str) -> list[Activity]:
        with self._db() as con:
            rows = con.execute("SELECT * FROM activities WHERE date BETWEEN ? AND ? ORDER BY start", (first, last)).fetchall()
        return [self._activity(r) for r in rows]

    def activity_count(self) -> int:
        with self._db() as con:
            return con.execute("SELECT COUNT(*) FROM activities").fetchone()[0]

    def _activity(self, r: sqlite3.Row) -> Activity:
        return Activity(id=r["id"], start=datetime.fromisoformat(r["start"]), sport=r["sport"], name=r["name"],
                        minutes=r["minutes"], kcal=r["kcal"], km=r["km"], avg_hr=r["avg_hr"],
                        zones=tuple(json.loads(r["zones"])), synced_at=datetime.fromisoformat(r["synced_at"]))

    # ---------- days ----------
    def update_days(self, by_date: dict[str, dict[str, Any]]) -> None:
        """Merge fields into day rows; fields a source didn't report are left as they were."""
        with self._db() as con:
            for date, fields in by_date.items():
                clean = {k: v for k, v in fields.items() if k in DAY_FIELDS}
                con.execute("INSERT OR IGNORE INTO days (date) VALUES (?)", (date,))
                if clean:
                    sets = ", ".join(f"{k} = ?" for k in clean)
                    con.execute(f"UPDATE days SET {sets} WHERE date = ?", (*clean.values(), date))

    def days_between(self, first: str, last: str) -> dict[str, Day]:
        with self._db() as con:
            rows = con.execute("SELECT * FROM days WHERE date BETWEEN ? AND ? ORDER BY date", (first, last)).fetchall()
        return {r["date"]: Day(**dict(r)) for r in rows}

    # ---------- water ----------
    def add_water(self, at: datetime, ml: int, source: str) -> int:
        with self._db() as con:
            cur = con.execute("INSERT INTO water (at, date, ml, source) VALUES (?, ?, ?, ?)",
                              (at.isoformat(), at.date().isoformat(), ml, source))
            return int(cur.lastrowid)

    def delete_water(self, water_id: int) -> bool:
        with self._db() as con:
            return con.execute("DELETE FROM water WHERE id = ?", (water_id,)).rowcount > 0

    def water_on(self, date: str) -> list[dict]:
        with self._db() as con:
            rows = con.execute("SELECT id, at, ml, source FROM water WHERE date = ? ORDER BY at", (date,)).fetchall()
        return [dict(r) for r in rows]

    # ---------- settings ----------
    def settings(self) -> dict[str, Any]:
        with self._db() as con:
            stored = {r["key"]: json.loads(r["value"]) for r in con.execute("SELECT key, value FROM settings")}
        return {**DEFAULT_SETTINGS, **{k: v for k, v in stored.items() if k in DEFAULT_SETTINGS}}

    def update_settings(self, patch: dict[str, Any]) -> dict[str, Any]:
        merged = merged_settings(self.settings(), patch)
        with self._db() as con:
            con.executemany("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                            [(k, json.dumps(v)) for k, v in patch.items()])
        return merged

    # ---------- weekly plan ----------
    def plan(self) -> list[PlanItem]:
        with self._db() as con:
            rows = con.execute("SELECT * FROM plan ORDER BY weekday, start_h IS NULL, start_h").fetchall()
        return [PlanItem(**dict(r)) for r in rows]

    def add_plan(self, weekday: int, start_h: float | None, minutes: int, sport: str, name: str) -> PlanItem:
        check_plan_item(weekday, start_h, minutes, sport, name)
        with self._db() as con:
            cur = con.execute("INSERT INTO plan (weekday, start_h, minutes, sport, name) VALUES (?, ?, ?, ?, ?)",
                              (weekday, start_h, minutes, sport, name))
            return PlanItem(int(cur.lastrowid), weekday, start_h, minutes, sport, name)

    def delete_plan(self, plan_id: int) -> bool:
        with self._db() as con:
            return con.execute("DELETE FROM plan WHERE id = ?", (plan_id,)).rowcount > 0

    # ---------- push tokens ----------
    def add_push_token(self, token: str, now: datetime) -> None:
        with self._db() as con:
            con.execute("INSERT OR IGNORE INTO push_tokens VALUES (?, ?)", (token, now.isoformat()))

    def push_tokens(self) -> list[str]:
        with self._db() as con:
            return [r["token"] for r in con.execute("SELECT token FROM push_tokens")]

    def delete_push_token(self, token: str) -> None:
        with self._db() as con:
            con.execute("DELETE FROM push_tokens WHERE token = ?", (token,))

    # ---------- nudges ----------
    def save_nudge(self, kind: str, key: str, now: datetime, status: str, payload: dict, reason: str | None = None) -> None:
        with self._db() as con:
            con.execute("""INSERT INTO nudges (kind, key, created, status, reason, payload) VALUES (?, ?, ?, ?, ?, ?)
                           ON CONFLICT(key) DO UPDATE SET created = excluded.created, status = excluded.status,
                             reason = excluded.reason, payload = excluded.payload""",
                        (kind, key, now.isoformat(), status, reason, json.dumps(payload)))

    def nudge(self, key: str) -> dict | None:
        with self._db() as con:
            r = con.execute("SELECT * FROM nudges WHERE key = ?", (key,)).fetchone()
        return self._nudge(r) if r else None

    def nudges(self, kind: str, statuses: tuple[str, ...], since: datetime) -> list[dict]:
        marks = ",".join("?" * len(statuses))
        with self._db() as con:
            rows = con.execute(f"SELECT * FROM nudges WHERE kind = ? AND status IN ({marks}) AND created >= ? ORDER BY created",
                               (kind, *statuses, since.isoformat())).fetchall()
        return [self._nudge(r) for r in rows]

    @staticmethod
    def _nudge(r: sqlite3.Row) -> dict:
        return {**dict(r), "payload": json.loads(r["payload"])}

    # ---------- state and raw payloads ----------
    def state(self, key: str, default: Any = None) -> Any:
        with self._db() as con:
            r = con.execute("SELECT value FROM state WHERE key = ?", (key,)).fetchone()
        return json.loads(r["value"]) if r else default

    def set_state(self, key: str, value: Any) -> None:
        with self._db() as con:
            con.execute("INSERT INTO state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                        (key, json.dumps(value)))

    def latest_raw(self) -> dict[str, Any]:
        """The most recently fetched payload per endpoint."""
        with self._db() as con:
            rows = con.execute("""SELECT endpoint, body FROM raw r WHERE fetched_at = (
                                    SELECT MAX(fetched_at) FROM raw WHERE endpoint = r.endpoint)""").fetchall()
        return {r["endpoint"]: json.loads(r["body"]) for r in rows}

    def save_raw(self, endpoint: str, key: str, now: datetime, body: Any) -> None:
        with self._db() as con:
            con.execute("INSERT INTO raw VALUES (?, ?, ?, ?) ON CONFLICT(endpoint, key) DO UPDATE SET fetched_at = excluded.fetched_at, body = excluded.body",
                        (endpoint, key, now.isoformat(), json.dumps(body)))
