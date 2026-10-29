"""Web push to the home-screen app on your iPhone (iOS 16.4+), signed with Zona's VAPID key."""

from __future__ import annotations

import base64
import binascii
import json
import logging
import re

import requests
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from pywebpush import WebPushException, webpush
from urllib3.exceptions import LocationParseError
from urllib3.util import parse_url

from .db import Repo

log = logging.getLogger(__name__)
PUSH_TTL_S = 3600
GONE = (404, 410)
PUSH_HOSTS = ("web.push.apple.com", "fcm.googleapis.com", "updates.push.services.mozilla.com", "notify.windows.com")
_BAD_URL_CHARS = re.compile(r"[\\@\s\x00-\x1f\x7f]")


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def generate_vapid_keys() -> tuple[str, str]:
    """(private key as base64url DER, public key as base64url uncompressed point) for the browser."""
    key = ec.generate_private_key(ec.SECP256R1())
    private = key.private_bytes(serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    public = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return _b64(private), _b64(public)


def push_endpoint_ok(url: str) -> bool:
    """Only real push services. Parsed with urllib3, the parser requests itself uses, so the check and the
    POST agree on the host; backslashes, userinfo and odd ports are refused outright."""
    if len(url) > 1000 or _BAD_URL_CHARS.search(url):
        return False
    try:
        u = parse_url(url)
    except LocationParseError:
        return False
    if u.scheme != "https" or u.auth or u.port not in (None, 443):
        return False
    host = (u.host or "").lower().rstrip(".")
    return any(host == h or host.endswith("." + h) for h in PUSH_HOSTS)


def push_keys_ok(p256dh: str, auth: str) -> bool:
    """p256dh must be an uncompressed P-256 point (65 bytes, 0x04 first); auth is a 16-byte secret."""
    try:
        point, secret = _unb64(p256dh), _unb64(auth)
    except (binascii.Error, ValueError):
        return False
    return len(point) == 65 and point[0] == 4 and len(secret) == 16


class Pusher:
    def __init__(self, repo: Repo, private_key: str | None, public_key: str | None, subject: str) -> None:
        self.repo, self.private_key, self.public_key, self.subject = repo, private_key, public_key, subject
        self._session = requests.Session()
        self._session.max_redirects = 0  # a push service never redirects; following one would undo the host check

    @property
    def enabled(self) -> bool:
        return bool(self.private_key and self.public_key)

    def send(self, title: str, body: str, url: str = "/", tag: str = "zona") -> int:
        """Send to every subscribed device and return how many got it. Never raises: one device failing,
        or the network being down, must not stop the caller from recording the nudge."""
        if not self.enabled:
            return 0
        data = json.dumps({"title": title, "body": body, "url": url, "tag": tag})
        sent = 0
        for sub in self.repo.subs():
            if not push_endpoint_ok(sub["endpoint"]):
                self.repo.delete_sub(sub["endpoint"])
                log.warning("Dropped a push subscription with a disallowed endpoint")
                continue
            try:
                webpush(subscription_info={"endpoint": sub["endpoint"], "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]}},
                        data=data, vapid_private_key=self.private_key, vapid_claims={"sub": self.subject},
                        ttl=PUSH_TTL_S, timeout=10, requests_session=self._session)
                sent += 1
            except WebPushException as exc:
                status = getattr(exc.response, "status_code", None)
                if status in GONE:
                    self.repo.delete_sub(sub["endpoint"])
                    log.info("Dropped an expired push subscription")
                else:
                    log.warning("Push failed with status %s", status)
            except Exception as exc:  # network trouble, a malformed key; logged by type only, never the payload
                log.warning("Push failed: %s", type(exc).__name__)
        return sent
