#!/usr/bin/env python3
"""Remove weak/bad enriched contact emails before outbound."""

from __future__ import annotations

import json
import os
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"
GOOD_PREFIXES = ("sales", "info", "contact", "hello", "team", "business", "shipping", "logistics")
BAD_PREFIXES = ("support", "safety", "careers", "jobs", "press", "pr", "legal", "privacy", "billing")
BAD_DOMAINS = ("zohoforms.com", "2x.png", "sentry.io")


def load_env() -> None:
    for raw in ENV_PATH.read_text().splitlines():
        line = raw.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key, value)


def http_json(method: str, url: str, body: dict | None = None) -> dict:
    data = None
    headers = {"Authorization": f"Bearer {os.environ['AIRTABLE_API_TOKEN']}", "Content-Type": "application/json"}
    if body is not None:
        data = json.dumps(body).encode()
    request = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(request, timeout=30) as response:
        raw = response.read().decode()
        return json.loads(raw) if raw else {}


def airtable_url(table: str, query: dict | None = None) -> str:
    url = f"https://api.airtable.com/v0/{os.environ['AIRTABLE_BASE_ID']}/{urllib.parse.quote(table)}"
    if query:
        url += "?" + urllib.parse.urlencode(query, doseq=True)
    return url


def list_records(table: str) -> list[dict]:
    records = []
    offset = None
    while True:
        query = {"pageSize": 100}
        if offset:
            query["offset"] = offset
        payload = http_json("GET", airtable_url(table, query))
        records.extend(payload.get("records", []))
        offset = payload.get("offset")
        if not offset:
            return records


def patch_records(table: str, records: list[dict]) -> None:
    for index in range(0, len(records), 10):
        http_json("PATCH", airtable_url(table), {"typecast": True, "records": records[index : index + 10]})
        time.sleep(0.2)


def is_good(email: str) -> bool:
    if "@" not in email:
        return False
    prefix, domain = email.lower().split("@", 1)
    if any(prefix.startswith(bad) for bad in BAD_PREFIXES):
        return False
    if any(domain.endswith(bad) for bad in BAD_DOMAINS):
        return False
    return any(prefix == good or good in prefix for good in GOOD_PREFIXES)


def main() -> None:
    load_env()
    updates = []
    for record in list_records("Broker Prospects"):
        fields = record.get("fields", {})
        email = str(fields.get("Contact Email", "")).strip().lower()
        if not email or is_good(email):
            continue
        updates.append(
            {
                "id": record["id"],
                "fields": {
                    "Contact Email": "",
                    "Status": "Needs Contact",
                    "Research Notes": f"{fields.get('Research Notes', '')}\nContact cleanup: removed weak email {email}",
                },
            }
        )
        print(f"removed weak contact: {fields.get('Company Name')} -> {email}")
    patch_records("Broker Prospects", updates)
    print(f"cleaned {len(updates)} weak contacts")


if __name__ == "__main__":
    main()
