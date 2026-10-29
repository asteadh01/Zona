"""The FastAPI app: JSON API for the PWA, the PWA itself, and the background sync loop.

Run locally:  uvicorn zona.main:app --env-file .env
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path as FsPath
from typing import Annotated, Any, Literal
from urllib.parse import urlparse

from fastapi import Depends, FastAPI, HTTPException, Path, Query, Request, Response
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator, model_validator

from . import auth, fake
from .config import Config, load_config
from .db import Repo
from .garmin import GarminSource, LiveGarmin
from .push import Pusher, push_endpoint_ok, push_keys_ok
from .service import Service
from .sync import TICK_MIN, Syncer

log = logging.getLogger("zona")
WEB_DIR = FsPath(__file__).resolve().parent.parent / "web"
CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
       "connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
MAX_BODY = 64 * 1024  # the largest real request is a push subscription, well under 2 KB
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


class SubKeys(BaseModel):
    p256dh: str = Field(min_length=20, max_length=200, pattern=r"^[A-Za-z0-9_\-=]+$")
    auth: str = Field(min_length=8, max_length=100, pattern=r"^[A-Za-z0-9_\-=]+$")


class SubIn(BaseModel):
    endpoint: str = Field(min_length=10, max_length=1000, pattern=r"^https://")
    keys: SubKeys

    @field_validator("endpoint")
    @classmethod
    def known_push_service(cls, v: str) -> str:
        # The server POSTs to this URL, so only real push services: anything else would be a request-forgery hole.
        if not push_endpoint_ok(v):
            raise ValueError("not a known push service")
        return v

    @model_validator(mode="after")
    def keys_decode(self) -> SubIn:
        if not push_keys_ok(self.keys.p256dh, self.keys.auth):
            raise ValueError("push keys don't decode to a P-256 key and a 16-byte secret")
        return self


class FakeWorkoutIn(BaseModel):
    sport: FakeSport = "running"
    minutes: int = Field(ge=5, le=300)
    name: str = Field(default="Easy run", min_length=1, max_length=60)


def require_session(request: Request) -> None:
    st = request.app.state
    if not auth.session_ok(st.session_key, st.repo.state("session_epoch", 0), request.cookies.get(auth.COOKIE)):
        raise HTTPException(401, "Sign in first")


def client_id(request: Request) -> str:
    # Behind the Cloudflare Tunnel every request comes from cloudflared; Cloudflare sets the real client here.
    return request.headers.get("cf-connecting-ip") or (request.client.host if request.client else "unknown")


# Module level on purpose: with postponed annotations FastAPI resolves this name from the module globals.
Authed = Annotated[None, Depends(require_session)]


def seed_fake_plan(repo: Repo) -> None:
    if repo.plan():
        return
    for weekday, sessions in fake.WEEK.items():
        for key, h, m, name, _ in sessions:
            repo.add_plan(weekday, h, m, fake.PLAN_SPORT[key], name)


def create_app(config: Config | None = None, *, source: GarminSource | None = None,
               clock: Callable[[], datetime] | None = None, pusher: Any = None, run_loop: bool | None = None) -> FastAPI:
    cfg = config or load_config()
    now: Callable[[], datetime] = clock or (lambda: datetime.now(cfg.tz))
    repo = Repo(cfg.db_path, cfg.tz)
    garmin: GarminSource = source or (fake.FakeGarmin(cfg.tz, now) if cfg.fake else LiveGarmin(cfg.garmin_api_key or "", cfg.token_cache))
    service = Service(repo, cfg.tz, now)
    push = pusher or Pusher(repo, cfg.vapid_private_key, cfg.vapid_public_key, cfg.vapid_subject)
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

    @app.middleware("http")
    async def guard(request: Request, call_next: Callable) -> Response:
        is_api = request.url.path.startswith("/api/")
        if request.method not in ("GET", "HEAD", "OPTIONS") and is_api:
            # Same-origin writes only. The cookie is SameSite=Lax too; this also covers same-site subdomains.
            origin = request.headers.get("origin")
            if origin and urlparse(origin).netloc != request.headers.get("host"):
                return JSONResponse({"detail": "Cross-origin request refused"}, status_code=403)
            # Refuse big bodies before anything reads them: FastAPI parses the body before the auth check runs.
            length = request.headers.get("content-length")
            if length is None and "chunked" in request.headers.get("transfer-encoding", "").lower():
                return JSONResponse({"detail": "Content-Length required"}, status_code=411)
            if length is not None and (not length.isdigit() or int(length) > MAX_BODY):
                return JSONResponse({"detail": "Request too large"}, status_code=413)
        response = await call_next(request)
        response.headers.update({"Content-Security-Policy": CSP, "X-Content-Type-Options": "nosniff",
                                 "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY"})
        # API data is never stored; the app shell always revalidates, so a deploy can't leave mixed JS versions behind.
        response.headers["Cache-Control"] = "no-store" if is_api else "no-cache"
        return response

    app.state.session_key = auth.session_key(cfg.session_secret, cfg.password)
    app.state.repo = repo

    @app.get("/health")
    def health() -> dict:
        return {"ok": True}

    @app.post("/api/login")
    def login(body: LoginIn, request: Request, response: Response) -> dict:
        client = client_id(request)
        if not limiter.begin(client):
            raise HTTPException(429, "Too many wrong passwords. Try again in 15 minutes.")
        if not auth.password_ok(body.password, cfg.password):
            raise HTTPException(401, "Wrong password")
        limiter.succeeded(client)
        token = auth.make_session(app.state.session_key, repo.state("session_epoch", 0))
        response.set_cookie(auth.COOKIE, token, max_age=auth.MAX_AGE_S, httponly=True, secure=cfg.secure_cookies,
                            samesite="lax", path="/")
        return {"ok": True}

    @app.post("/api/logout")
    def logout(_: Authed, response: Response) -> dict:
        # Moving the epoch revokes every cookie issued so far, including a copied one.
        repo.set_state("session_epoch", repo.state("session_epoch", 0) + 1)
        response.delete_cookie(auth.COOKIE, path="/")
        return {"ok": True}

    @app.get("/api/me")
    def me(_: Authed) -> dict:
        return {"ok": True, "fake": cfg.fake, "push": {"enabled": push.enabled, "public_key": cfg.vapid_public_key},
                "devices": len(repo.subs())}

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

    @app.post("/api/push/subscribe")
    def subscribe(_: Authed, body: SubIn) -> dict:
        repo.add_sub(body.endpoint, body.keys.p256dh, body.keys.auth, now())
        return {"ok": True, "devices": len(repo.subs())}

    @app.post("/api/push/test")
    def push_test(_: Authed) -> dict:
        return {"sent": push.send("Zona is set up", "Nudges and reminders will show up like this.", url="/", tag="test")}

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

    if WEB_DIR.is_dir():
        app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
    return app


def __getattr__(name: str) -> Any:
    # `uvicorn zona.main:app` builds the app on first access, so importing this module in tests needs no env.
    if name == "app":
        logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
        globals()["app"] = create_app()
        return globals()["app"]
    raise AttributeError(name)
