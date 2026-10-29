"""Where Garmin data comes from: the live Personal API, or the fake source in fake.py."""

from __future__ import annotations

import logging
from datetime import date
from pathlib import Path
from typing import Any, Protocol

from garmin_personal_api import GarminPersonalApiClient, HttpError, PersonalApiAuthenticator

log = logging.getLogger(__name__)


class GarminKeyError(RuntimeError):
    """The Personal API key was refused: expired, revoked or mistyped. A new key is the only fix."""


class GarminSource(Protocol):
    def search_activities(self, *, start: int = 0, limit: int = 20, start_date: date | None = None,
                          end_date: date | None = None) -> Any: ...
    def get_daily_summaries(self, start_date: date, end_date: date) -> Any: ...
    def get_daily_sleep_summaries(self, start_date: date, end_date: date) -> Any: ...
    def get_daily_hrv_summaries(self, start_date: date, end_date: date) -> Any: ...
    def get_daily_body_battery(self, start_date: date, end_date: date) -> Any: ...


class LiveGarmin:
    """Garmin's official client, with the key swapped for a bearer token and renewed once on a 401."""

    def __init__(self, api_key: str, token_cache: Path) -> None:
        self._key = api_key
        self._auth = PersonalApiAuthenticator(bearer_token_cache_file=token_cache)
        self._client: GarminPersonalApiClient | None = None

    def _token(self, force: bool) -> str:
        try:
            return self._auth.obtain_token(self._key, force_refresh=force).access_token
        except HttpError as exc:
            if exc.status_code in (400, 401, 403):
                raise GarminKeyError(f"Garmin refused the Personal API key (HTTP {exc.status_code})") from None
            raise

    def _call(self, method: str, *args: Any, **kwargs: Any) -> Any:
        for attempt in range(2):
            token = self._token(force=attempt > 0)
            if self._client is None:
                self._client = GarminPersonalApiClient(token)
            else:
                self._client.update_bearer_token(token)
            try:
                return getattr(self._client, method)(*args, **kwargs)
            except HttpError as exc:
                if exc.status_code == 401 and attempt == 0:
                    log.info("Bearer token rejected; requesting a new one")
                    continue
                raise
        raise AssertionError("unreachable")

    def search_activities(self, **kwargs: Any) -> Any:
        return self._call("search_activities", **kwargs)

    def get_daily_summaries(self, start_date: date, end_date: date) -> Any:
        return self._call("get_daily_summaries", start_date, end_date)

    def get_daily_sleep_summaries(self, start_date: date, end_date: date) -> Any:
        return self._call("get_daily_sleep_summaries", start_date, end_date)

    def get_daily_hrv_summaries(self, start_date: date, end_date: date) -> Any:
        return self._call("get_daily_hrv_summaries", start_date, end_date)

    def get_daily_body_battery(self, start_date: date, end_date: date) -> Any:
        return self._call("get_daily_body_battery", start_date, end_date)
