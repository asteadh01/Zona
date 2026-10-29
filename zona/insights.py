"""The four patterns on the Insights view. Pure functions over stored activities and days."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import date, timedelta
from statistics import mean, pstdev

from .models import Activity, Day

FIRST_HOUR, HOURS = 5, 18  # bins 05:00 to 22:59
MIN_SESSIONS = 10
LATE_H = 19


def hour_bin(a: Activity) -> int:
    return min(HOURS - 1, max(0, a.start.hour - FIRST_HOUR))


def start_hours(acts: Sequence[Activity]) -> dict:
    hours = [0] * HOURS
    for a in acts:
        hours[hour_bin(a)] += 1
    peak = max(range(HOURS), key=lambda i: hours[i])
    return {"hours": hours, "first_hour": FIRST_HOUR, "peak_hour": peak + FIRST_HOUR,
            "share": round(hours[peak] / len(acts) * 100), "sessions": len(acts)}


def weekly_kcal(days: dict[str, Day], today: date) -> dict:
    """Active kcal for the eight full weeks before this one, and the last week against the four before it."""
    monday = today - timedelta(days=today.weekday())
    weeks = []
    for w in range(8, 0, -1):
        start = monday - timedelta(weeks=w)
        total = sum((days.get((start + timedelta(days=i)).isoformat()) or Day("")).active_kcal or 0 for i in range(7))
        weeks.append({"start": start.isoformat(), "kcal": round(total)})
    before = mean(w["kcal"] for w in weeks[3:7]) or 1
    return {"weeks": weeks, "avg_before": round(before), "pct": round((weeks[-1]["kcal"] / before - 1) * 100)}


def late_sleep(acts: Sequence[Activity], days: dict[str, Day]) -> dict:
    late_dates = {(a.start.date() + timedelta(days=1)).isoformat() for a in acts if a.start.hour >= LATE_H}
    late = [d.sleep_score for k, d in days.items() if k in late_dates and d.sleep_score is not None]
    other = [d.sleep_score for k, d in days.items() if k not in late_dates and d.sleep_score is not None]
    avg = lambda xs: round(mean(xs)) if xs else None  # noqa: E731
    return {"late_avg": avg(late), "other_avg": avg(other), "late_nights": len(late), "other_nights": len(other)}


def _hrv_band(days: dict[str, Day]) -> tuple[list[tuple[str, float]], float, float, float, str] | None:
    """Garmin's own baseline when present; otherwise mean ± one standard deviation of your nightly values."""
    series = [(k, d.hrv) for k, d in sorted(days.items()) if d.hrv is not None]
    if len(series) < 7:
        return None
    vals = [v for _, v in series]
    latest = days[series[-1][0]]
    low, high = (latest.hrv_low, latest.hrv_high) if latest.hrv_low and latest.hrv_high else \
        (mean(vals) - pstdev(vals), mean(vals) + pstdev(vals))
    week = latest.hrv_week or mean(vals[-7:])
    status = "below your baseline" if week < low else "above your baseline" if week > high else "balanced"
    return series, low, high, week, status


def hrv(days: dict[str, Day], today: date) -> dict | None:
    band = _hrv_band(days)
    if band is None:
        return None
    series, low, high, week, status = band
    cutoff = (today - timedelta(days=27)).isoformat()
    return {"points": [{"date": k, "ms": v} for k, v in series if k >= cutoff], "low": round(low, 1),
            "high": round(high, 1), "week": round(week, 1), "status": status}


def hrv_is_low(days: dict[str, Day]) -> bool | None:
    band = _hrv_band(days)
    return None if band is None else band[4] == "below your baseline"


def all_insights(acts: Sequence[Activity], days: dict[str, Day], today: date) -> dict:
    if len(acts) < MIN_SESSIONS:
        return {"enough": False}
    return {"enough": True, "start_hours": start_hours(acts), "weekly_kcal": weekly_kcal(days, today),
            "late_sleep": late_sleep(acts, days), "hrv": hrv(days, today)}
