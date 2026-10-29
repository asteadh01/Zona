from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from zona import rules

TZ = ZoneInfo("America/Santiago")


def at(h: int, m: int = 0, day: int = 27) -> datetime:
    return datetime(2026, 10, day, h, m, tzinfo=TZ)


class TestDailyCall:
    @pytest.mark.parametrize("bb,label", [(92, "Go"), (70, "Go"), (64, "Go easy"), (41, "Go light"), (18, "Rest")])
    def test_body_battery_picks_the_step(self, bb, label):
        call = rules.daily_call(bb=bb, sleep_score=85, hrv_low=False, rule="full", next_session="Easy run")
        assert call.label == label

    def test_poor_sleep_and_low_hrv_each_move_one_step_down(self):
        call = rules.daily_call(bb=80, sleep_score=55, hrv_low=True, rule="full", next_session="Easy run")
        assert call.label == "Go light"
        assert any("under 60" in w for w in call.why) and any("below" in w for w in call.why)

    def test_body_battery_only_ignores_sleep_and_hrv(self):
        call = rules.daily_call(bb=80, sleep_score=40, hrv_low=True, rule="bb", next_session=None)
        assert call.label == "Go" and len(call.why) == 1

    def test_never_goes_past_rest(self):
        assert rules.daily_call(bb=10, sleep_score=30, hrv_low=True, rule="full", next_session=None).label == "Rest"

    def test_text_names_the_next_session(self):
        assert rules.daily_call(bb=64, sleep_score=80, hrv_low=False, rule="full", next_session="Strength").text \
            == "Go, but hold back on your strength session"
        assert rules.daily_call(bb=80, sleep_score=80, hrv_low=None, rule="full", next_session=None).text == "Good day to train"


class TestWater:
    @pytest.mark.parametrize("minutes,ml", [(47, 400), (38, 300), (15, 150), (150, 1250), (0, 0)])
    def test_session_share_rounds_to_50_ml(self, minutes, ml):
        assert rules.session_ml(minutes, 500) == ml

    def test_goal_is_base_plus_each_session(self):
        assert rules.water_goal(3000, 500, [47, 25]) == 3000 + 400 + 200


class TestPolling:
    def test_every_15_minutes_ignores_the_plan(self):
        assert rules.poll_minutes(at(7, 30), [at(7)], mode=15) == 15

    def test_fast_window_runs_three_hours_after_a_planned_start(self):
        assert rules.poll_minutes(at(9, 50), [at(7)], mode=5) == 5
        assert rules.poll_minutes(at(10, 10), [at(7)], mode=5) == 30

    def test_fast_window_opens_half_an_hour_early(self):
        assert rules.poll_minutes(at(6, 40), [at(7)], mode=5) == 5
        assert rules.poll_minutes(at(6, 20), [at(7)], mode=5) == 30


class TestNudge:
    def base(self, **kw):
        args = dict(enabled=True, minutes=47, ended=at(7, 52), now=at(7, 55), active_from=8, active_to=21, next_planned=None)
        args.update(kw)
        return rules.decide_nudge(**args)

    def test_sends_right_after_a_normal_session(self):
        # 07:55 is before active hours start at 08:00, but a session you just finished always counts as awake
        assert self.base().action == "send"

    def test_skips_when_off_short_or_stale(self):
        assert self.base(enabled=False).reason == "off"
        assert self.base(minutes=15).reason == "short"
        assert self.base(now=at(11, 0)).reason == "stale"

    def test_skips_after_active_hours(self):
        assert self.base(ended=at(21, 55), now=at(22, 0)).reason == "quiet"

    def test_holds_when_a_planned_session_follows_within_30_minutes(self):
        d = self.base(ended=at(11, 0), now=at(11, 5), next_planned=at(11, 5))
        assert d.action == "hold"

    def test_does_not_hold_for_a_session_much_later(self):
        assert self.base(next_planned=at(19, 30)).action == "send"

    def test_message_for_one_session(self):
        title, body = rules.nudge_text(["Easy run"], 47, 400, 3400, late=False)
        assert title == "Easy run done · 47 min"
        assert body == "Drink about 400 ml over the next hour. Today's goal is now 3.40 L."

    def test_message_for_back_to_back_long_sessions(self):
        title, body = rules.nudge_text(["Long ride", "Brick run"], 175, 1450, 4450, late=False)
        assert title == "Long ride and brick run done · 2h 55m"
        assert "1.45 L over the next two hours" in body and "salt" in body

    def test_message_when_it_synced_late(self):
        title, body = rules.nudge_text(["Easy run"], 47, 400, 3400, late=True)
        assert title.startswith("Easy run synced") and "if you haven't yet" in body


class TestReminder:
    def args(self, **kw):
        a = dict(now=at(14, 0), last_sent=at(12, 50), every_min=60, active_from=8, active_to=21,
                 intake=1200, goal=3300, in_session=False, pause=True)
        a.update(kw)
        return a

    def test_due_after_the_interval(self):
        assert rules.reminder_due(**self.args())
        assert not rules.reminder_due(**self.args(last_sent=at(13, 30)))

    def test_not_outside_active_hours_off_or_done(self):
        assert not rules.reminder_due(**self.args(now=at(22, 0)))
        assert not rules.reminder_due(**self.args(every_min=0))
        assert not rules.reminder_due(**self.args(intake=3300))

    def test_paused_during_a_session(self):
        assert not rules.reminder_due(**self.args(in_session=True))
        assert rules.reminder_due(**self.args(in_session=True, pause=False))


def test_formatters():
    assert rules.dur(47) == "47 min" and rules.dur(175) == "2h 55m"
    assert rules.litres(3400) == "3.40 L"
    assert rules.session_word("Pool swim") == "swim" and rules.session_word("Long run") == "long run"
    assert at(8) - timedelta(minutes=5) == at(7, 55)
