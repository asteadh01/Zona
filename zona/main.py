"""The FastAPI app: the JSON API behind the Zona iPhone app, and the background sync loop.

Run locally:  uvicorn zona.main:app --env-file .env
"""

from __future__ import annotations

import asyncio
import hmac
import logging
import time
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import Depends, FastAPI, HTTPException, Path, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel, Field, field_validator

from . import auth, fake, shapes
from .config import Config, load_config
from .db import Repo, Store
from .garmin import GarminSource, LiveGarmin
from .push import TOKEN_RE, Pusher
from .service import Service
from .sync import TICK_MIN, Syncer

log = logging.getLogger("zona")
MAX_BODY = 64 * 1024  # the largest real request is a plan item, well under 1 KB
RowId = Annotated[int, Path(ge=1, le=2**53)]

FakeSport = Literal["running", "strength_training", "road_biking", "lap_swimming"]


class LoginIn(BaseModel):
    password: str = Field(min_length=1, max_length=200)


class WaterIn(BaseModel):
    ml: int = Field(ge=50, le=2000)
    source: Literal["app", "nudge", "watch"] = "app"


class PlanIn(BaseModel):
    weekday: int = Field(ge=0, le=6)
    start: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    minutes: int = Field(ge=5, le=600)
    sport: Literal["run", "bike", "strength", "swim", "other"]
    name: str = Field(min_length=1, max_length=60)

    @field_validator("name")
    @classmethod
    def not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("name can't be blank")
        return v.strip()


class PushTokenIn(BaseModel):
    token: str = Field(pattern=TOKEN_RE.pattern)


class FakeWorkoutIn(BaseModel):
    sport: FakeSport = "running"
    minutes: int = Field(ge=5, le=300)
    name: str = Field(default="Easy run", min_length=1, max_length=60)


def require_session(request: Request) -> None:
    st = request.app.state
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not auth.session_ok(st.session_key, token, lambda: st.repo.state("session_epoch", 0)):
        raise HTTPException(401, "Sign in first")


def client_id(request: Request) -> str:
    """Who is logging in. Cloud Run appends the real address last in X-Forwarded-For; anything before it is the client's claim."""
    forwarded = request.headers.get("x-forwarded-for", "").split(",")[-1].strip()
    return forwarded or (request.client.host if request.client else "unknown")


# Module level on purpose: with postponed annotations FastAPI resolves this name from the module globals.
Authed = Annotated[None, Depends(require_session)]


def seed_fake_plan(repo: Store) -> None:
    if repo.plan():
        return
    for weekday, sessions in fake.WEEK.items():
        for key, h, m, name, _ in sessions:
            repo.add_plan(weekday, h, m, fake.PLAN_SPORT[key], name)


def create_app(config: Config | None = None, *, source: GarminSource | None = None,
               clock: Callable[[], datetime] | None = None, pusher: Any = None, run_loop: bool | None = None) -> FastAPI:
    cfg = config or load_config()
    now: Callable[[], datetime] = clock or (lambda: datetime.now(cfg.tz))
    repo: Store
    if cfg.store == "firestore":
        from .firestore_store import FirestoreStore  # imported only here: the SQLite path never loads gRPC
        repo = FirestoreStore(cfg.tz)
    else:
        repo = Repo(cfg.db_path, cfg.tz)
    garmin: GarminSource = source or (fake.FakeGarmin(cfg.tz, now) if cfg.fake else LiveGarmin(cfg.garmin_api_key or "", cfg.token_cache))
    service = Service(repo, cfg.tz, now)
    push = pusher or Pusher(repo)
    syncer = Syncer(repo, garmin, service, push, now, pause_s=0 if cfg.fake else 0.5)  # pause only to be gentle with Garmin
    limiter = auth.LoginLimiter()
    if cfg.fake:
        seed_fake_plan(repo)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.wake = asyncio.Event()
        task = asyncio.create_task(loop(app)) if (cfg.sync_enabled if run_loop is None else run_loop) else None
        yield
        if task:
            task.cancel()

    async def loop(app: FastAPI) -> None:
        while True:
            try:
                await asyncio.to_thread(syncer.tick)
            except Exception:  # keep the loop alive; the next tick retries
                log.exception("Sync tick failed")
            try:
                await asyncio.wait_for(app.state.wake.wait(), timeout=TICK_MIN * 60)
            except TimeoutError:
                pass
            app.state.wake.clear()

    app = FastAPI(title="Zona", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    if cfg.dev_cors_origin:  # local only: lets `expo start --web` on another port call a local server
        app.add_middleware(CORSMiddleware, allow_origins=[cfg.dev_cors_origin], allow_methods=["*"], allow_headers=["*"])

    @app.middleware("http")
    async def guard(request: Request, call_next: Callable) -> Response:
        # Refuse big bodies before anything reads them: FastAPI parses the body before the auth check runs.
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            length = request.headers.get("content-length")
            if "chunked" in request.headers.get("transfer-encoding", "").lower():
                return JSONResponse({"detail": "Content-Length required"}, status_code=411)
            if length is not None and (not length.isdigit() or int(length) > MAX_BODY):
                return JSONResponse({"detail": "Request too large"}, status_code=413)
        response = await call_next(request)
        response.headers.update({"X-Content-Type-Options": "nosniff", "Cache-Control": "no-store"})
        return response

    app.state.session_key = auth.session_key(cfg.session_secret, cfg.password)
    app.state.repo = repo

    @app.get("/health")
    def health() -> dict:
        return {"ok": True}

    @app.post("/api/login")
    def login(body: LoginIn, request: Request) -> dict:
        client = client_id(request)
        if not limiter.begin(client):
            raise HTTPException(429, "Too many wrong passwords. Try again in 15 minutes.")
        if not auth.password_ok(body.password, cfg.password):
            raise HTTPException(401, "Wrong password")
        limiter.succeeded(client)
        return {"token": auth.make_session(app.state.session_key, repo.state("session_epoch", 0))}

    @app.post("/api/logout")
    def logout(_: Authed) -> dict:
        # Moving the epoch revokes every token issued so far, including a copied one. Signed-out phones get no more pushes.
        repo.set_state("session_epoch", repo.state("session_epoch", 0) + 1)
        for token in repo.push_tokens():
            repo.delete_push_token(token)
        return {"ok": True}

    @app.get("/api/me")
    def me(_: Authed) -> dict:
        return {"ok": True, "fake": cfg.fake, "devices": len(repo.push_tokens())}

    @app.get("/api/home")
    def home(_: Authed) -> dict:
        return service.home(now())

    @app.get("/api/month")
    def month(_: Authed, m: Annotated[str, Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")]) -> dict:
        year, mon = (int(x) for x in m.split("-"))
        if not 2000 <= year <= 2100:
            raise HTTPException(422, "Year out of range")
        return service.month(year, mon, now())

    @app.get("/api/trends")
    def trends(_: Authed, weeks: Annotated[int, Query(ge=4, le=12)] = 12) -> dict:
        if weeks not in (4, 12):
            raise HTTPException(422, "weeks must be 4 or 12")
        return service.trends(now(), weeks)

    @app.get("/api/insights")
    def insights(_: Authed) -> dict:
        return service.insights(now())

    @app.get("/api/water")
    def water(_: Authed) -> dict:
        t = now()
        return service.water_view(t.date(), t)

    @app.post("/api/water")
    def add_water(_: Authed, body: WaterIn) -> dict:
        t = now()
        repo.add_water(t, body.ml, body.source)
        return service.water_view(t.date(), t)

    @app.delete("/api/water/{water_id}")
    def delete_water(_: Authed, water_id: RowId) -> dict:
        if not repo.delete_water(water_id):
            raise HTTPException(404, "No such entry")
        t = now()
        return service.water_view(t.date(), t)

    @app.get("/api/nudge")
    def nudge(_: Authed, key: Annotated[str, Query(pattern=r"^workout:\d{1,20}$")]) -> dict:
        found = repo.nudge(key)
        if not found:
            raise HTTPException(404, "No such nudge")
        return found

    @app.get("/api/settings")
    def get_settings(_: Authed) -> dict:
        return repo.settings()

    @app.put("/api/settings")
    def put_settings(_: Authed, body: dict[str, Any]) -> dict:
        try:
            return repo.update_settings(body)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from None

    @app.get("/api/plan")
    def get_plan(_: Authed) -> list[dict]:
        return [p.to_json() for p in repo.plan()]

    @app.post("/api/plan")
    def add_plan(_: Authed, body: PlanIn) -> dict:
        h, m = (int(x) for x in body.start.split(":"))
        return repo.add_plan(body.weekday, h + m / 60, body.minutes, body.sport, body.name).to_json()

    @app.delete("/api/plan/{plan_id}")
    def delete_plan(_: Authed, plan_id: RowId) -> dict:
        if not repo.delete_plan(plan_id):
            raise HTTPException(404, "No such plan item")
        return {"ok": True}

    @app.post("/api/push/register")
    def register_push(_: Authed, body: PushTokenIn) -> dict:
        repo.add_push_token(body.token, now())
        return {"ok": True, "devices": len(repo.push_tokens())}

    @app.post("/api/push/test")
    def push_test(_: Authed, delay: Annotated[int, Query(ge=0, le=30)] = 0) -> dict:
        """delay lets you lock the phone first: Garmin mirrors notifications to the watch while the phone is locked.
        The wait happens inside the request on purpose: Cloud Run only gives a container CPU while a request is open,
        so work left for after the response might never run. The push goes out even if the phone stops listening."""
        time.sleep(delay)
        return {"sent": push.send("Zona is set up", "Nudges and reminders will show up like this.", url="/", tag="test")}

    @app.post("/internal/tick")
    async def tick(request: Request) -> dict:
        """Cloud Scheduler calls this every 5 minutes; it replaces the in-process loop on Cloud Run. Only the shared
        secret opens it."""
        given = request.headers.get("x-zona-tick", "")
        if not cfg.tick_secret or not hmac.compare_digest(given.encode(), cfg.tick_secret.encode()):
            raise HTTPException(403, "Forbidden")
        await asyncio.to_thread(syncer.tick)
        return {"ok": True, "sync": service.sync_status()["status"]}

    @app.get("/api/garmin-shapes", response_class=PlainTextResponse)
    def garmin_shapes(_: Authed) -> str:
        """Field names and types of the latest Garmin responses, no values: to check normalize.py against real data."""
        return shapes.shapes(repo.latest_raw())

    @app.post("/api/sync")
    async def sync_now(_: Authed) -> dict:
        await asyncio.to_thread(syncer.tick, True)
        return service.sync_status()

    @app.post("/api/dev/finish-workout")
    async def finish_workout(_: Authed, body: FakeWorkoutIn) -> dict:
        """Fake mode only: pretend a session just ended, then sync, so you can watch the nudge arrive."""
        if not isinstance(garmin, fake.FakeGarmin):
            raise HTTPException(404, "Only available with ZONA_FAKE=1")
        garmin.finish_workout(body.sport, body.name, body.minutes)
        await asyncio.to_thread(syncer.tick, True)
        return {"nudge": service.latest_nudge(now())}

    return app


def __getattr__(name: str) -> Any:
    # `uvicorn zona.main:app` builds the app on first access, so importing this module in tests needs no env.
    if name == "app":
        logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
        globals()["app"] = create_app()
        return globals()["app"]
    raise AttributeError(name)
