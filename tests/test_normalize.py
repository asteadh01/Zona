from zoneinfo import ZoneInfo

from zona import normalize

TZ = ZoneInfo("America/Santiago")

RUN = {
    "activityId": 17283001, "activityName": "Easy run", "startTimeLocal": "2026-10-27 07:05:12",
    "startTimeGMT": "2026-10-27 10:05:12", "activityType": {"typeKey": "running"}, "duration": 2820.0,
    "distance": 9012.4, "calories": 520.0, "averageHR": 142.3,
    "hrTimeInZone_1": 420.0, "hrTimeInZone_2": 1680.0, "hrTimeInZone_3": 600.0, "hrTimeInZone_4": 120.0,
}


def test_activity_maps_the_usual_fields():
    a = normalize.activity(RUN, TZ)
    assert a.id == "17283001" and a.sport == "run" and a.name == "Easy run"
    assert a.start.hour == 7 and a.start.tzinfo == TZ and a.minutes == 47
    assert round(a.km, 2) == 9.01 and a.avg_hr == 142
    assert a.zones == (7.0, 28.0, 10.0, 2.0, 0.0)


def test_activity_falls_back_to_gmt_and_unknown_sport():
    a = normalize.activity({"activityId": 1, "startTimeGMT": "2026-10-27T10:00:00.0", "duration": 600,
                            "activityType": {"typeKey": "rowing"}}, TZ)
    assert a.start.hour == 7 and a.sport == "other" and a.name == "Rowing" and a.km is None


def test_activity_without_id_or_time_is_dropped():
    assert normalize.activity({"activityName": "x"}, TZ) is None
    assert normalize.activities([{"activityId": 2}, RUN], TZ)[0].id == "17283001"


def test_daily_summaries_read_garmins_real_nested_shape():
    out = normalize.daily_summaries({"data": [{
        "calendarDate": "2026-10-27",
        "calories": {"burnedResting": 1760, "burnedActive": 1080, "burnedTotal": 2840},
        "movement": {"steps": {"goal": 10000, "value": 15389, "distanceInMeters": 11200.5}},
        "intensityMinutes": {"goal": 150, "moderate": 30, "vigorous": 20},
        "bodyBattery": {"minValue": 25, "maxValue": 80, "chargedValue": 60, "drainedValue": 55, "latestValue": 59}}]})
    assert out["2026-10-27"] == {"total_kcal": 2840, "active_kcal": 1080, "resting_kcal": 1760, "steps": 15389,
                                 "intensity_min": 70, "bb_wake": 80, "bb_now": 59}


def test_daily_summaries_accept_older_flat_names():
    out = normalize.daily_summaries({"data": [{
        "calendarDate": "2026-10-27", "totalKilocalories": 2840, "activeKilocalories": 1080, "bmrKilocalories": 1760,
        "totalSteps": 15389, "moderateIntensityMinutes": 30, "vigorousIntensityMinutes": 20,
        "bodyBatteryAtWakeTime": 80, "bodyBatteryMostRecentValue": 59}]})
    assert out["2026-10-27"] == {"total_kcal": 2840, "active_kcal": 1080, "resting_kcal": 1760, "steps": 15389,
                                 "intensity_min": 70, "bb_wake": 80, "bb_now": 59}


def test_sleep_summaries_read_nested_scores():
    out = normalize.sleep_summaries([
        {"calendarDate": "2026-10-27", "sleepTimeSeconds": 26280, "sleepScores": {"overall": {"value": 83}}},
        {"dailySleepDTO": {"calendarDate": "2026-10-26", "sleepTimeSeconds": 25200, "sleepScores": {"overall": {"value": 71}}}},
    ])
    assert out["2026-10-27"] == {"sleep_score": 83, "sleep_min": 438}
    assert out["2026-10-26"]["sleep_score"] == 71


def test_hrv_and_body_battery():
    hrv = normalize.hrv_summaries({"hrvSummaries": [{"calendarDate": "2026-10-27", "lastNightAvg": 61, "weeklyAvg": 58,
                                                     "baseline": {"balancedLow": 52, "balancedUpper": 66}}]})
    assert hrv["2026-10-27"] == {"hrv": 61, "hrv_week": 58, "hrv_low": 52, "hrv_high": 66}
    bb = normalize.body_battery([{"date": "2026-10-27", "bodyBatteryValuesArray": [[1, 80], [2, 74], [3, None], [4, 59]]}])
    assert bb == {"2026-10-27": {"bb_now": 59}}


def test_missing_fields_are_left_out_not_zeroed():
    assert normalize.daily_summaries([{"calendarDate": "2026-10-27"}]) == {"2026-10-27": {}}
    assert normalize.merge({"d": {"a": 1, "b": 2}}, {"d": {"b": 3}}) == {"d": {"a": 1, "b": 3}}
