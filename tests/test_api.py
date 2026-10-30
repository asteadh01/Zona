import json

import pytest
from fastapi.testclient import TestClient

from zona.config import load_config
from zona.main import create_app

PASSWORD = "correct horse battery staple"
TICK = "t" * 40
BASE_ENV = {"ZONA_PASSWORD": PASSWORD, "ZONA_SESSION_SECRET": "s" * 40, "ZONA_FAKE": "1"}


def make_client(tmp_path, clock, pusher, store, **env):
    cfg = load_config({**BASE_ENV, "ZONA_DATA_DIR": str(tmp_path), "ZONA_STORE": store, **env})
    return TestClient(create_app(cfg, clock=clock, pusher=pusher, run_loop=False), base_url="http://zona.test")


@pytest.fixture
def client(tmp_path, clock, pusher, store):
    with make_client(tmp_path, clock, pusher, store) as c:
        yield c


def login(c):
    r = c.post("/api/login", json={"password": PASSWORD})
    assert r.status_code == 200
    c.headers["Authorization"] = f"Bearer {r.json()['token']}"


def test_health_is_open_and_everything_else_needs_a_session(client):
    assert client.get("/health").json() == {"ok": True}
    for path in ("/api/home", "/api/me", "/api/settings", "/api/month?m=2026-10"):
        assert client.get(path).status_code == 401
    assert client.post("/api/water", json={"ml": 250}).status_code == 401


def test_wrong_passwords_are_rate_limited_per_client(client):
    stranger = {"X-Forwarded-For": "203.0.113.9"}
    for _ in range(5):
        assert client.post("/api/login", json={"password": "nope"}, headers=stranger).status_code == 401
    assert client.post("/api/login", json={"password": PASSWORD}, headers=stranger).status_code == 429
    # a stranger burning their attempts doesn't lock the owner out
    assert client.post("/api/login", json={"password": PASSWORD}, headers={"X-Forwarded-For": "198.51.100.7"}).status_code == 200


def test_a_forged_forwarded_header_doesnt_buy_more_guesses(client):
    # Cloud Run appends the real address last, so anything before it is the client's own claim.
    for i in range(5):
        forged = {"X-Forwarded-For": f"10.0.0.{i}, 203.0.113.9"}
        assert client.post("/api/login", json={"password": "nope"}, headers=forged).status_code == 401
    forged = {"X-Forwarded-For": "10.0.0.99, 203.0.113.9"}
    assert client.post("/api/login", json={"password": "nope"}, headers=forged).status_code == 429


def test_a_forged_forwarded_header_cant_lock_the_owner_out(client):
    owner = "198.51.100.7"
    for _ in range(6):
        client.post("/api/login", json={"password": "nope"}, headers={"X-Forwarded-For": f"{owner}, 203.0.113.9"})
    assert client.post("/api/login", json={"password": PASSWORD}, headers={"X-Forwarded-For": owner}).status_code == 200


def test_a_junk_token_never_reaches_the_database(client, monkeypatch):
    def fail(*_args, **_kwargs):
        raise AssertionError("read the store for an unsigned token")

    monkeypatch.setattr(client.app.state.repo, "state", fail)
    assert client.get("/api/me", headers={"Authorization": "Bearer 0.1893456000." + "A" * 43}).status_code == 401


def test_sign_out_revokes_tokens_and_stops_pushes(client):
    login(client)
    assert client.post("/api/push/register", json={"token": "ExponentPushToken[abcdefghijklmnop]"}).json()["devices"] == 1
    stolen = dict(client.headers)["authorization"]
    assert client.post("/api/logout").status_code == 200
    assert client.get("/api/me", headers={"Authorization": stolen}).status_code == 401
    login(client)
    assert client.get("/api/me").json()["devices"] == 0


@pytest.mark.parametrize("header", ["", "Bearer", "Bearer abc.def", "Basic abc", "Bearer 1.2.3", "Bearer " + "9" * 5000 + ".x"])
def test_malformed_tokens_get_401_not_500(client, header):
    assert client.get("/api/me", headers={"Authorization": header}).status_code == 401


def test_big_or_chunked_bodies_are_refused_before_auth(client):
    big = "x" * (65 * 1024)
    assert client.put("/api/settings", content=big, headers={"Content-Type": "application/json"}).status_code == 413

    def chunks():
        yield b'{"ml": 250}'

    assert client.post("/api/water", content=chunks(), headers={"Content-Type": "application/json"}).status_code == 411
    both = {"Content-Type": "application/json", "Content-Length": "11", "Transfer-Encoding": "chunked"}
    assert client.post("/api/water", content=chunks(), headers=both).status_code == 411


def test_login_returns_a_token_and_sets_no_cookie(client):
    r = client.post("/api/login", json={"password": PASSWORD})
    assert r.json()["token"] and "set-cookie" not in r.headers
    assert client.get("/api/me", headers={"Authorization": f"Bearer {r.json()['token']}"}).json()["fake"] is True


def test_no_store_headers(client):
    h = client.get("/health").headers
    assert h["cache-control"] == "no-store" and h["x-content-type-options"] == "nosniff"


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
    assert client.post("/api/plan", json={"weekdays": [1], "start": "07:00", "minutes": 30, "sport": "run", "name": "   "}).status_code == 422
    assert client.get("/api/month", params={"m": "0000-01"}).status_code == 422
    assert client.get("/api/month", params={"m": "9999-12"}).status_code == 422
    assert client.delete(f"/api/water/{10 ** 30}").status_code == 422
    assert client.delete("/api/plan/0").status_code == 422


def test_one_session_can_go_on_many_days_at_once(client):
    login(client)
    body = {"weekdays": [0, 1, 2, 3, 4], "start": "18:00", "minutes": 60, "sport": "strength", "name": "CrossFit"}
    added = client.post("/api/plan", json=body).json()
    assert [(p["weekday"], p["start_h"], p["name"]) for p in added] == [(d, 18.0, "CrossFit") for d in range(5)]
    assert sum(p["name"] == "CrossFit" for p in client.get("/api/plan").json()) == 5


def test_repeating_a_day_adds_it_once(client):
    login(client)
    added = client.post("/api/plan", json={"weekdays": [3, 1, 3], "start": "06:00", "minutes": 45, "sport": "swim", "name": "Swim"}).json()
    assert [p["weekday"] for p in added] == [1, 3]


@pytest.mark.parametrize("weekdays", [[], [7], [-1], list(range(8))])
def test_bad_day_lists_are_refused(client, weekdays):
    login(client)
    body = {"weekdays": weekdays, "start": "06:00", "minutes": 45, "sport": "swim", "name": "Swim"}
    assert client.post("/api/plan", json=body).status_code == 422


def test_a_session_can_have_no_set_time(client):
    login(client)
    added = client.post("/api/plan", json={"weekdays": [5], "start": None, "minutes": 40, "sport": "run", "name": "Maybe run"}).json()
    assert added[0]["start_h"] is None
    saturday = [p for p in client.get("/api/plan").json() if p["weekday"] == 5]
    assert saturday[-1]["name"] == "Maybe run", "sessions with no set time come after the timed ones"
    assert client.delete(f"/api/plan/{added[0]['id']}").json() == {"ok": True}


def test_plan_crud(client):
    login(client)
    n = len(client.get("/api/plan").json())  # fake mode seeds a week plan
    assert n >= 7
    item = client.post("/api/plan", json={"weekdays": [2], "start": "18:30", "minutes": 40, "sport": "swim", "name": "Swim"}).json()[0]
    assert item["start_h"] == 18.5
    assert client.post("/api/plan", json={"weekdays": [9], "start": "25:00", "minutes": 40, "sport": "x", "name": ""}).status_code == 422
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


def test_delayed_test_push_waits_inside_the_request(client, pusher, monkeypatch):
    import zona.main
    waited = []
    monkeypatch.setattr(zona.main.time, "sleep", waited.append)
    login(client)
    assert client.post("/api/push/test", params={"delay": 10}).json()["sent"] == 1
    assert 10 in waited and pusher.titles()[-1] == "Zona is set up"  # sent before the response, not after
    assert client.post("/api/push/test", params={"delay": 300}).status_code == 422


def test_tick_needs_the_scheduler_secret(tmp_path, clock, pusher, store):
    with make_client(tmp_path, clock, pusher, store, ZONA_SYNC="0", ZONA_TICK_SECRET=TICK) as c:
        assert c.post("/internal/tick").status_code == 403
        assert c.post("/internal/tick", headers={"X-Zona-Tick": "nope"}).status_code == 403
        r = c.post("/internal/tick", headers={"X-Zona-Tick": TICK})
        assert r.json() == {"ok": True, "sync": "ok"}
        login(c)
        assert c.get("/api/home").json()["sync"]["status"] == "ok"  # the tick did the backfill


def test_tick_is_refused_when_no_secret_is_configured(client):
    assert client.post("/internal/tick", headers={"X-Zona-Tick": ""}).status_code == 403


def test_too_many_guesses_from_anywhere_stop_all_logins_but_not_signed_in_phones(client):
    login(client)
    for i in range(60):
        assert client.post("/api/login", json={"password": "nope"}, headers={"X-Forwarded-For": f"203.0.113.{i}"}).status_code == 401
    assert client.post("/api/login", json={"password": PASSWORD}, headers={"X-Forwarded-For": "198.51.100.1"}).status_code == 429
    assert client.get("/api/me").status_code == 200


def test_garmin_shapes_show_field_names_but_no_values(client):
    assert client.get("/api/garmin-shapes").status_code == 401
    login(client)
    assert client.get("/api/garmin-shapes").text == "Nothing synced from Garmin yet."
    client.post("/api/sync")
    text = client.get("/api/garmin-shapes").text
    assert "== activities" in text and "activityName: str" in text and "burnedTotal: int" in text
    assert "Easy run" not in text and "2026-10" not in text  # names and types only, never the data


def test_fake_workout_produces_a_nudge(client, pusher):
    login(client)
    client.post("/api/sync")
    r = client.post("/api/dev/finish-workout", json={"sport": "running", "minutes": 47, "name": "Easy run"}).json()
    assert r["nudge"]["payload"]["title"] == "Easy run done · 47 min"
    key = r["nudge"]["key"]
    assert client.get("/api/nudge", params={"key": key}).json()["status"] == "sent"
    assert client.get("/api/nudge", params={"key": "workout:1 OR 1=1"}).status_code == 422
    assert pusher.titles()[-1] == "Easy run done · 47 min"


def test_push_token_validation(client):
    login(client)
    good = "ExponentPushToken[abcdefghijklmnop]"
    assert client.post("/api/push/register", json={"token": good}).json()["devices"] == 1
    assert client.post("/api/push/register", json={"token": good}).json()["devices"] == 1  # the same phone, once
    assert client.post("/api/push/register", json={"token": "https://evil.example/x"}).status_code == 422



@pytest.mark.parametrize("override", [
    {"ZONA_PASSWORD": ""},                                      # missing
    {"ZONA_PASSWORD": "short"},                                 # too short for an internet-facing login
    {"ZONA_PASSWORD": "change-me-please-now"},                  # the .env.example placeholder
    {"ZONA_SESSION_SECRET": "short"},
    {"ZONA_SESSION_SECRET": "replace-with-64-random-characters"},
    {"ZONA_FAKE": "0"},                                         # no Garmin key and not fake
    {"ZONA_TZ": "Mars/Olympus"},
    {"ZONA_STORE": "postgres"},
    {"ZONA_SYNC": "0"},                                         # no loop and no tick secret: nothing would ever sync
    {"ZONA_SYNC": "0", "ZONA_TICK_SECRET": "short"},
    {"ZONA_SECRETS": "not json"},
    {"ZONA_SECRETS": '{"ADMIN": "x"}'},                         # only the known secrets may come bundled
])
def test_config_fails_fast_on_bad_settings(tmp_path, override):
    from zona.config import ConfigError
    env = {"ZONA_PASSWORD": PASSWORD, "ZONA_SESSION_SECRET": "s" * 40, "ZONA_FAKE": "1", "ZONA_DATA_DIR": str(tmp_path), **override}
    with pytest.raises(ConfigError):
        load_config(env)


def test_secrets_can_arrive_bundled_as_one_json_value(tmp_path):
    bundle = json.dumps({"ZONA_PASSWORD": PASSWORD, "ZONA_SESSION_SECRET": "b" * 40, "ZONA_TICK_SECRET": TICK,
                         "ZONA_VAPID_SUBJECT": "mailto:a@b.co"})  # keys retired with the web app are ignored, not fatal
    cfg = load_config({"ZONA_SECRETS": bundle, "ZONA_FAKE": "1", "ZONA_SYNC": "0", "ZONA_DATA_DIR": str(tmp_path)})
    assert cfg.password == PASSWORD and cfg.tick_secret == TICK and not cfg.sync_enabled
