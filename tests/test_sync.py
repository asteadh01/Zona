from datetime import datetime, timedelta

from zona.garmin import GarminKeyError


def test_first_tick_backfills_history(syncer, repo, service, clock):
    syncer.tick()
    assert repo.state("backfilled") and service.sync_status()["status"] == "ok"
    assert repo.activity_count() > 40
    days = repo.days_between("2026-08-04", "2026-10-27")
    assert len(days) >= 84 and days["2026-10-27"].bb_wake is not None
    # backfilled sessions never nudge, even recent ones
    assert repo.nudges("workout", ("sent", "skipped", "held"), datetime(2026, 1, 1, tzinfo=clock().tzinfo)) == []


def test_next_poll_follows_the_plan(syncer, repo, clock):
    repo.add_plan(1, 13.5, 45, "run", "Lunch run")  # Tuesday 13:30, so 14:20 is inside the fast window
    syncer.tick()
    assert datetime.fromisoformat(repo.state("next_poll")) - clock() == timedelta(minutes=5)
    repo.update_settings({"poll": 15})
    syncer.tick(force=True)
    assert datetime.fromisoformat(repo.state("next_poll")) - clock() == timedelta(minutes=15)


def test_a_finished_session_raises_the_goal_and_nudges(syncer, fake, service, pusher, clock):
    syncer.tick()
    before = service.water_day(clock().date(), clock()).goal
    fake.finish_workout("running", "Easy run", 47)
    syncer.tick(force=True)
    after = service.water_day(clock().date(), clock()).goal
    assert after - before == 400
    assert pusher.sent[-1]["title"] == "Easy run done · 47 min"
    assert f"Today's goal is now {after / 1000:.2f} L" in pusher.sent[-1]["body"]
    assert service.latest_nudge(clock())["payload"]["ml"] == 400


def test_short_sessions_raise_the_goal_without_a_nudge(syncer, fake, repo, pusher, clock):
    syncer.tick()
    fake.finish_workout("strength_training", "Mobility", 15)
    syncer.tick(force=True)
    assert pusher.sent == []
    assert repo.nudges("workout", ("skipped",), clock().replace(hour=0))[0]["reason"] == "short"


def test_back_to_back_sessions_share_one_nudge(syncer, fake, repo, pusher, clock):
    clock.t = clock().replace(hour=11, minute=0)
    repo.add_plan(1, 11 + 5 / 60, 25, "run", "Brick run")
    syncer.tick()
    fake.finish_workout("road_biking", "Long ride", 150)
    syncer.tick(force=True)
    assert pusher.sent == [] and len(repo.nudges("workout", ("held",), clock().replace(hour=0))) == 1
    clock.advance(minutes=31)
    fake.finish_workout("running", "Brick run", 25)
    syncer.tick(force=True)
    assert pusher.titles() == ["Long ride and brick run done · 2h 55m"]
    assert "1.45 L over the next two hours" in pusher.sent[0]["body"]
    assert len(repo.nudges("workout", ("merged",), clock().replace(hour=0))) == 1


def test_a_held_nudge_goes_out_alone_if_the_next_session_never_comes(syncer, fake, repo, pusher, clock):
    clock.t = clock().replace(hour=11, minute=0)
    repo.add_plan(1, 11 + 5 / 60, 25, "run", "Brick run")
    syncer.tick()
    fake.finish_workout("road_biking", "Long ride", 150)
    syncer.tick(force=True)
    clock.advance(minutes=61)
    syncer.tick()
    assert pusher.titles() == ["Long ride synced · 2h 30m"]


def test_no_buzz_after_active_hours(syncer, fake, repo, pusher, clock):
    clock.t = clock().replace(hour=22, minute=0)
    syncer.tick()
    fake.finish_workout("strength_training", "Strength", 50)
    syncer.tick(force=True)
    assert pusher.sent == []
    assert repo.nudges("workout", ("skipped",), clock().replace(hour=0))[0]["reason"] == "quiet"


def test_nudges_off_still_updates_the_goal(syncer, fake, repo, service, pusher, clock):
    syncer.tick()
    repo.update_settings({"nudge": False})
    fake.finish_workout("running", "Easy run", 47)
    syncer.tick(force=True)
    assert pusher.sent == [] and service.water_day(clock().date(), clock()).sessions[-1].ml == 400


def test_an_expired_key_is_reported_and_polling_slows(syncer, fake, repo, service, clock):
    syncer.tick()

    def refuse(**_):
        raise GarminKeyError("Garmin refused the Personal API key (HTTP 401)")

    fake.search_activities = refuse
    syncer.tick(force=True)
    status = service.sync_status()
    assert status["status"] == "key" and "401" in status["error"] and status["last"] == clock().isoformat()
    assert datetime.fromisoformat(repo.state("next_poll")) - clock() == timedelta(hours=1)


def test_a_held_nudge_is_dropped_if_it_is_already_stale(syncer, fake, repo, pusher, clock):
    clock.t = clock().replace(hour=11, minute=0)
    repo.add_plan(1, 11 + 5 / 60, 25, "run", "Brick run")
    syncer.tick()
    fake.finish_workout("road_biking", "Long ride", 150)
    syncer.tick(force=True)
    clock.advance(hours=4)  # the server was down while the hold should have been released
    syncer.tick()
    assert pusher.sent == []
    assert repo.nudges("workout", ("skipped",), clock().replace(hour=0))[0]["reason"] == "stale"


def test_a_push_failure_still_records_the_nudge(syncer, fake, repo, service, clock, monkeypatch):
    def broken_send(*args, **kwargs):
        raise RuntimeError("push service exploded")

    syncer.tick()
    monkeypatch.setattr(syncer.pusher, "send", broken_send)
    fake.finish_workout("running", "Easy run", 47)
    fake.finish_workout("strength_training", "Strength", 50)
    syncer.tick(force=True)
    # the first session's failure didn't stop the second from being handled, and the sync still counts as done
    assert service.sync_status()["status"] == "ok"
    assert repo.activity_count() and service.water_day(clock().date(), clock()).goal >= 3000 + 400 + 400


def test_morning_call_waits_for_the_sleep_score(syncer, repo, pusher, clock):
    clock.t = clock().replace(hour=6, minute=40)
    syncer.tick()  # call_push is off in the fixture, so this only syncs
    repo.update_days({clock().date().isoformat(): {"sleep_score": None}})  # Body Battery is in, sleep isn't yet
    repo.update_settings({"call_push": True})
    calls = lambda: [s for s in pusher.sent if s["tag"] == "call"]  # noqa: E731
    syncer.morning_call(clock())
    assert calls() == []
    clock.t = clock().replace(hour=9, minute=5)
    syncer.morning_call(clock())
    assert len(calls()) == 1


def test_morning_call_goes_out_once(syncer, repo, pusher, clock):
    clock.t = clock().replace(hour=6, minute=40)
    repo.update_settings({"call_push": True})
    syncer.tick()
    syncer.tick()
    calls = [s for s in pusher.sent if s["tag"] == "call"]
    assert len(calls) == 1 and calls[0]["title"].startswith("Today: ")


def test_water_reminder_respects_the_interval(syncer, repo, pusher, clock):
    syncer.tick()
    repo.update_settings({"remind_every": 60})
    syncer.tick()
    clock.advance(minutes=30)
    syncer.tick()
    clock.advance(minutes=31)
    syncer.tick()
    assert [s["tag"] for s in pusher.sent] == ["reminder", "reminder"]
