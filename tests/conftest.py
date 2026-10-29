from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from zona.db import Repo
from zona.fake import FakeGarmin
from zona.service import Service
from zona.sync import Syncer

TZ = ZoneInfo("America/Santiago")


class Clock:
    def __init__(self, t: datetime) -> None:
        self.t = t

    def __call__(self) -> datetime:
        return self.t

    def advance(self, **kw) -> None:
        self.t += timedelta(**kw)


class RecordingPusher:
    enabled = True

    def __init__(self) -> None:
        self.sent: list[dict] = []

    def send(self, title: str, body: str, url: str = "/", tag: str = "zona") -> int:
        self.sent.append({"title": title, "body": body, "url": url, "tag": tag})
        return 1

    def titles(self) -> list[str]:
        return [s["title"] for s in self.sent]


@pytest.fixture
def clock() -> Clock:
    return Clock(datetime(2026, 10, 27, 14, 20, tzinfo=TZ))  # a Tuesday


@pytest.fixture
def repo(tmp_path) -> Repo:
    return Repo(tmp_path / "zona.sqlite3", TZ)


@pytest.fixture
def fake(clock) -> FakeGarmin:
    return FakeGarmin(TZ, clock)


@pytest.fixture
def service(repo, clock) -> Service:
    return Service(repo, TZ, clock)


@pytest.fixture
def pusher() -> RecordingPusher:
    return RecordingPusher()


@pytest.fixture
def syncer(repo, fake, service, pusher, clock) -> Syncer:
    s = Syncer(repo, fake, service, pusher, clock, pause_s=0)
    repo.update_settings({"remind_every": 0, "call_push": False})  # tests switch these on when they need them
    return s
