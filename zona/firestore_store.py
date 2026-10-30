"""The Store on Firestore, for Cloud Run, where the disk doesn't survive a restart.

Shaped to stay well inside Firestore's free daily quota (50k reads, 20k writes):
- an activity is written only when it's new or changed;
- the settings live in one document;
- every query filters on a single field, so none needs a composite index. Kind and status filters
  happen in Python over the handful of recent nudges.

Collections: activities/{id}, days/{date}, water/{id}, plan/{id}, push_tokens/{sha256(token)},
nudges/{key}, state/{key}, raw/{endpoint}, and config/settings.
"""

from __future__ import annotations

import hashlib
import json
import random
import time
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from google.cloud import firestore
from google.cloud.firestore_v1.base_query import FieldFilter

from .db import DAY_FIELDS, DEFAULT_SETTINGS, check_plan_item, merged_settings
from .models import Activity, Day, PlanItem

MAX_RAW_CHARS = 900_000  # Firestore documents top out at 1 MiB
BATCH_LIMIT = 450  # Firestore allows 500 writes per batch


def new_id() -> int:
    """Time-ordered integer ids that stay below 2**53, so the API and JavaScript handle them exactly."""
    return int(time.time() * 1000) * 1000 + random.randrange(1000)


def _trim(body: Any) -> Any:
    """Keep a too-big payload's shape: the first few items of each list."""
    if isinstance(body, list):
        return [_trim(x) for x in body[:5]]
    if isinstance(body, dict):
        return {k: _trim(v) for k, v in body.items()}
    return body


class FirestoreStore:
    def __init__(self, tz: ZoneInfo, client: firestore.Client | None = None, database: str | None = None) -> None:
        self.tz = tz
        self.db = client or firestore.Client(database=database or "(default)")

    def _c(self, name: str) -> firestore.CollectionReference:
        return self.db.collection(name)

    def _where(self, name: str, field: str, op: str, value: Any) -> firestore.Query:
        return self._c(name).where(filter=FieldFilter(field, op, value))

    def _between(self, name: str, first: str, last: str) -> list[dict]:
        q = self._where(name, "date", ">=", first).where(filter=FieldFilter("date", "<=", last))
        return [s.to_dict() for s in q.stream()]

    # ---------- activities ----------
    @staticmethod
    def _activity_row(a: Activity) -> dict:
        return {"id": a.id, "start": a.start.isoformat(), "date": a.date, "sport": a.sport, "name": a.name,
                "minutes": a.minutes, "kcal": a.kcal, "km": a.km, "avg_hr": a.avg_hr, "zones": list(a.zones)}

    def upsert_activities(self, acts: list[Activity], seen_at: datetime) -> list[Activity]:
        if not acts:
            return []
        refs = [self._c("activities").document(a.id) for a in acts]
        existing = {s.id: s.to_dict() for s in self.db.get_all(refs) if s.exists}
        new: list[Activity] = []
        batch, pending = self.db.batch(), 0
        for a, ref in zip(acts, refs):
            row, old = self._activity_row(a), existing.get(a.id)
            if old is None:
                new.append(a)
                batch.set(ref, {**row, "synced_at": seen_at.isoformat()})
            elif any(old.get(k) != v for k, v in row.items()):
                batch.update(ref, row)  # synced_at never moves after the first sighting
            else:
                continue
            pending += 1
            if pending >= BATCH_LIMIT:
                batch.commit()
                batch, pending = self.db.batch(), 0
        if pending:
            batch.commit()
        return new

    def activities_between(self, first: str, last: str) -> list[Activity]:
        rows = sorted(self._between("activities", first, last), key=lambda r: r["start"])
        return [Activity(id=r["id"], start=datetime.fromisoformat(r["start"]), sport=r["sport"], name=r["name"],
                         minutes=r["minutes"], kcal=r["kcal"], km=r.get("km"), avg_hr=r.get("avg_hr"),
                         zones=tuple(r["zones"]), synced_at=datetime.fromisoformat(r["synced_at"])) for r in rows]

    def activity_count(self) -> int:
        result = self._c("activities").count().get()
        return int(result[0][0].value)

    # ---------- days ----------
    def update_days(self, by_date: dict[str, dict[str, Any]]) -> None:
        batch, pending = self.db.batch(), 0
        for date, fields in by_date.items():
            clean = {k: v for k, v in fields.items() if k in DAY_FIELDS}
            batch.set(self._c("days").document(date), {"date": date, **clean}, merge=True)
            pending += 1
            if pending >= BATCH_LIMIT:
                batch.commit()
                batch, pending = self.db.batch(), 0
        if pending:
            batch.commit()

    def days_between(self, first: str, last: str) -> dict[str, Day]:
        rows = self._between("days", first, last)
        return {r["date"]: Day(date=r["date"], **{k: r.get(k) for k in DAY_FIELDS}) for r in sorted(rows, key=lambda r: r["date"])}

    # ---------- water ----------
    def add_water(self, at: datetime, ml: int, source: str) -> int:
        water_id = new_id()
        self._c("water").document(str(water_id)).set(
            {"id": water_id, "at": at.isoformat(), "date": at.date().isoformat(), "ml": ml, "source": source})
        return water_id

    def delete_water(self, water_id: int) -> bool:
        ref = self._c("water").document(str(water_id))
        if not ref.get().exists:
            return False
        ref.delete()
        return True

    def water_on(self, date: str) -> list[dict]:
        rows = [s.to_dict() for s in self._where("water", "date", "==", date).stream()]
        return [{k: r[k] for k in ("id", "at", "ml", "source")} for r in sorted(rows, key=lambda r: r["at"])]

    # ---------- settings ----------
    def settings(self) -> dict[str, Any]:
        snap = self._c("config").document("settings").get()
        stored = (snap.to_dict() or {}) if snap.exists else {}
        return {**DEFAULT_SETTINGS, **{k: v for k, v in stored.items() if k in DEFAULT_SETTINGS}}

    def update_settings(self, patch: dict[str, Any]) -> dict[str, Any]:
        merged = merged_settings(self.settings(), patch)
        self._c("config").document("settings").set(patch, merge=True)
        return merged

    # ---------- weekly plan ----------
    def plan(self) -> list[PlanItem]:
        rows = [s.to_dict() for s in self._c("plan").stream()]
        return [PlanItem(**r) for r in sorted(rows, key=lambda r: (r["weekday"], r["start_h"]))]

    def add_plan(self, weekday: int, start_h: float, minutes: int, sport: str, name: str) -> PlanItem:
        check_plan_item(weekday, start_h, minutes, sport, name)
        item = PlanItem(new_id(), weekday, start_h, minutes, sport, name)
        self._c("plan").document(str(item.id)).set(item.to_json())
        return item

    def delete_plan(self, plan_id: int) -> bool:
        ref = self._c("plan").document(str(plan_id))
        if not ref.get().exists:
            return False
        ref.delete()
        return True

    # ---------- push tokens ----------
    @staticmethod
    def _token_id(token: str) -> str:
        return hashlib.sha256(token.encode()).hexdigest()  # tokens hold brackets; a hash makes a tidy document id

    def add_push_token(self, token: str, now: datetime) -> None:
        self._c("push_tokens").document(self._token_id(token)).set({"token": token, "created": now.isoformat()})

    def push_tokens(self) -> list[str]:
        return [s.get("token") for s in self._c("push_tokens").stream()]

    def delete_push_token(self, token: str) -> None:
        self._c("push_tokens").document(self._token_id(token)).delete()

    # ---------- nudges ----------
    def save_nudge(self, kind: str, key: str, now: datetime, status: str, payload: dict, reason: str | None = None) -> None:
        self._c("nudges").document(key).set(
            {"kind": kind, "key": key, "created": now.isoformat(), "status": status, "reason": reason, "payload": payload})

    def nudge(self, key: str) -> dict | None:
        snap = self._c("nudges").document(key).get()
        return snap.to_dict() if snap.exists else None

    def nudges(self, kind: str, statuses: tuple[str, ...], since: datetime) -> list[dict]:
        rows = [s.to_dict() for s in self._where("nudges", "created", ">=", since.isoformat()).stream()]
        return sorted((r for r in rows if r["kind"] == kind and r["status"] in statuses), key=lambda r: r["created"])

    # ---------- state and raw payloads ----------
    def state(self, key: str, default: Any = None) -> Any:
        snap = self._c("state").document(key).get()
        return json.loads(snap.get("value")) if snap.exists else default

    def set_state(self, key: str, value: Any) -> None:
        self._c("state").document(key).set({"value": json.dumps(value)})

    def latest_raw(self) -> dict[str, Any]:
        return {s.id: json.loads(s.get("body")) for s in self._c("raw").stream()}

    def save_raw(self, endpoint: str, key: str, now: datetime, body: Any) -> None:
        text = json.dumps(body)
        if len(text) > MAX_RAW_CHARS:
            text = json.dumps(_trim(body))  # the shape is what matters here, not every item
        self._c("raw").document(endpoint).set({"key": key, "fetched_at": now.isoformat(), "body": text})
