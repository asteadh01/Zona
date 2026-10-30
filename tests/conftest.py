import os
import urllib.request
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from zona.db import Repo, Store
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

    def send(self, title: str, body: str, url: str = "/", tag: str = "zona", category: str | None = None,
             ml: int | None = None) -> int:
        self.sent.append({"title": title, "body": body, "url": url, "tag": tag, "category": category, "ml": ml})
        return 1

    def titles(self) -> list[str]:
        return [s["title"] for s in self.sent]


@pytest.fixture
def clock() -> Clock:
    return Clock(datetime(2026, 10, 27, 14, 20, tzinfo=TZ))  # a Tuesday


EMULATOR = os.environ.get("FIRESTORE_EMULATOR_HOST")
PROJECT = os.environ.get("GOOGLE_CLOUD_PROJECT") or os.environ.get("GCLOUD_PROJECT") or "demo-zona"


def wipe_emulator() -> None:
    url = f"http://{EMULATOR}/emulator/v1/projects/{PROJECT}/databases/(default)/documents"
    urllib.request.urlopen(urllib.request.Request(url, method="DELETE"), timeout=10).close()


# Every test that touches storage runs twice: on SQLite, and on Firestore when the emulator is up
# (`firebase emulators:exec --only firestore "pytest"`; see README). Without the emulator the Firestore half skips.
@pytest.fixture(params=["sqlite", "firestore"])
def store(request) -> str:
    if request.param == "firestore":
        if not EMULATOR:
            pytest.skip("Firestore emulator not running")
        os.environ.setdefault("GOOGLE_CLOUD_PROJECT", PROJECT)
        wipe_emulator()
    return request.param


@pytest.fixture
def repo(store, tmp_path) -> Store:
    if store == "firestore":
        from zona.firestore_store import FirestoreStore
        return FirestoreStore(TZ)
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
