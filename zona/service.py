"""What the app shows: today's goal and call, and the data behind Home, Month, Trends and Insights."""

from __future__ import annotations

from collections.abc import Callable
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from . import insights, rules
from .db import Repo
from .models import SPORTS, Activity, Day, PlanItem, WaterDay, WaterSession

HISTORY_WEEKS = 12


def hours(t: datetime) -> float:
    return round(t.hour + t.minute / 60 + t.second / 3600, 3)


class Service:
    def __init__(self, repo: Repo, tz: ZoneInfo, clock: Callable[[], datetime]) -> None:
        self.repo, self.tz, self.clock = repo, tz, clock

    # ---------- plan, water, call ----------
    def plan_on(self, d: date) -> list[tuple[datetime, PlanItem]]:
        midnight = datetime.combine(d, datetime.min.time(), self.tz)
        return [(midnight + timedelta(hours=p.start_h), p) for p in self.repo.plan() if p.weekday == d.weekday()]

    def water_day(self, d: date, now: datetime) -> WaterDay:
        s = self.repo.settings()
        done = self.repo.activities_between(d.isoformat(), d.isoformat())
        sessions = [WaterSession(a.name, round(a.start_h, 3), a.minutes, rules.session_ml(a.minutes, s["per_hour"]), True,
                                 hours(a.synced_at) if a.synced_at and a.synced_at.date() == d else 0.0) for a in done]
        if s["count_planned"]:
            sessions += [WaterSession(p.name, p.start_h, p.minutes, rules.session_ml(p.minutes, s["per_hour"]), False)
                         for start, p in self.plan_on(d) if start > now]
        intake = sum(w["ml"] for w in self.repo.water_on(d.isoformat()))
        return WaterDay(s["base"], s["base"] + sum(x.ml for x in sessions), intake, tuple(sessions))

    def call_for(self, d: date, now: datetime) -> rules.Call | None:
        days = self.repo.days_between((d - timedelta(weeks=HISTORY_WEEKS)).isoformat(), d.isoformat())
        today = days.get(d.isoformat())
        if today is None or today.bb_wake is None:
            return None
        ahead = [p for start, p in self.plan_on(d) if start > now]
        return rules.daily_call(bb=today.bb_wake, sleep_score=today.sleep_score, hrv_low=insights.hrv_is_low(days),
                                rule=self.repo.settings()["call_rule"], next_session=ahead[0].name if ahead else None)

    def sync_status(self) -> dict:
        return self.repo.state("sync", {"status": "never", "last": None, "error": None})

    # ---------- Home ----------
    def home(self, now: datetime) -> dict:
        today, s = now.date(), self.repo.settings()
        monday = today - timedelta(days=today.weekday())
        days = self.repo.days_between(monday.isoformat(), today.isoformat())
        day = days.get(today.isoformat())
        acts = self.repo.activities_between((today - timedelta(days=1)).isoformat(), today.isoformat())
        later = [{"start_h": p.start_h, "minutes": p.minutes, "sport": p.sport, "name": p.name}
                 for start, p in self.plan_on(today) if start > now]

        def act(a: Activity) -> dict:
            out = a.to_json()
            if a.date == today.isoformat():
                out["water_ml"] = rules.session_ml(a.minutes, s["per_hour"])
                out["synced_h"] = hours(a.synced_at) if a.synced_at else None
            return out

        call = self.call_for(today, now)
        week = []
        for i in range(7):
            d = monday + timedelta(days=i)
            dd = days.get(d.isoformat())
            week.append({"date": d.isoformat(), "active_kcal": dd.active_kcal if dd else None, "future": d > today})
        return {
            "now": now.isoformat(), "date": today.isoformat(), "now_h": hours(now), "sync": self.sync_status(),
            "call": call.to_json() if call else None,
            "next": later[0] if later else None,
            "day": day.to_json() if day else None,
            "intensity_week": round(sum(d.intensity_min or 0 for d in days.values())),
            "sessions": {"today": [act(a) for a in reversed(acts) if a.date == today.isoformat()],
                         "yesterday": [act(a) for a in reversed(acts) if a.date != today.isoformat()], "later": later},
            "week": week, "water": self.water_view(today, now), "settings": s,
        }

    def water_view(self, d: date, now: datetime) -> dict:
        w = self.water_day(d, now)
        done = sorted((x for x in w.sessions if x.done), key=lambda x: x.synced_h or 0)
        start = w.goal - sum(x.ml for x in done)
        steps, goal = [[7.0, start]], start
        for x in done:
            steps += [[x.synced_h, goal], [x.synced_h, goal + x.ml]]
            goal += x.ml
        steps.append([22.0, w.goal])
        logs = [{"id": r["id"], "h": hours(datetime.fromisoformat(r["at"])), "ml": r["ml"], "source": r["source"]}
                for r in self.repo.water_on(d.isoformat())]
        return {**w.to_json(), "goal_steps": steps, "logs": logs, "latest_nudge": self.latest_nudge(now)}

    def latest_nudge(self, now: datetime) -> dict | None:
        recent = self.repo.nudges("workout", ("sent", "skipped"), now - timedelta(hours=3))
        recent = [n for n in recent if n["reason"] not in ("stale",)]
        return recent[-1] if recent else None

    # ---------- Month ----------
    def month(self, year: int, month: int, now: datetime) -> dict:
        first = date(year, month, 1)
        grid = first - timedelta(days=first.weekday())
        nxt = date(year + month // 12, month % 12 + 1, 1)
        n_weeks = -(-((nxt - grid).days) // 7)
        last = grid + timedelta(days=n_weeks * 7 - 1)
        acts = self.repo.activities_between(grid.isoformat(), last.isoformat())
        days = self.repo.days_between(grid.isoformat(), last.isoformat())
        by_date: dict[str, list[Activity]] = {}
        for a in acts:
            by_date.setdefault(a.date, []).append(a)
        weeks = []
        for w in range(n_weeks):
            cells = []
            for i in range(7):
                d = grid + timedelta(days=w * 7 + i)
                k, dd = d.isoformat(), days.get(d.isoformat())
                items = by_date.get(k, [])
                cells.append({"date": k, "in_month": d.month == month, "future": d > now.date(), "synced": dd is not None,
                              "minutes": round(sum(a.minutes for a in items)),
                              "acts": [{"name": a.name, "sport": a.sport, "start_h": round(a.start_h, 3), "minutes": a.minutes,
                                        "km": a.km, "kcal": a.kcal} for a in items],
                              "total_kcal": dd.total_kcal if dd else None, "steps": dd.steps if dd else None,
                              "sleep_score": dd.sleep_score if dd else None})
            weeks.append({"start": cells[0]["date"], "minutes": sum(c["minutes"] for c in cells), "days": cells})
        return {"month": f"{year:04d}-{month:02d}", "today": now.date().isoformat(), "weeks": weeks}

    # ---------- Trends and Insights ----------
    def _history(self, now: datetime, weeks: int) -> tuple[list[Activity], dict[str, Day], date]:
        today = now.date()
        start = today - timedelta(days=today.weekday()) - timedelta(weeks=weeks - 1)
        return (self.repo.activities_between(start.isoformat(), today.isoformat()),
                self.repo.days_between((today - timedelta(weeks=HISTORY_WEEKS)).isoformat(), today.isoformat()), start)

    def trends(self, now: datetime, weeks: int) -> dict:
        acts, days, start = self._history(now, weeks)
        today = now.date()
        per_week = []
        for w in range(weeks):
            s = start + timedelta(weeks=w)
            mins = {sp: 0.0 for sp in SPORTS}
            for a in acts:
                if s <= a.start.date() < s + timedelta(weeks=1):
                    mins[a.sport] += a.minutes
            per_week.append({"start": s.isoformat(), "minutes": {k: round(v) for k, v in mins.items()}})
        heat = [[0] * insights.HOURS for _ in range(7)]
        for a in acts:
            heat[a.start.weekday()][insights.hour_bin(a)] += 1
        last28 = [(today - timedelta(days=27 - i)).isoformat() for i in range(28)]
        zones = [round(sum(a.zones[i] for a in acts)) for i in range(5)]
        return {
            "weeks": per_week, "heat": heat, "first_hour": insights.FIRST_HOUR, "zones": zones,
            "kcal": [{"date": k, "resting": days[k].resting_kcal if k in days else None,
                      "active": days[k].active_kcal if k in days else None} for k in last28],
            "sleep": [{"date": k, "score": days[k].sleep_score, "minutes": days[k].sleep_min}
                      for k in last28 if k in days and days[k].sleep_score is not None],
        }

    def insights(self, now: datetime) -> dict:
        acts, days, _ = self._history(now, HISTORY_WEEKS)
        return insights.all_insights(acts, days, now.date())
