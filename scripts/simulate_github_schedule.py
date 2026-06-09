#!/usr/bin/env python3
"""Simulate FreightTrigger GitHub Actions schedule mapping without calling Vercel."""

from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

EASTERN = ZoneInfo("America/New_York")
SCHEDULE = {
    "13:00": ["signal-scan"],
    "13:15": ["prospect-acquisition"],
    "17:15": ["prospect-acquisition"],
    "21:15": ["prospect-acquisition"],
    "13:30": ["outreach-send"],
    "15:30": ["outreach-send"],
    "17:30": ["outreach-send"],
    "19:30": ["outreach-send"],
    "21:30": ["outreach-send"],
    "23:30": ["outreach-send"],
    "14:00": ["reply-loop"],
    "18:00": ["reply-loop"],
    "22:00": ["reply-loop"],
}


def main() -> None:
    print("FreightTrigger schedule simulation")
    print("No network calls. No emails. This mirrors .github/workflows/freighttrigger-automation.yml.")
    print()
    for utc_time, jobs in sorted(SCHEDULE.items()):
        hour, minute = map(int, utc_time.split(":"))
        sample = datetime(2026, 6, 9, hour, minute, tzinfo=timezone.utc)
        eastern = sample.astimezone(EASTERN)
        extra = " + weekly-report on Monday" if utc_time == "14:00" else ""
        print(f"{utc_time} UTC -> {eastern.strftime('%I:%M %p ET').lstrip('0')}: {', '.join(jobs)}{extra}")


if __name__ == "__main__":
    main()
