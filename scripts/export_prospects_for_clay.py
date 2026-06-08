#!/usr/bin/env python3
"""Export weak buyer prospects from Airtable for Clay CSV enrichment."""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"
DEFAULT_OUTPUT = ROOT / "exports" / "clay_input_prospects.csv"
HTTP_TIMEOUT = 45


def load_env() -> None:
    if not ENV_PATH.exists():
        return
    for raw in ENV_PATH.read_text().splitlines():
        line = raw.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key, value)


def normalize_base_id(raw_base: str) -> str:
    match = re.search(r"app[A-Za-z0-9]{14,}", raw_base)
    return match.group(0) if match else raw_base.strip()


def http_json(method: str, url: str, headers: dict | None = None) -> dict:
    request = urllib.request.Request(url, method=method, headers=headers or {})
    with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT) as response:
        raw = response.read().decode()
        return json.loads(raw) if raw else {}


def airtable_url(table: str, query: dict | None = None) -> str:
    raw_base = os.environ.get("AIRTABLE_BASE_ID") or os.environ.get("AIRTABLEBASEID", "")
    base = normalize_base_id(raw_base)
    url = f"https://api.airtable.com/v0/{base}/{urllib.parse.quote(table)}"
    if query:
        url += "?" + urllib.parse.urlencode(query, doseq=True)
    return url


def list_records(table: str) -> list[dict]:
    records: list[dict] = []
    offset = None
    while True:
        query = {"pageSize": 100}
        if offset:
            query["offset"] = offset
        payload = http_json(
            "GET",
            airtable_url(table, query),
            headers={"Authorization": f"Bearer {os.environ['AIRTABLE_API_TOKEN']}"},
        )
        records.extend(payload.get("records", []))
        offset = payload.get("offset")
        if not offset:
            return records


def should_export(fields: dict, include_qualified: bool) -> bool:
    status = str(fields.get("Status", "")).strip()
    if status == "Rejected":
        return False
    if include_qualified:
        return True
    return not str(fields.get("Contact Email", "")).strip()


def main() -> None:
    parser = argparse.ArgumentParser(description="Export Airtable prospects for Clay enrichment.")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT), help="Output CSV path.")
    parser.add_argument("--include-qualified", action="store_true", help="Export prospects that already have emails too.")
    args = parser.parse_args()

    load_env()
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)

    prospects = list_records("Broker Prospects")
    rows = []
    for prospect in prospects:
        fields = prospect.get("fields", {})
        if not should_export(fields, args.include_qualified):
            continue
        rows.append(
            {
                "Airtable Record ID": prospect["id"],
                "Company Name": fields.get("Company Name", ""),
                "Website": fields.get("Website", ""),
                "Buyer Type": fields.get("Buyer Type", ""),
                "Target Vertical": fields.get("Target Vertical", ""),
                "Status": fields.get("Status", ""),
                "Research Notes": fields.get("Research Notes", ""),
            }
        )

    with output.open("w", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "Airtable Record ID",
                "Company Name",
                "Website",
                "Buyer Type",
                "Target Vertical",
                "Status",
                "Research Notes",
            ],
        )
        writer.writeheader()
        writer.writerows(rows)

    print(f"exported {len(rows)} prospects for Clay enrichment")
    print(f"output={output}")


if __name__ == "__main__":
    main()
