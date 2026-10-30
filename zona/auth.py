"""One-person login: a password, then a signed bearer token kept in the phone's Keychain. No user table."""

from __future__ import annotations

import base64
import hashlib
import hmac
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field

MAX_AGE_S = 180 * 24 * 3600  # a phone app shouldn't ask often
MAX_TOKEN_LEN = 100
MAX_FAILURES, WINDOW_S = 5, 15 * 60
MAX_TRACKED_CLIENTS = 10_000
MAX_ATTEMPTS_ANYWHERE = 60  # across all clients in WINDOW_S; one person's phone never needs this many


def session_key(secret: bytes, password: str) -> bytes:
    """Signing key. It includes the password, so changing the password signs every device out."""
    return secret + b"\0" + hashlib.sha256(password.encode()).digest()


def _mac(key: bytes, issued: int, epoch: int) -> str:
    digest = hmac.new(key, f"zona-session:v1:{epoch}:{issued}".encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


def make_session(key: bytes, epoch: int, now: float | None = None) -> str:
    issued = int(time.time() if now is None else now)
    return f"{epoch}.{issued}.{_mac(key, issued, epoch)}"


def session_ok(key: bytes, token: str | None, current_epoch: Callable[[], int], now: float | None = None) -> bool:
    """Valid if the signature is ours, it isn't older than MAX_AGE_S, and its epoch is still the current one.
    Bumping the epoch (sign out) or changing the secret or password revokes every token.
    The epoch is read last, so junk tokens can't run up database reads."""
    if not token or len(token) > MAX_TOKEN_LEN or not token.isascii() or token.count(".") != 2:
        return False
    epoch_s, issued_s, mac = token.split(".")
    if not (epoch_s.isdigit() and issued_s.isdigit() and len(epoch_s) <= 12 and len(issued_s) <= 12):
        return False
    epoch, issued, now = int(epoch_s), int(issued_s), time.time() if now is None else now
    if not hmac.compare_digest(mac.encode(), _mac(key, issued, epoch).encode()) or not 0 <= now - issued <= MAX_AGE_S:
        return False
    return epoch == current_epoch()


def password_ok(given: str, expected: str) -> bool:
    # Hash both so compare_digest sees equal lengths and timing says nothing about the password's length.
    return hmac.compare_digest(hashlib.sha256(given.encode()).digest(), hashlib.sha256(expected.encode()).digest())


@dataclass
class LoginLimiter:
    """MAX_FAILURES wrong passwords per client in WINDOW_S, then that client waits out the window.

    Per client so a stranger can't lock the owner out. MAX_ATTEMPTS_ANYWHERE caps guessing from many addresses: past it,
    nobody can log in until the window passes, but phones already signed in keep working. begin() counts the attempt up
    front, under a lock, so a burst of parallel guesses can't all slip past the check before any of them is recorded.
    """

    attempts: dict[str, list[float]] = field(default_factory=dict)
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def begin(self, client: str, now: float | None = None) -> bool:
        now = time.time() if now is None else now
        with self._lock:
            recent = [t for t in self.attempts.get(client, []) if now - t < WINDOW_S]
            anywhere = sum(1 for times in self.attempts.values() for t in times if now - t < WINDOW_S)
            if len(recent) >= MAX_FAILURES or anywhere >= MAX_ATTEMPTS_ANYWHERE:
                self.attempts[client] = recent
                return False
            self.attempts[client] = recent + [now]
            if len(self.attempts) > MAX_TRACKED_CLIENTS:  # keep memory bounded; drop the oldest-touched client
                self.attempts.pop(next(iter(self.attempts)))
            return True

    def succeeded(self, client: str) -> None:
        with self._lock:
            self.attempts.pop(client, None)
