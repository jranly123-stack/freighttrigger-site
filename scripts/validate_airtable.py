#!/usr/bin/env python3
"""Validate FreightTrigger Airtable connectivity without printing secrets."""

from __future__ import annotations

import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path
from urllib.error import HTTPError

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"

TABLES = [
    "Companies",
    "Signals",
    "Scores",
    "Broker Prospects",
    "Outreach",
    "Replies",
    "Clients",
    "Reports",
    "Suppression List",
]


def load_env() -> None:
    if not ENV_PATH.exists():
        return
    for raw in ENV_PATH.read_text().splitlines():
        line = raw.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key, value)


def airtable_get(table: str) -> tuple[int, dict | str]:
    raw_base = os.environ.get("AIRTABLE_BASE_ID") or os.environ.get("AIRTABLEBASEID", "")
    match = __import__("re").search(r"app[A-Za-z0-9]{14,}", raw_base)
    base = match.group(0) if match else raw_base.strip()
    token = os.environ["AIRTABLE_API_TOKEN"]
    url = f"https://api.airtable.com/v0/{base}/{urllib.parse.quote(table)}?pageSize=1"
    request = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            return response.status, json.loads(response.read().decode() or "{}")
    except HTTPError as error:
        body = error.read().decode(errors="ignore")
        return error.code, body[:240].replace("\n", " ")


def main() -> int:
    load_env()
    missing = [key for key in ("AIRTABLE_API_TOKEN",) if not os.environ.get(key)]
    if not (os.environ.get("AIRTABLE_BASE_ID") or os.environ.get("AIRTABLEBASEID")):
        missing.append("AIRTABLE_BASE_ID")
    if missing:
        print(f"missing env: {', '.join(missing)}")
        return 2

    failures = 0
    for table in TABLES:
        status, payload = airtable_get(table)
        if status == 200 and isinstance(payload, dict):
            records = payload.get("records", [])
            sample_fields = sorted(records[0].get("fields", {}).keys())[:8] if records else []
            print(f"OK {table}: records_visible={len(records)} sample_fields={sample_fields}")
            continue

        failures += 1
        print(f"FAIL {table}: http={status} body={payload}")

    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
