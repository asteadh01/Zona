"""Pulling from Garmin and acting on what arrives.

The Personal API has no webhooks, so a loop ticks every few minutes. Each tick does Zona's local work
(held nudges, the morning call, water reminders) and only calls Garmin when the polling rule says so.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable, Iterator
from datetime import date, datetime, timedelta
from typing import Any

from . import normalize, rules
from .db import Store
from .garmin import GarminKeyError, GarminSource
from .models import Activity
from .push import Pusher
from .service import Service

log = logging.getLogger(__name__)
TICK_MIN = 5
BACKFILL_DAYS = 180
WELLNESS_DAYS = 84  # 12 weeks: enough for Trends, Insights and the HRV baseline
PAGE = 50
HOLD_RELEASE = timedelta(minutes=60)  # a held nudge goes out alone if its follow-up session never syncs
CALL_HOURS = (5, 12)
CALL_WAIT_UNTIL_H = 9  # without a sleep score by 09:00, send the call on Body Battery alone


def chunks(first: date, last: date, size: int) -> Iterator[tuple[date, date]]:
    while first <= last:
        end = min(last, first + timedelta(days=size - 1))
        yield first, end
        first = end + timedelta(days=1)


class Syncer:
    def __init__(self, repo: Store, source: GarminSource, service: Service, pusher: Pusher,
                 clock: Callable[[], datetime], pause_s: float = 0.5) -> None:
        self.repo, self.source, self.service, self.pusher, self.clock = repo, source, service, pusher, clock
        self.pause_s = pause_s
        self._lock = threading.Lock()  # the background loop and "Sync now" never run at once

    # ---------- the loop body ----------
    def tick(self, force: bool = False) -> None:
        with self._lock:
            self._tick(force)

    def _tick(self, force: bool) -> None:
        now = self.clock()
        due = self.repo.state("next_poll")
        if force or due is None or now >= datetime.fromisoformat(due):
            self.sync(now)
            starts = [start for start, _ in self.service.plan_on(now.date())]
            wait = rules.poll_minutes(now, starts, self.repo.settings()["poll"])
            if self.service.sync_status()["status"] == "key":
                wait = 60  # nothing changes until you make a new key; don't hammer Garmin meanwhile
            self.repo.set_state("next_poll", (now + timedelta(minutes=wait)).isoformat())
        self.release_held(now)
        self.morning_call(now)
        self.water_reminder(now)

    def sync(self, now: datetime) -> None:
        last = self.service.sync_status().get("last")
        try:
            if self.repo.state("backfilled") is None:
                self.backfill(now)
            else:
                self.incremental(now)
        except GarminKeyError as exc:
            self.repo.set_state("sync", {"status": "key", "last": last, "error": str(exc)})
            return
        except Exception as exc:  # network trouble, Garmin 5xx, an unexpected payload
            log.exception("Sync failed")
            self.repo.set_state("sync", {"status": "error", "last": last, "error": type(exc).__name__})
            return
        self.repo.set_state("sync", {"status": "ok", "last": now.isoformat(), "error": None})

    # ---------- fetching ----------
    def _get(self, name: str, key: str, now: datetime, fn: Callable[[], Any]) -> Any:
        body = fn()
        self.repo.save_raw(name, key, now, body)
        return body

    def _wellness(self, now: datetime, first: date, last: date, size: int) -> None:
        s = self.source
        for a, b in chunks(first, last, size):
            key = f"{a}/{b}"
            self.repo.update_days(normalize.merge(
                normalize.daily_summaries(self._get("daily_summaries", key, now, lambda: s.get_daily_summaries(a, b))),
                normalize.sleep_summaries(self._get("sleep_summaries", key, now, lambda: s.get_daily_sleep_summaries(a, b))),
                normalize.hrv_summaries(self._get("hrv_summaries", key, now, lambda: s.get_daily_hrv_summaries(a, b))),
                normalize.body_battery(self._get("body_battery", key, now, lambda: s.get_daily_body_battery(a, b))),
            ))
            time.sleep(self.pause_s)

    def backfill(self, now: datetime) -> None:
        """First run: activities back 180 days, wellness back 12 weeks, in chunks Garmin's range caps allow."""
        today, tz = now.date(), self.service.tz
        since, start = today - timedelta(days=BACKFILL_DAYS), 0
        while True:
            page = self._get("activities", f"backfill/{start}", now,
                             lambda: self.source.search_activities(start=start, limit=PAGE, start_date=since, end_date=today))
            self.repo.upsert_activities(normalize.activities(page, tz), now)
            if len(normalize.items(page, "activityList")) < PAGE:
                break
            start += PAGE
            time.sleep(self.pause_s)
        self._wellness(now, today - timedelta(days=WELLNESS_DAYS), today, 28)
        self.repo.set_state("backfilled", now.isoformat())

    def incremental(self, now: datetime) -> None:
        today = now.date()
        page = self._get("activities", "latest", now, lambda: self.source.search_activities(start=0, limit=20))
        new = self.repo.upsert_activities(normalize.activities(page, self.service.tz), now)
        self._wellness(now, today - timedelta(days=6), today, 7)
        for a in sorted(new, key=lambda x: x.end):
            try:
                self.on_new_activity(a, now)
            except Exception:  # one session's nudge failing must not drop the others; it's already stored either way
                log.exception("Nudge handling failed for activity %s", a.id)

    # ---------- nudges ----------
    def on_new_activity(self, a: Activity, now: datetime) -> None:
        key = f"workout:{a.id}"
        if self.repo.nudge(key):
            return
        s = self.repo.settings()
        following = [start for start, _ in self.service.plan_on(a.end.date()) if start >= a.end]
        decision = rules.decide_nudge(enabled=s["nudge"], minutes=a.minutes, ended=a.end, now=now,
                                      active_from=s["active_from"], active_to=s["active_to"],
                                      next_planned=min(following) if following else None)
        part = {"ids": [a.id], "names": [a.name], "minutes": a.minutes, "ml": rules.session_ml(a.minutes, s["per_hour"]),
                "ended": a.end.isoformat()}
        if decision.action == "send":
            held = self.repo.nudges("workout", ("held",), now - timedelta(hours=rules.STALE_H))
            self._send_workout(key, now, [h["payload"] for h in held] + [part], merged_keys=[h["key"] for h in held])
        else:
            status = "held" if decision.action == "hold" else "skipped"
            self.repo.save_nudge("workout", key, now, status, part, decision.reason)

    def _send_workout(self, key: str, now: datetime, parts: list[dict], merged_keys: list[str]) -> None:
        names = [n for p in parts for n in p["names"]]
        minutes, ml = sum(p["minutes"] for p in parts), sum(p["ml"] for p in parts)
        last_end = max(datetime.fromisoformat(p["ended"]) for p in parts)
        goal = self.service.water_day(now.date(), now).goal
        title, body = rules.nudge_text(names, minutes, ml, goal, late=now - last_end > timedelta(minutes=30))
        url = f"/water?nudge={key}"
        pushed = self.pusher.send(title, body, url=url, tag=key, category="nudge", ml=ml)
        payload = {"ids": [i for p in parts for i in p["ids"]], "names": names, "minutes": minutes, "ml": ml,
                   "ended": last_end.isoformat(), "goal": goal, "title": title, "body": body, "url": url, "pushed": pushed}
        self.repo.save_nudge("workout", key, now, "sent", payload)
        for k in merged_keys:
            self.repo.save_nudge("workout", k, now, "merged", {**payload, "into": key})

    def release_held(self, now: datetime) -> None:
        s = self.repo.settings()
        for h in self.repo.nudges("workout", ("held",), now - timedelta(days=1)):
            if now - datetime.fromisoformat(h["created"]) < HOLD_RELEASE:
                continue
            if now - datetime.fromisoformat(h["payload"]["ended"]) > timedelta(hours=rules.STALE_H):
                self.repo.save_nudge("workout", h["key"], now, "skipped", h["payload"], "stale")  # e.g. after the pod was down
            elif now.hour + now.minute / 60 >= s["active_to"]:
                self.repo.save_nudge("workout", h["key"], now, "skipped", h["payload"], "quiet")
            else:
                self._send_workout(h["key"], now, [h["payload"]], merged_keys=[])

    def morning_call(self, now: datetime) -> None:
        key = f"call:{now.date()}"
        if not (CALL_HOURS[0] <= now.hour < CALL_HOURS[1]) or not self.repo.settings()["call_push"] or self.repo.nudge(key):
            return
        call = self.service.call_for(now.date(), now)
        if call is None:
            return  # last night hasn't synced yet; try next tick
        day = self.repo.days_between(now.date().isoformat(), now.date().isoformat()).get(now.date().isoformat())
        if day is not None and day.sleep_score is None and now.hour < CALL_WAIT_UNTIL_H:
            return  # Body Battery can arrive before the sleep score; the call is final once sent, so wait for both
        pushed = self.pusher.send(f"Today: {call.label}", f"{call.text}. Body Battery {call.bb} when you woke up.", url="/", tag="call")
        self.repo.save_nudge("call", key, now, "sent", {**call.to_json(), "pushed": pushed})

    def water_reminder(self, now: datetime) -> None:
        s = self.repo.settings()
        last = self.repo.state("reminder_last")
        water = self.service.water_day(now.date(), now)
        in_session = any(start <= now <= start + timedelta(minutes=p.minutes) for start, p in self.service.plan_on(now.date()))
        if not rules.reminder_due(now=now, last_sent=datetime.fromisoformat(last) if last else None,
                                  every_min=s["remind_every"], active_from=s["active_from"], active_to=s["active_to"],
                                  intake=water.intake, goal=water.goal, in_session=in_session, pause=s["pause_in_workouts"]):
            return
        if self.pusher.send("Time for water", f"{rules.litres(water.intake)} of {rules.litres(water.goal)} so far today.",
                            url="/water", tag="reminder", category="reminder"):
            self.repo.set_state("reminder_last", now.isoformat())
