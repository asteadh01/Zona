"""Push notifications to the iPhone app, through Expo's push service, which hands them to Apple.

The phone's Expo push token is all Zona stores. The APNs key lives with Expo (EAS sets it up during the first build).
"""

from __future__ import annotations

import logging
import re

import requests

from .db import Store

log = logging.getLogger(__name__)
EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
TOKEN_RE = re.compile(r"^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,200}\]$")
TIMEOUT_S = 10
GONE = "DeviceNotRegistered"  # the app was deleted, or notifications were turned off for good


class Pusher:
    enabled = True

    def __init__(self, repo: Store, session: requests.Session | None = None) -> None:
        self.repo = repo
        self._session = session or requests.Session()

    def send(self, title: str, body: str, url: str = "/", tag: str = "zona", category: str | None = None,
             ml: int | None = None) -> int:
        """Send to every registered phone and return how many Expo accepted. Never raises: the network being down
        must not stop the caller from recording the nudge. category picks the buttons the app registered for it."""
        tokens = self.repo.push_tokens()
        if not tokens:
            return 0
        data = {"url": url, "tag": tag, **({"ml": ml} if ml else {})}
        messages = [{"to": t, "title": title, "body": body, "sound": "default", "data": data,
                     **({"categoryId": category} if category else {})} for t in tokens]
        try:
            response = self._session.post(EXPO_PUSH_URL, json=messages, timeout=TIMEOUT_S)
            response.raise_for_status()
            tickets = response.json()["data"]
        except Exception as exc:  # network trouble, an Expo outage; logged by type only, never the payload
            log.warning("Push failed: %s", type(exc).__name__)
            return 0
        sent = 0
        for token, ticket in zip(tokens, tickets):
            if ticket.get("status") == "ok":
                sent += 1
            elif (ticket.get("details") or {}).get("error") == GONE:
                self.repo.delete_push_token(token)
                log.info("Dropped a push token Expo says is gone")
            else:
                log.warning("Push refused: %s", (ticket.get("details") or {}).get("error"))
        return sent
