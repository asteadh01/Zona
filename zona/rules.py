"""Zona's own rules: the daily call, the water goal, drink nudges and how often to check Garmin.

Everything here is pure so it can be tested without Garmin, a database or a clock.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta

NUDGE_MIN = 20  # no nudge for sessions shorter than this
STALE_H = 3  # a session that syncs this long after it ended gets no "drink now"
HOLD_GAP_MIN = 30  # a planned session starting this soon after one ends shares its nudge
FAST_POLL_MIN, SLOW_POLL_MIN = 5, 30
FAST_WINDOW = (timedelta(minutes=-30), timedelta(hours=3))  # around each planned start
LONG_SESSION_MIN = 120


def dur(minutes: float) -> str:
    m = round(minutes)
    return f"{m // 60}h {m % 60:02d}m" if m >= 60 else f"{m} min"


def litres(ml: float) -> str:
    return f"{ml / 1000:.2f} L"


def session_word(name: str) -> str:
    return {"Strength": "strength session", "Pool swim": "swim"}.get(name, name.lower())


# ---------- daily call ----------

@dataclass(frozen=True)
class Call:
    level: int
    tone: str
    label: str
    text: str
    sub: str
    why: tuple[str, ...]
    bb: int

    def to_json(self) -> dict:
        return {"level": self.level, "tone": self.tone, "label": self.label, "text": self.text,
                "sub": self.sub, "why": list(self.why), "bb": self.bb}


_STEPS = (
    ("good", "Go", "Go ahead with your {s}", "Good day to train", "You're well recovered. Train as planned."),
    ("warn", "Go easy", "Go, but hold back on your {s}", "Keep it easy today", "Stay in zone 2 and cut it short if it feels hard."),
    ("serious", "Go light", "Swap the {s} for something light", "Something light, if anything", "A walk or 20 minutes of mobility instead."),
    ("bad", "Rest", "Maybe stay in and rest a bit", "Maybe stay in and rest a bit", "Your body is still recovering. Get to bed early and check again tomorrow."),
)


def daily_call(*, bb: int, sleep_score: int | None, hrv_low: bool | None, rule: str, next_session: str | None) -> Call:
    """Body Battery picks the step; with rule 'full', poor sleep and low HRV each push it one step down."""
    level = 0 if bb >= 70 else 1 if bb >= 50 else 2 if bb >= 30 else 3
    why = [f"Body Battery {bb} when you woke up"]
    if rule == "full":
        if sleep_score is not None:
            if sleep_score < 60:
                level += 1
                why.append(f"Sleep score {sleep_score}, under 60: one step down")
            else:
                why.append(f"Sleep score {sleep_score}")
        if hrv_low:
            level += 1
            why.append("HRV below your usual range: one step down")
        elif hrv_low is False:
            why.append("HRV in your usual range")
    level = min(level, len(_STEPS) - 1)
    tone, label, with_s, without_s, sub = _STEPS[level]
    text = with_s.format(s=session_word(next_session)) if next_session else without_s
    return Call(level, tone, label, text, sub, tuple(why), bb)


# ---------- water ----------

def session_ml(minutes: float, per_hour: int) -> int:
    """One session's share of the goal, and what its nudge asks you to drink, rounded half-up to 50 ml."""
    return math.floor(minutes / 60 * per_hour / 50 + 0.5) * 50


def water_goal(base: int, per_hour: int, session_minutes: Iterable[float]) -> int:
    return base + sum(session_ml(m, per_hour) for m in session_minutes)


# ---------- polling ----------

def poll_minutes(now: datetime, planned_starts: Sequence[datetime], mode: int) -> int:
    """mode 15: every 15 minutes. mode 5: every 5 minutes around planned sessions, every 30 otherwise."""
    if mode == 15:
        return 15
    lo, hi = FAST_WINDOW
    return FAST_POLL_MIN if any(lo <= now - s <= hi for s in planned_starts) else SLOW_POLL_MIN


# ---------- nudges ----------

@dataclass(frozen=True)
class Decision:
    action: str  # send | hold | skip
    reason: str | None = None


def decide_nudge(*, enabled: bool, minutes: float, ended: datetime, now: datetime,
                 active_from: int, active_to: int, next_planned: datetime | None) -> Decision:
    if not enabled:
        return Decision("skip", "off")
    if minutes < NUDGE_MIN:
        return Decision("skip", "short")
    if now - ended > timedelta(hours=STALE_H):
        return Decision("skip", "stale")
    if next_planned is not None and timedelta(0) <= next_planned - ended <= timedelta(minutes=HOLD_GAP_MIN):
        return Decision("hold")
    # You just finished a session, so the morning edge of active hours doesn't apply; the evening one does.
    if now.hour + now.minute / 60 >= active_to:
        return Decision("skip", "quiet")
    return Decision("send")


def nudge_text(names: Sequence[str], minutes: float, ml: int, goal_ml: int, *, late: bool) -> tuple[str, str]:
    name = names[0] if len(names) == 1 else f"{names[0]} and " + " and ".join(n.lower() for n in names[1:])
    title = f"{name} {'synced' if late else 'done'} · {dur(minutes)}"
    drink, over = (litres(ml), "over the next two hours") if ml >= 1000 else (f"{ml} ml", "over the next hour")
    body = f"Drink about {drink} {over}{' if you haven' + chr(39) + 't yet' if late else ''}. Today's goal is now {litres(goal_ml)}."
    if minutes >= LONG_SESSION_MIN:
        body += " After this long, add some salt or a sports drink."
    return title, body


def reminder_due(*, now: datetime, last_sent: datetime | None, every_min: int, active_from: int, active_to: int,
                 intake: int, goal: int, in_session: bool, pause: bool) -> bool:
    if every_min <= 0 or intake >= goal:
        return False
    if not active_from <= now.hour + now.minute / 60 < active_to:
        return False
    if pause and in_session:
        return False
    return last_sent is None or now - last_sent >= timedelta(minutes=every_min)
