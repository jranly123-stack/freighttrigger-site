#!/usr/bin/env python3
"""Read-only FreightTrigger Airtable operating snapshot.

This reports queue health without exposing secrets or sending email.
"""

from __future__ import annotations

import json
import os
import re
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"
HTTP_TIMEOUT = 45


def load_env() -> None:
    if not ENV_PATH.exists():
        return
    for raw in ENV_PATH.read_text().splitlines():
        line = raw.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key, value)


def env_value(*keys: str) -> str:
    for key in keys:
        value = os.environ.get(key)
        if value:
            return value
    return ""


def normalize_base_id(raw_base: str) -> str:
    match = re.search(r"app[A-Za-z0-9]{14,}", raw_base)
    return match.group(0) if match else raw_base.strip()


def airtable_url(table: str, query: dict | None = None) -> str:
    base = normalize_base_id(env_value("AIRTABLE_BASE_ID", "AIRTABLEBASEID"))
    url = f"https://api.airtable.com/v0/{base}/{urllib.parse.quote(table)}"
    if query:
        url += "?" + urllib.parse.urlencode(query, doseq=True)
    return url


def http_json(url: str) -> dict:
    base = env_value("AIRTABLE_BASE_ID", "AIRTABLEBASEID")
    token = env_value("AIRTABLE_API_TOKEN", "AIRTABLEAPITOKEN")
    missing = []
    if not base:
        missing.append("AIRTABLE_BASE_ID/AIRTABLEBASEID")
    if not token:
        missing.append("AIRTABLE_API_TOKEN/AIRTABLEAPITOKEN")
    if missing:
        raise RuntimeError(f"missing env: {', '.join(missing)}")

    request = urllib.request.Request(
        url,
        method="GET",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT) as response:
        return json.loads(response.read().decode())


def list_records(table: str) -> list[dict]:
    records: list[dict] = []
    offset = None
    while True:
        query = {"pageSize": 100}
        if offset:
            query["offset"] = offset
        payload = http_json(airtable_url(table, query))
        records.extend(payload.get("records", []))
        offset = payload.get("offset")
        if not offset:
            return records


def count_field(records: list[dict], field: str) -> Counter:
    return Counter(str(record.get("fields", {}).get(field, "Blank") or "Blank") for record in records)


def print_counter(title: str, counter: Counter) -> None:
    print(title)
    if not counter:
        print("- none: 0")
        return
    for key, value in sorted(counter.items(), key=lambda item: (-item[1], item[0])):
        print(f"- {key}: {value}")


def main() -> None:
    load_env()
    prospects = list_records("Broker Prospects")
    outreach = list_records("Outreach")
    replies = list_records("Replies")
    suppression = list_records("Suppression List")
    clients = list_records("Clients")
    reports = list_records("Reports")

    print("FreightTrigger Airtable Ops Snapshot")
    print(f"prospects={len(prospects)} outreach={len(outreach)} replies={len(replies)} suppressions={len(suppression)} clients={len(clients)} reports={len(reports)}")
    print()
    print_counter("Broker Prospects by Status", count_field(prospects, "Status"))
    print()
    print_counter("Outreach by Status", count_field(outreach, "Status"))
    print()
    print_counter("Replies by Intent", count_field(replies, "Intent"))
    print()
    print_counter("Reports by Status", count_field(reports, "Status"))


if __name__ == "__main__":
    main()
