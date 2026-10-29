import pytest
from fastapi.testclient import TestClient

from zona.config import load_config
from zona.main import create_app

PASSWORD = "correct horse battery staple"


@pytest.fixture
def client(tmp_path, clock, pusher):
    cfg = load_config({"ZONA_PASSWORD": PASSWORD, "ZONA_SESSION_SECRET": "s" * 40, "ZONA_FAKE": "1",
                       "ZONA_DATA_DIR": str(tmp_path), "ZONA_SECURE_COOKIES": "0"})
    app = create_app(cfg, clock=clock, pusher=pusher, run_loop=False)
    with TestClient(app, base_url="http://zona.test") as c:
        yield c


def login(c):
    assert c.post("/api/login", json={"password": PASSWORD}).status_code == 200


def test_health_is_open_and_everything_else_needs_a_session(client):
    assert client.get("/health").json() == {"ok": True}
    for path in ("/api/home", "/api/me", "/api/settings", "/api/month?m=2026-10"):
        assert client.get(path).status_code == 401
    assert client.post("/api/water", json={"ml": 250}).status_code == 401


def test_wrong_passwords_are_rate_limited_per_client(client):
    stranger = {"CF-Connecting-IP": "203.0.113.9"}
    for _ in range(5):
        assert client.post("/api/login", json={"password": "nope"}, headers=stranger).status_code == 401
    assert client.post("/api/login", json={"password": PASSWORD}, headers=stranger).status_code == 429
    # a stranger burning their attempts doesn't lock the owner out
    assert client.post("/api/login", json={"password": PASSWORD}, headers={"CF-Connecting-IP": "198.51.100.7"}).status_code == 200


def test_sign_out_revokes_copied_cookies(client):
    login(client)
    stolen = client.cookies.get("zona_session")
    assert client.post("/api/logout").status_code == 200
    client.cookies.set("zona_session", stolen, domain="zona.test")
    assert client.get("/api/me").status_code == 401


@pytest.mark.parametrize("cookie", ["", "²³.abc", "9" * 5000 + ".x", "123.ñññ", "1.2.3", "abc.def"])
def test_malformed_cookies_get_401_not_500(client, cookie):
    # a raw header, since the test client itself refuses to encode non-ASCII cookie values
    assert client.get("/api/me", headers={"Cookie": f"zona_session={cookie}".encode()}).status_code == 401


def test_big_or_chunked_bodies_are_refused_before_auth(client):
    big = "x" * (65 * 1024)
    assert client.put("/api/settings", content=big, headers={"Content-Type": "application/json"}).status_code == 413

    def chunks():
        yield b'{"ml": 250}'

    assert client.post("/api/water", content=chunks(), headers={"Content-Type": "application/json"}).status_code == 411


def test_login_sets_an_httponly_cookie(client):
    r = client.post("/api/login", json={"password": PASSWORD})
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie
    assert client.get("/api/me").json()["fake"] is True


def test_cross_origin_writes_are_refused(client):
    login(client)
    r = client.post("/api/water", json={"ml": 250}, headers={"Origin": "https://evil.example"})
    assert r.status_code == 403


def test_security_headers(client):
    h = client.get("/health").headers
    assert "frame-ancestors 'none'" in h["content-security-policy"] and h["x-content-type-options"] == "nosniff"


def test_home_after_a_sync(client):
    login(client)
    client.post("/api/sync")
    home = client.get("/api/home").json()
    assert home["sync"]["status"] == "ok" and home["date"] == "2026-10-27"
    assert home["call"]["label"] in ("Go", "Go easy", "Go light", "Rest")
    assert home["day"]["steps"] > 0 and len(home["week"]) == 7
    assert home["water"]["goal"] >= home["water"]["base"] == 3000
    assert {"today", "yesterday", "later"} <= home["sessions"].keys()


def test_water_logging_and_validation(client):
    login(client)
    before = client.get("/api/water").json()["intake"]
    after = client.post("/api/water", json={"ml": 250}).json()
    assert after["intake"] == before + 250
    assert client.post("/api/water", json={"ml": 9000}).status_code == 422
    entry = after["logs"][-1]["id"]
    assert client.delete(f"/api/water/{entry}").json()["intake"] == before
    assert client.delete(f"/api/water/{entry}").status_code == 404


def test_settings_validation(client):
    login(client)
    assert client.put("/api/settings", json={"per_hour": 650}).json()["per_hour"] == 650
    assert client.put("/api/settings", json={"per_hour": 5000}).status_code == 422
    assert client.put("/api/settings", json={"admin": True}).status_code == 422
    assert client.put("/api/settings", json={"active_from": 22}).status_code == 422
    assert client.put("/api/settings", json={"poll": 5.0}).status_code == 422
    assert client.put("/api/settings", json={"remind_every": False}).status_code == 422


def test_bad_ids_names_and_months_are_422_not_500(client):
    login(client)
    assert client.post("/api/plan", json={"weekday": 1, "start": "07:00", "minutes": 30, "sport": "run", "name": "   "}).status_code == 422
    assert client.get("/api/month", params={"m": "0000-01"}).status_code == 422
    assert client.get("/api/month", params={"m": "9999-12"}).status_code == 422
    assert client.delete(f"/api/water/{10 ** 30}").status_code == 422
    assert client.delete("/api/plan/0").status_code == 422


def test_plan_crud(client):
    login(client)
    n = len(client.get("/api/plan").json())  # fake mode seeds a week plan
    assert n >= 7
    item = client.post("/api/plan", json={"weekday": 2, "start": "18:30", "minutes": 40, "sport": "swim", "name": "Swim"}).json()
    assert item["start_h"] == 18.5
    assert client.post("/api/plan", json={"weekday": 9, "start": "25:00", "minutes": 40, "sport": "x", "name": ""}).status_code == 422
    assert client.delete(f"/api/plan/{item['id']}").json() == {"ok": True}
    assert len(client.get("/api/plan").json()) == n


def test_month_trends_and_insights(client):
    login(client)
    client.post("/api/sync")
    month = client.get("/api/month", params={"m": "2026-10"}).json()
    assert month["weeks"][0]["start"] == "2026-09-28" and len(month["weeks"]) == 5
    assert client.get("/api/month", params={"m": "2026-13"}).status_code == 422
    trends = client.get("/api/trends", params={"weeks": 4}).json()
    assert len(trends["weeks"]) == 4 and len(trends["heat"]) == 7 and len(trends["kcal"]) == 28
    assert client.get("/api/insights").json()["enough"] is True


def test_fake_workout_produces_a_nudge(client, pusher):
    login(client)
    client.post("/api/sync")
    r = client.post("/api/dev/finish-workout", json={"sport": "running", "minutes": 47, "name": "Easy run"}).json()
    assert r["nudge"]["payload"]["title"] == "Easy run done · 47 min"
    key = r["nudge"]["key"]
    assert client.get("/api/nudge", params={"key": key}).json()["status"] == "sent"
    assert client.get("/api/nudge", params={"key": "workout:1 OR 1=1"}).status_code == 422
    assert pusher.titles()[-1] == "Easy run done · 47 min"


def test_push_subscription_validation(client):
    login(client)
    good = {"endpoint": "https://web.push.apple.com/abc123", "keys": {"p256dh": "B" * 87, "auth": "a" * 22}}
    assert client.post("/api/push/subscribe", json=good).json()["devices"] == 1
    assert client.post("/api/push/subscribe", json={**good, "endpoint": "http://insecure"}).status_code == 422
    for evil in ("https://169.254.169.254/latest", "https://web.push.apple.com.evil.example/x", "https://localhost:8000/api",
                 "https://evil.com\\@web.push.apple.com/x"):
        assert client.post("/api/push/subscribe", json={**good, "endpoint": evil}).status_code == 422
    assert client.post("/api/push/subscribe", json={**good, "keys": {"p256dh": "A" * 21, "auth": "a" * 22}}).status_code == 422


@pytest.mark.parametrize("override", [
    {"ZONA_PASSWORD": ""},                                      # missing
    {"ZONA_PASSWORD": "short"},                                 # too short for an internet-facing login
    {"ZONA_PASSWORD": "change-me-please-now"},                  # the .env.example placeholder
    {"ZONA_SESSION_SECRET": "short"},
    {"ZONA_SESSION_SECRET": "replace-with-64-random-characters"},
    {"ZONA_FAKE": "0"},                                         # no Garmin key and not fake
    {"ZONA_VAPID_PRIVATE_KEY": "k", "ZONA_VAPID_PUBLIC_KEY": "k"},  # push keys without a contact subject
    {"ZONA_TZ": "Mars/Olympus"},
])
def test_config_fails_fast_on_bad_settings(tmp_path, override):
    from zona.config import ConfigError
    env = {"ZONA_PASSWORD": PASSWORD, "ZONA_SESSION_SECRET": "s" * 40, "ZONA_FAKE": "1", "ZONA_DATA_DIR": str(tmp_path), **override}
    with pytest.raises(ConfigError):
        load_config(env)
