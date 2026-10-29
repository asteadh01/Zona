import pytest
import requests

from zona import push
from zona.push import Pusher, push_endpoint_ok, push_keys_ok

GOOD_KEYS = {"p256dh": "B" * 87, "auth": "a" * 22}  # 65 bytes starting 0x04, and 16 bytes


@pytest.mark.parametrize("url", [
    "https://web.push.apple.com/QO2x",
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/x",
    "https://wns2-par02p.notify.windows.com/w/?token=x",
])
def test_real_push_services_pass(url):
    assert push_endpoint_ok(url)


@pytest.mark.parametrize("url", [
    "https://evil.com\\@web.push.apple.com/x",           # urlparse and urllib3 disagree on the host
    "https://127.0.0.1\\.web.push.apple.com/",
    "https://user@web.push.apple.com/x",
    "https://web.push.apple.com:8443/x",
    "https://web.push.apple.com.evil.example/x",
    "https://169.254.169.254/latest/meta-data",
    "http://web.push.apple.com/x",
    "https://web.push.apple.com/x\r\nHost: evil",
])
def test_bypasses_are_refused(url):
    assert not push_endpoint_ok(url)


def test_push_keys_must_decode():
    assert push_keys_ok(**GOOD_KEYS)
    assert not push_keys_ok("A" * 21, "a" * 22)        # decodes, but not a P-256 point
    assert not push_keys_ok("B" * 87, "a" * 10)        # auth secret too short
    assert not push_keys_ok("not base64 !!", "a" * 22)


class FakeRepo:
    def __init__(self, subs):
        self._subs, self.deleted = subs, []

    def subs(self):
        return list(self._subs)

    def delete_sub(self, endpoint):
        self.deleted.append(endpoint)


def test_one_device_failing_never_stops_the_others(monkeypatch):
    calls = []

    def fake_webpush(subscription_info, **kw):
        calls.append(subscription_info["endpoint"])
        assert kw["requests_session"].max_redirects == 0
        if "broken" in subscription_info["endpoint"]:
            raise requests.ConnectionError("network down")

    monkeypatch.setattr(push, "webpush", fake_webpush)
    repo = FakeRepo([{"endpoint": "https://web.push.apple.com/broken", **GOOD_KEYS},
                     {"endpoint": "https://web.push.apple.com/fine", **GOOD_KEYS},
                     {"endpoint": "https://evil.com\\@web.push.apple.com/x", **GOOD_KEYS}])
    sent = Pusher(repo, "priv", "pub", "mailto:me@example.org").send("t", "b")
    assert sent == 1
    assert len(calls) == 2  # the disallowed endpoint is never contacted
    assert repo.deleted == ["https://evil.com\\@web.push.apple.com/x"]
