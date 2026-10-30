"""The deploy script's commands, with gcloud and firebase stubbed out: what runs, as whom, and that secrets
only ever travel on stdin."""

import json
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import zona_cloud as zc  # noqa: E402

PROJECT = "zona-624e5"
BUNDLE = {"GARMIN_PERSONAL_API_KEY": "G" * 30, "ZONA_PASSWORD": "P" * 14, "ZONA_TICK_SECRET": "T" * 43}
OLD_BUNDLE = {**BUNDLE, "ZONA_VAPID_PRIVATE_KEY": "old"}


class Cloud:
    """Answers gcloud the way a project mid-setup would, and records every call."""

    def __init__(self, *, account_exists: bool = False, job_exists: bool = False, bundle: dict | None = BUNDLE) -> None:
        self.calls: list[tuple[list[str], str | None]] = []
        self.account_exists, self.job_exists, self.bundle = account_exists, job_exists, bundle

    def __call__(self, cmd, input=None, text=True, capture_output=False, cwd=None):
        args = cmd[1:]
        self.calls.append((args, input))
        out, code = "", 0
        if args[:4] == ["secrets", "versions", "access", "latest"]:
            out, code = (json.dumps(self.bundle), 0) if self.bundle else ("", 1)
        elif args[:2] == ["projects", "describe"]:
            out = json.dumps({"projectNumber": "544442877329"})
        elif args[:3] == ["iam", "service-accounts", "describe"]:
            code = 0 if self.account_exists else 1
        elif args[:3] == ["scheduler", "jobs", "describe"]:
            code = 0 if self.job_exists else 1
        elif args[:3] == ["run", "services", "describe"]:
            out = json.dumps({"status": {"url": "https://zona-abc-uc.a.run.app"}})
        elif args[:3] == ["secrets", "versions", "list"]:
            out = json.dumps([{"name": f"projects/1/secrets/zona-env/versions/{n}"} for n in (1, 3, 2)])
        elif args[:2] == ["secrets", "describe"]:
            code = 0 if self.bundle else 1
        return subprocess.CompletedProcess(cmd, code, out, "")

    def ran(self, *prefix: str) -> list[list[str]]:
        return [a for a, _ in self.calls if a[:len(prefix)] == list(prefix)]

    def all_args(self) -> str:
        return " ".join(x for a, _ in self.calls for x in a)


@pytest.fixture
def cloud(monkeypatch):
    def make(**kw) -> Cloud:
        c = Cloud(**kw)
        monkeypatch.setattr(zc.subprocess, "run", c)
        monkeypatch.setattr(zc, "tool", lambda name: [f"C:/bin/{name}.cmd"])
        monkeypatch.setattr(zc.time, "sleep", lambda s: None)
        monkeypatch.setattr(zc.urllib.request, "urlopen", lambda *a, **k: (_ for _ in ()).throw(OSError("offline")))
        return c
    return make


def test_setup_gives_the_server_its_own_narrow_account(cloud):
    c = cloud()
    zc.setup(PROJECT)
    assert c.ran("iam", "service-accounts", "create", "zona-run")
    bindings = {(a[3], a[4]) for a in c.ran("projects", "add-iam-policy-binding")}
    assert ("--member=serviceAccount:zona-run@zona-624e5.iam.gserviceaccount.com", "--role=roles/datastore.user") in bindings
    assert ("--member=serviceAccount:544442877329-compute@developer.gserviceaccount.com", "--role=roles/run.builder") in bindings
    assert not any("datastore" in r and "compute" in m for m, r in bindings)  # the Editor account gets nothing new


def test_setup_is_safe_to_repeat(cloud):
    c = cloud(account_exists=True)
    zc.setup(PROJECT)
    assert not c.ran("iam", "service-accounts", "create")


def test_deploy_runs_as_zona_run_and_keeps_secrets_off_the_command_line(cloud):
    c = cloud()
    zc.deploy(PROJECT)
    run_deploy = c.ran("run", "deploy")[0]
    assert "--service-account=zona-run@zona-624e5.iam.gserviceaccount.com" in run_deploy
    assert "--set-secrets=ZONA_SECRETS=zona-env:latest" in run_deploy and "--max-instances=1" in run_deploy
    assert c.ran("scheduler", "jobs", "create", "http", "zona-tick") and c.ran("scheduler", "jobs", "run", "zona-tick")
    args = c.all_args()
    assert "G" * 30 not in args and "P" * 14 not in args
    assert all("T" * 43 not in " ".join(a) for a, _ in c.calls if a[:2] != ["scheduler", "jobs"])
    assert "(" not in args and "^" not in args and "&" not in args  # Windows cmd would mangle these


def test_deploy_updates_an_existing_schedule(cloud):
    c = cloud(job_exists=True)
    zc.deploy(PROJECT)
    assert c.ran("scheduler", "jobs", "update", "http") and not c.ran("scheduler", "jobs", "create")


def test_deploy_needs_secrets_first(cloud):
    cloud(bundle=None)
    with pytest.raises(zc.Step, match="secrets"):
        zc.deploy(PROJECT)


def test_secrets_go_in_on_stdin_and_only_the_newest_version_stays(cloud, monkeypatch):
    c = cloud(bundle=OLD_BUNDLE)
    monkeypatch.setattr(zc, "ask", lambda name: ("N" * 30, False))
    zc.secrets(PROJECT, "GARMIN_PERSONAL_API_KEY")
    added = [json.loads(i) for a, i in c.calls if a[:3] == ["secrets", "versions", "add"]]
    assert added == [{**BUNDLE, "GARMIN_PERSONAL_API_KEY": "N" * 30}]  # keeps the rest, drops the retired web-push keys
    assert [a[3] for a in c.ran("secrets", "versions", "destroy")] == ["1", "2"]
    assert c.ran("secrets", "add-iam-policy-binding")[0][3] == "--member=serviceAccount:zona-run@zona-624e5.iam.gserviceaccount.com"
    assert "N" * 30 not in c.all_args()


def test_hidden_prompts_refuse_to_run_without_a_real_console(monkeypatch):
    monkeypatch.setattr(zc.sys.stdin, "isatty", lambda: False, raising=False)
    with pytest.raises(zc.Step, match="PowerShell"):
        zc.ask("GARMIN_PERSONAL_API_KEY")
