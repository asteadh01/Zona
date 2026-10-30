import pytest
import requests

from zona.push import EXPO_PUSH_URL, TOKEN_RE, Pusher

GOOD, GONE = "ExponentPushToken[aaaaaaaaaaaaaaaa]", "ExponentPushToken[bbbbbbbbbbbbbbbb]"


class FakeRepo:
    def __init__(self, tokens):
        self.tokens = list(tokens)

    def push_tokens(self):
        return list(self.tokens)

    def delete_push_token(self, token):
        self.tokens.remove(token)


class FakeSession:
    def __init__(self, tickets=None, error=None):
        self.tickets, self.error, self.posts = tickets, error, []

    def post(self, url, json, timeout):
        self.posts.append((url, json))
        if self.error:
            raise self.error
        session = self

        class Response:
            def raise_for_status(self):
                pass

            def json(self):
                return {"data": session.tickets}

        return Response()


@pytest.mark.parametrize("token,ok", [
    (GOOD, True), ("ExpoPushToken[abc_DEF-1234567]", True), ("https://evil.example/x", False),
    ("ExponentPushToken[short]", False), ("ExponentPushToken[aaaaaaaaaaaaaaaa] x", False),
])
def test_only_expo_tokens_are_accepted(token, ok):
    assert bool(TOKEN_RE.match(token)) is ok


def test_sends_the_message_with_its_buttons_and_amount():
    session = FakeSession([{"status": "ok"}])
    sent = Pusher(FakeRepo([GOOD]), session).send("Run done", "Drink", url="/water?nudge=workout:1", tag="workout:1", category="nudge", ml=400)
    url, messages = session.posts[0]
    assert sent == 1 and url == EXPO_PUSH_URL
    assert messages == [{"to": GOOD, "title": "Run done", "body": "Drink", "sound": "default", "categoryId": "nudge",
                         "data": {"url": "/water?nudge=workout:1", "tag": "workout:1", "ml": 400}}]


def test_a_phone_that_is_gone_gets_dropped_and_the_rest_still_count():
    repo = FakeRepo([GOOD, GONE])
    session = FakeSession([{"status": "ok"}, {"status": "error", "details": {"error": "DeviceNotRegistered"}}])
    assert Pusher(repo, session).send("t", "b") == 1
    assert repo.tokens == [GOOD]


def test_a_network_failure_never_raises():
    session = FakeSession(error=requests.ConnectionError("down"))
    assert Pusher(FakeRepo([GOOD]), session).send("t", "b") == 0


def test_no_phones_means_no_request():
    session = FakeSession([])
    assert Pusher(FakeRepo([]), session).send("t", "b") == 0 and session.posts == []
