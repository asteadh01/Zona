"""Turn Personal API JSON into Zona records.

Garmin publishes paths but not response schemas for the Personal API, so every lookup here tries the
field names Garmin Connect has used for years and tolerates their absence. Raw payloads are kept in
the database (see db.save_raw) and `python -m zona inspect` prints real ones, so the mapping can be
checked against an actual key.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from .models import Activity

SPORT_KEYS = {
    "run": ("running", "trail_running", "treadmill_running", "track_running", "indoor_running", "virtual_run", "ultra_run"),
    "bike": ("cycling", "road_biking", "indoor_cycling", "mountain_biking", "gravel_cycling", "virtual_ride", "e_bike_fitness"),
    "strength": ("strength_training", "hiit", "indoor_cardio", "pilates", "yoga"),
    "swim": ("lap_swimming", "open_water_swimming", "swimming", "pool_swimming"),
}
_SPORT_OF = {key: sport for sport, keys in SPORT_KEYS.items() for key in keys}

Fields = dict[str, Any]


def dig(obj: Any, *paths: tuple[str, ...]) -> Any:
    """Return the first non-None value found along any of the key paths."""
    for path in paths:
        cur = obj
        for key in path:
            cur = cur.get(key) if isinstance(cur, dict) else None
            if cur is None:
                break
        if cur is not None:
            return cur
    return None


def items(payload: Any, *list_keys: str) -> list[dict]:
    """Garmin wraps lists differently per endpoint: bare list, {"data": [...]}, {"hrvSummaries": [...]}."""
    if isinstance(payload, list):
        return [x for x in payload if isinstance(x, dict)]
    if isinstance(payload, dict):
        for key in (*list_keys, "data", "items", "results"):
            if isinstance(payload.get(key), list):
                return [x for x in payload[key] if isinstance(x, dict)]
        if "calendarDate" in payload or "date" in payload:
            return [payload]
    return []


def _num(v: Any) -> float | None:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _int(v: Any) -> int | None:
    n = _num(v)
    return None if n is None else round(n)


def _date(item: dict) -> str | None:
    raw = dig(item, ("calendarDate",), ("date",), ("dailySleepDTO", "calendarDate"))
    return str(raw)[:10] if raw else None


def sport_of(type_key: str | None) -> str:
    return _SPORT_OF.get((type_key or "").lower(), "other")


def activity(item: dict, tz: ZoneInfo) -> Activity | None:
    act_id = item.get("activityId")
    if act_id is None:
        return None
    start = _parse_local(item.get("startTimeLocal"), tz) or _parse_gmt(item.get("startTimeGMT"), tz)
    seconds = _num(dig(item, ("duration",), ("elapsedDuration",), ("movingDuration",)))
    if start is None or seconds is None:
        return None
    type_key = dig(item, ("activityType", "typeKey"))
    distance = _num(item.get("distance"))
    zones = tuple((_num(item.get(f"hrTimeInZone_{i}")) or 0.0) / 60 for i in range(1, 6))
    return Activity(
        id=str(act_id), start=start, sport=sport_of(type_key),
        name=str(item.get("activityName") or (type_key or "Activity").replace("_", " ").capitalize()),
        minutes=seconds / 60, kcal=_num(item.get("calories")) or 0.0,
        km=distance / 1000 if distance else None, avg_hr=_int(item.get("averageHR")),
        zones=zones,  # type: ignore[arg-type]
    )


def _parse_local(raw: Any, tz: ZoneInfo) -> datetime | None:
    if not raw:
        return None
    try:
        return datetime.fromisoformat(str(raw).replace("Z", "")).replace(tzinfo=tz)
    except ValueError:
        return None


def _parse_gmt(raw: Any, tz: ZoneInfo) -> datetime | None:
    if not raw:
        return None
    try:
        return datetime.fromisoformat(str(raw).replace("Z", "")).replace(tzinfo=timezone.utc).astimezone(tz)
    except ValueError:
        return None


def daily_summaries(payload: Any) -> dict[str, Fields]:
    out: dict[str, Fields] = {}
    for it in items(payload, "dailySummaries", "userDailySummaries"):
        day = _date(it)
        if not day:
            continue
        total, active, bmr = (_num(it.get(k)) for k in ("totalKilocalories", "activeKilocalories", "bmrKilocalories"))
        moderate, vigorous = _num(it.get("moderateIntensityMinutes")), _num(it.get("vigorousIntensityMinutes"))
        fields = {
            "total_kcal": total, "active_kcal": active,
            "resting_kcal": bmr if bmr is not None else (total - active if total is not None and active is not None else None),
            "steps": _int(it.get("totalSteps")),
            "intensity_min": None if moderate is None and vigorous is None else (moderate or 0) + 2 * (vigorous or 0),
            "bb_wake": _int(dig(it, ("bodyBatteryAtWakeTime",), ("bodyBatteryHighestValue",))),
            "bb_now": _int(it.get("bodyBatteryMostRecentValue")),
        }
        out[day] = {k: v for k, v in fields.items() if v is not None}
    return out


def sleep_summaries(payload: Any) -> dict[str, Fields]:
    out: dict[str, Fields] = {}
    for it in items(payload, "dailySleepSummaries", "sleepSummaries"):
        day = _date(it)
        if not day:
            continue
        score = _int(dig(it, ("sleepScores", "overall", "value"), ("dailySleepDTO", "sleepScores", "overall", "value"),
                         ("overallSleepScore", "value"), ("sleepScore",)))
        seconds = _num(dig(it, ("sleepTimeSeconds",), ("dailySleepDTO", "sleepTimeSeconds")))
        fields = {"sleep_score": score, "sleep_min": seconds / 60 if seconds else None}
        out[day] = {k: v for k, v in fields.items() if v is not None}
    return out


def hrv_summaries(payload: Any) -> dict[str, Fields]:
    out: dict[str, Fields] = {}
    for it in items(payload, "hrvSummaries"):
        day = _date(it)
        if not day:
            continue
        fields = {
            "hrv": _num(it.get("lastNightAvg")), "hrv_week": _num(it.get("weeklyAvg")),
            "hrv_low": _num(dig(it, ("baseline", "balancedLow"))), "hrv_high": _num(dig(it, ("baseline", "balancedUpper"))),
        }
        out[day] = {k: v for k, v in fields.items() if v is not None}
    return out


def body_battery(payload: Any) -> dict[str, Fields]:
    """Latest value of the day, from the [timestamp, value] pairs Garmin returns per day."""
    out: dict[str, Fields] = {}
    for it in items(payload, "bodyBattery"):
        day = _date(it)
        values = [_num(row[1]) for row in it.get("bodyBatteryValuesArray") or []
                  if isinstance(row, (list, tuple)) and len(row) > 1]
        values = [v for v in values if v is not None]
        if day and values:
            out[day] = {"bb_now": round(values[-1])}
    return out


def merge(*sources: dict[str, Fields]) -> dict[str, Fields]:
    """Combine per-day field dicts; later sources win only for fields they actually have."""
    out: dict[str, Fields] = {}
    for src in sources:
        for day, fields in src.items():
            out.setdefault(day, {}).update(fields)
    return out


def activities(payload: Any, tz: ZoneInfo) -> list[Activity]:
    acts: Iterable[Activity | None] = (activity(it, tz) for it in items(payload, "activityList"))
    return [a for a in acts if a is not None]
