"""Command line helpers.

  python -m zona inspect   with GARMIN_PERSONAL_API_KEY set: show the shape of each response Zona reads,
                           to check normalize.py against your real data (prints field names and types, not values)
"""

from __future__ import annotations

import os
import sys
from datetime import date, timedelta
from pathlib import Path

from .garmin import LiveGarmin
from .shapes import shape


def inspect() -> int:
    key = os.environ.get("GARMIN_PERSONAL_API_KEY")
    if not key:
        sys.stderr.write("Set GARMIN_PERSONAL_API_KEY first.\n")
        return 2
    g = LiveGarmin(key, Path(os.environ.get("ZONA_DATA_DIR", "./data")) / "garmin-bearer-token.json")
    end = date.today()
    start = end - timedelta(days=2)
    calls = {
        "activities": lambda: g.search_activities(start=0, limit=3),
        "daily_summaries": lambda: g.get_daily_summaries(start, end),
        "sleep_summaries": lambda: g.get_daily_sleep_summaries(start, end),
        "hrv_summaries": lambda: g.get_daily_hrv_summaries(start, end),
        "body_battery": lambda: g.get_daily_body_battery(start, end),
    }
    for name, call in calls.items():
        sys.stdout.write(f"\n== {name}\n{shape(call())}\n")
    return 0


def main(argv: list[str]) -> int:
    if argv[:1] == ["inspect"]:
        return inspect()
    sys.stdout.write(__doc__ or "")
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
