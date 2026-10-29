"""One-person login: a password, then a signed session cookie. No user table, nothing to leak but the cookie."""

from __future__ import annotations

import base64
import hashlib
import hmac
import threading
import time
from dataclasses import dataclass, field

COOKIE = "zona_session"
MAX_AGE_S = 180 * 24 * 3600  # a home-screen app shouldn't ask often
MAX_TOKEN_LEN = 100
MAX_FAILURES, WINDOW_S = 5, 15 * 60
MAX_TRACKED_CLIENTS = 10_000


def session_key(secret: bytes, password: str) -> bytes:
    """Signing key. It includes the password, so changing the password signs every device out."""
    return secret + b"\0" + hashlib.sha256(password.encode()).digest()


def _mac(key: bytes, issued: int, epoch: int) -> str:
    digest = hmac.new(key, f"zona-session:v1:{epoch}:{issued}".encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


def make_session(key: bytes, epoch: int, now: float | None = None) -> str:
    issued = int(time.time() if now is None else now)
    return f"{issued}.{_mac(key, issued, epoch)}"


def session_ok(key: bytes, epoch: int, token: str | None, now: float | None = None) -> bool:
    """Valid if the signature matches the current epoch and it isn't older than MAX_AGE_S.
    Bumping the epoch (sign out) or changing the secret or password revokes every cookie."""
    if not token or len(token) > MAX_TOKEN_LEN or not token.isascii() or token.count(".") != 1:
        return False
    issued_s, mac = token.split(".")
    if not (issued_s.isdigit() and len(issued_s) <= 12):
        return False
    issued, now = int(issued_s), time.time() if now is None else now
    return hmac.compare_digest(mac.encode(), _mac(key, issued, epoch).encode()) and 0 <= now - issued <= MAX_AGE_S


def password_ok(given: str, expected: str) -> bool:
    # Hash both so compare_digest sees equal lengths and timing says nothing about the password's length.
    return hmac.compare_digest(hashlib.sha256(given.encode()).digest(), hashlib.sha256(expected.encode()).digest())


@dataclass
class LoginLimiter:
    """MAX_FAILURES wrong passwords per client in WINDOW_S, then that client waits out the window.

    Per client so a stranger can't lock the owner out. begin() counts the attempt up front, under a lock,
    so a burst of parallel guesses can't all slip past the check before any of them is recorded.
    """

    attempts: dict[str, list[float]] = field(default_factory=dict)
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def begin(self, client: str, now: float | None = None) -> bool:
        now = time.time() if now is None else now
        with self._lock:
            recent = [t for t in self.attempts.get(client, []) if now - t < WINDOW_S]
            if len(recent) >= MAX_FAILURES:
                self.attempts[client] = recent
                return False
            self.attempts[client] = recent + [now]
            if len(self.attempts) > MAX_TRACKED_CLIENTS:  # keep memory bounded; drop the oldest-touched client
                self.attempts.pop(next(iter(self.attempts)))
            return True

    def succeeded(self, client: str) -> None:
        with self._lock:
            self.attempts.pop(client, None)
