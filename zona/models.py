"""Plain records shared by the sync, the rules and the API."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta

SPORTS = ("run", "bike", "strength", "swim", "other")


@dataclass(frozen=True)
class Activity:
    id: str
    start: datetime  # local, tz-aware
    sport: str
    name: str
    minutes: float
    kcal: float
    km: float | None = None
    avg_hr: int | None = None
    zones: tuple[float, float, float, float, float] = (0.0, 0.0, 0.0, 0.0, 0.0)  # minutes in Z1..Z5
    synced_at: datetime | None = None  # when Zona first saw it

    @property
    def date(self) -> str:
        return self.start.date().isoformat()

    @property
    def end(self) -> datetime:
        return self.start + timedelta(minutes=self.minutes)

    @property
    def start_h(self) -> float:
        return self.start.hour + self.start.minute / 60

    def to_json(self) -> dict:
        out = asdict(self)
        out.update(start=self.start.isoformat(), date=self.date, start_h=round(self.start_h, 3),
                   synced_at=self.synced_at.isoformat() if self.synced_at else None, zones=list(self.zones))
        return out


@dataclass(frozen=True)
class Day:
    """One calendar day of wellness data. Every field but the date can be missing."""

    date: str
    total_kcal: float | None = None
    active_kcal: float | None = None
    resting_kcal: float | None = None
    steps: int | None = None
    intensity_min: float | None = None  # moderate + 2 × vigorous, Garmin's own weighting
    sleep_score: int | None = None
    sleep_min: float | None = None
    hrv: float | None = None  # last night's average, ms
    hrv_week: float | None = None  # 7-day average, ms
    hrv_low: float | None = None  # Garmin's balanced range for you
    hrv_high: float | None = None
    bb_wake: int | None = None
    bb_now: int | None = None

    def to_json(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class PlanItem:
    """A session in the weekly plan. weekday: 0 = Monday. No start_h: you may or may not do it, at no set time."""

    id: int
    weekday: int
    start_h: float | None
    minutes: int
    sport: str
    name: str

    def to_json(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class WaterSession:
    name: str
    start_h: float
    minutes: float
    ml: int
    done: bool
    synced_h: float | None = None


@dataclass(frozen=True)
class WaterDay:
    base: int
    goal: int
    intake: int
    sessions: tuple[WaterSession, ...] = field(default_factory=tuple)

    def to_json(self) -> dict:
        return asdict(self)
