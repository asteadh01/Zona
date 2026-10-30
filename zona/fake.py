"""A stand-in for the Personal API: seeded sample data in Garmin's JSON shapes, so the real pipeline runs without a key."""

from __future__ import annotations

import random
from collections.abc import Callable
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

# weekday (0 = Monday) → (Garmin typeKey, start hour, minutes, name, chance it happens)
WEEK = {
    0: [("running", 7.1, 45, "Easy run", 0.86)],
    1: [("running", 7.1, 42, "Easy run", 0.86), ("strength_training", 19.5, 50, "Strength", 0.86)],
    2: [("running", 7.0, 55, "Intervals", 0.86)],
    3: [("strength_training", 19.5, 50, "Strength", 0.86)],
    4: [("lap_swimming", 13.0, 40, "Pool swim", 0.45)],
    5: [("road_biking", 9.0, 150, "Long ride", 0.86)],
    6: [("running", 8.5, 95, "Long run", 0.86)],
}
PLAN_SPORT = {"running": "run", "strength_training": "strength", "lap_swimming": "swim", "road_biking": "bike"}
PROFILE = {  # % of time in Z1..Z5, average HR, kcal per minute
    "running": ((15, 58, 22, 5, 0), 144, 11.5), "strength_training": ((35, 38, 20, 6, 1), 118, 6.5),
    "lap_swimming": ((15, 45, 30, 10, 0), 132, 9.0), "road_biking": ((10, 46, 34, 10, 0), 136, 9.5),
}
SPEED = {"running": 11.4, "road_biking": 27.0, "lap_swimming": 2.9}  # km/h
HISTORY_DAYS = 200


class FakeGarmin:
    def __init__(self, tz: ZoneInfo, clock: Callable[[], datetime] | None = None) -> None:
        self.tz = tz
        self.clock = clock or (lambda: datetime.now(tz))
        self.extra: list[dict] = []  # sessions added with finish_workout()
        self._next_id = 9_000_000_000 + int(self.clock().timestamp())  # the local database outlives a restart, so ids mustn't repeat

    # ---------- generated history ----------
    def _sessions(self, d: date) -> list[dict]:
        now, rng, out = self.clock(), random.Random(d.toordinal()), []
        for i, (key, h, m, name, p) in enumerate(WEEK[d.weekday()]):
            roll, jit, length, var = rng.random(), rng.random(), rng.random(), rng.random()
            if roll > p:
                continue
            start = datetime.combine(d, datetime.min.time(), self.tz) + timedelta(hours=h + (jit - 0.5) * 0.9)
            minutes = m * (0.88 + length * 0.24)
            if start + timedelta(minutes=minutes) > now:
                continue
            out.append(self._activity(d.toordinal() * 10 + i, key, name, start, minutes, var))
        return out

    def _activity(self, act_id: int, key: str, name: str, start: datetime, minutes: float, var: float) -> dict:
        zones, hr, kpm = PROFILE[key]
        item = {
            "activityId": act_id, "activityName": name, "activityType": {"typeKey": key},
            "startTimeLocal": start.strftime("%Y-%m-%d %H:%M:%S"), "duration": round(minutes * 60, 1),
            "calories": round(minutes * kpm * (0.92 + var * 0.16)), "averageHR": round(hr + (var - 0.5) * 8),
        }
        if key in SPEED:
            item["distance"] = round(minutes / 60 * SPEED[key] * (0.95 + var * 0.1) * 1000, 1)
        item.update({f"hrTimeInZone_{i + 1}": round(z / 100 * minutes * 60) for i, z in enumerate(zones)})
        return item

    def _all(self, first: date, last: date) -> list[dict]:
        out: list[dict] = []
        for n in range((last - first).days + 1):
            out.extend(self._sessions(first + timedelta(days=n)))
        out.extend(a for a in self.extra if first.isoformat() <= a["startTimeLocal"][:10] <= last.isoformat())
        return sorted(out, key=lambda a: a["startTimeLocal"], reverse=True)

    def finish_workout(self, key: str, name: str, minutes: float) -> dict:
        """Pretend a session just ended and synced, for trying the nudge flow locally."""
        self._next_id += 1
        start = self.clock() - timedelta(minutes=minutes, seconds=30)
        item = self._activity(self._next_id, key, name, start, minutes, 0.5)
        self.extra.append(item)
        return item

    def _day(self, d: date) -> dict[str, Any]:
        today, now = self.clock().date(), self.clock()
        if d > today:
            return {}
        rng, frac = random.Random(d.toordinal() * 7 + 3), 1.0 if d < today else (now.hour + now.minute / 60) / 24
        prev = self._sessions(d - timedelta(days=1))
        late = any(a["startTimeLocal"][11:13] >= "19" for a in prev)
        hard = any(a["duration"] >= 90 * 60 or a["activityName"] == "Intervals" for a in prev)
        sport_kcal = sum(a["calories"] for a in self._sessions(d))
        sleep = min(96, round(83 + (rng.random() - 0.5) * 12 - (8 if late else 0)))
        active = round(sport_kcal + (260 + rng.random() * 180) * frac)
        bmr = round(1760 * frac)
        bb = round(min(100, 60 + sleep * 0.36 - (6 if hard else 0)))
        hrv = round(59 + (rng.random() - 0.5) * 9 - (5 if hard else 0))
        return {"date": d, "active": active, "bmr": bmr, "steps": round((6200 + rng.random() * 4200) * frac + sport_kcal * 1.4),
                "moderate": round(15 + rng.random() * 20), "vigorous": round(sport_kcal / 40), "sleep": sleep,
                "sleep_s": round((385 + rng.random() * 75 - (25 if late else 0)) * 60), "bb": bb,
                "bb_now": max(5, bb - round(21 * frac * 1.3)), "hrv": hrv}

    def _days(self, first: date, last: date) -> list[dict]:
        out = [self._day(first + timedelta(days=n)) for n in range((last - first).days + 1)]
        return [x for x in out if x]

    # ---------- the GarminSource methods ----------
    def search_activities(self, *, start: int = 0, limit: int = 20, start_date: date | None = None,
                          end_date: date | None = None) -> list[dict]:
        today = self.clock().date()
        acts = self._all(start_date or today - timedelta(days=HISTORY_DAYS), end_date or today)
        return acts[start:start + limit]

    def get_daily_summaries(self, start_date: date, end_date: date) -> dict:
        return {"data": [{"calendarDate": x["date"].isoformat(),
                          "calories": {"burnedResting": x["bmr"], "burnedActive": x["active"], "burnedTotal": x["active"] + x["bmr"]},
                          "movement": {"steps": {"goal": 10000, "value": x["steps"]}},
                          "intensityMinutes": {"goal": 150, "moderate": x["moderate"], "vigorous": x["vigorous"]},
                          "bodyBattery": {"maxValue": x["bb"], "latestValue": x["bb_now"]}}
                         for x in self._days(start_date, end_date)]}

    def get_daily_sleep_summaries(self, start_date: date, end_date: date) -> list[dict]:
        return [{"calendarDate": x["date"].isoformat(), "sleepTimeSeconds": x["sleep_s"],
                 "sleepScores": {"overall": {"value": x["sleep"]}}} for x in self._days(start_date, end_date)]

    def get_daily_hrv_summaries(self, start_date: date, end_date: date) -> dict:
        days = self._days(start_date - timedelta(days=6), end_date)
        out = []
        for i, x in enumerate(days[6:], start=6):
            week = [d["hrv"] for d in days[i - 6:i + 1]]
            out.append({"calendarDate": x["date"].isoformat(), "lastNightAvg": x["hrv"], "weeklyAvg": round(sum(week) / 7),
                        "baseline": {"balancedLow": 53, "balancedUpper": 65}})
        return {"hrvSummaries": out}

    def get_daily_body_battery(self, start_date: date, end_date: date) -> list[dict]:
        return [{"date": x["date"].isoformat(), "bodyBatteryValuesArray": [[0, x["bb"]], [1, x["bb_now"]]]}
                for x in self._days(start_date, end_date)]
