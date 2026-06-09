#!/usr/bin/env python3
"""FreightTrigger always-on scheduler for the VPS worker.

The worker calls protected Vercel cron endpoints on an Eastern business-hours
schedule. It does not send mail directly; Vercel routes still enforce the
CRONSECRET gate, outreach toggles, suppression checks, and API logic.
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"
LOG_DIR = ROOT / "logs"
STATE_PATH = ROOT / ".worker_state.json"
EASTERN = ZoneInfo("America/New_York")

SCHEDULE = {
    "09:00": ["signal-scan"],
    "09:15": ["prospect-acquisition"],
    "09:30": ["outreach-send"],
    "10:00": ["reply-loop"],
    "11:30": ["outreach-send"],
    "13:15": ["prospect-acquisition"],
    "13:30": ["outreach-send"],
    "14:00": ["reply-loop"],
    "15:30": ["outreach-send"],
    "17:15": ["prospect-acquisition"],
    "17:30": ["outreach-send"],
    "18:00": ["reply-loop"],
    "19:30": ["outreach-send"],
}

MONDAY_EXTRA = {
    "10:00": ["weekly-report"],
}


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def read_state() -> dict[str, str]:
    if not STATE_PATH.exists():
        return {}
    try:
        return json.loads(STATE_PATH.read_text())
    except json.JSONDecodeError:
        return {}


def write_state(state: dict[str, str]) -> None:
    STATE_PATH.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n")


def log_event(event: dict[str, object]) -> None:
    LOG_DIR.mkdir(exist_ok=True)
    event.setdefault("logged_at", datetime.now(EASTERN).isoformat())
    with (LOG_DIR / "vps_worker.log").open("a") as handle:
        handle.write(json.dumps(event, sort_keys=True) + "\n")
    print(json.dumps(event, sort_keys=True), flush=True)


def cron_secret() -> str:
    value = os.environ.get("CRONSECRET") or os.environ.get("CRON_SECRET") or ""
    if not value:
        raise RuntimeError("Missing CRONSECRET in VPS .env")
    return value


def ops_base_url() -> str:
    return (os.environ.get("OPS_BASE_URL") or "https://triggerops.vercel.app").rstrip("/")


def call_job(job: str) -> dict[str, object]:
    url = f"{ops_base_url()}/api/cron/{job}"
    request = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {cron_secret()}",
            "User-Agent": "FreightTrigger-VPS-Worker/1.0",
        },
        method="GET",
    )
    started = time.time()
    try:
        with urllib.request.urlopen(request, timeout=80) as response:
            body = response.read().decode("utf-8", errors="replace")
            return {
                "job": job,
                "ok": 200 <= response.status < 300,
                "status": response.status,
                "duration_seconds": round(time.time() - started, 3),
                "body": body[:2000],
            }
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        return {
            "job": job,
            "ok": False,
            "status": error.code,
            "duration_seconds": round(time.time() - started, 3),
            "body": body[:2000],
        }
    except Exception as error:  # noqa: BLE001 - log unknown worker failures.
        return {
            "job": job,
            "ok": False,
            "status": "exception",
            "duration_seconds": round(time.time() - started, 3),
            "body": str(error),
        }


def jobs_due(now: datetime) -> list[str]:
    if now.weekday() >= 5:
        return []
    time_key = now.strftime("%H:%M")
    jobs = list(SCHEDULE.get(time_key, []))
    if now.weekday() == 0:
        jobs.extend(MONDAY_EXTRA.get(time_key, []))
    return jobs


def run_due_once(now: datetime | None = None, force_jobs: list[str] | None = None) -> int:
    now = now or datetime.now(EASTERN)
    state = read_state()
    jobs = force_jobs if force_jobs is not None else jobs_due(now)
    if not jobs:
        log_event({"event": "tick", "jobs": [], "time": now.isoformat()})
        return 0

    failures = 0
    for job in jobs:
        run_key = f"{now.strftime('%Y-%m-%dT%H:%M')}:{job}"
        if force_jobs is None and state.get(run_key) == "done":
            log_event({"event": "skip_duplicate", "job": job, "run_key": run_key})
            continue
        result = call_job(job)
        result["event"] = "job_result"
        result["run_key"] = run_key
        log_event(result)
        if result.get("ok"):
            state[run_key] = "done"
        else:
            failures += 1
            state[run_key] = "failed"
    write_state(state)
    return failures


def service_loop() -> int:
    stop = {"value": False}

    def handle_stop(_signum: int, _frame: object) -> None:
        stop["value"] = True

    signal.signal(signal.SIGTERM, handle_stop)
    signal.signal(signal.SIGINT, handle_stop)

    log_event({"event": "worker_start", "ops_base_url": ops_base_url()})
    while not stop["value"]:
        try:
            run_due_once()
        except Exception as error:  # noqa: BLE001 - worker must log and continue.
            log_event({"event": "worker_error", "error": str(error)})
        time.sleep(60)
    log_event({"event": "worker_stop"})
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true", help="Run jobs due for the current minute once.")
    parser.add_argument("--job", action="append", help="Run a specific job immediately. Can be repeated.")
    parser.add_argument("--list-schedule", action="store_true", help="Print the Eastern schedule.")
    args = parser.parse_args()

    load_env(ENV_PATH)

    if args.list_schedule:
        print(json.dumps({"weekday_eastern": SCHEDULE, "monday_extra": MONDAY_EXTRA}, indent=2))
        return 0

    if args.job:
        return run_due_once(force_jobs=args.job)

    if args.once:
        return run_due_once()

    return service_loop()


if __name__ == "__main__":
    raise SystemExit(main())
