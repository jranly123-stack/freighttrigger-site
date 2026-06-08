#!/usr/bin/env python3
"""Reset FreightTrigger Airtable sample records and seed real signal data."""

from __future__ import annotations

import json
import os
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"
SEED_PATH = ROOT / "data" / "freighttrigger_seed_signals.json"


def load_env() -> None:
    for raw in ENV_PATH.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ[key] = value


def request(method: str, url: str, body: dict | None = None) -> dict:
    data = None
    headers = {"Authorization": f"Bearer {os.environ['AIRTABLE_API_TOKEN']}"}
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as response:
        raw = response.read().decode()
        return json.loads(raw) if raw else {}


def table_url(table: str, query: dict | None = None) -> str:
    raw_base = os.environ.get("AIRTABLE_BASE_ID") or os.environ.get("AIRTABLEBASEID", "")
    match = re.search(r"app[A-Za-z0-9]{14,}", raw_base)
    base = match.group(0) if match else raw_base.strip()
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
        payload = request("GET", table_url(table, query))
        records.extend(payload.get("records", []))
        offset = payload.get("offset")
        if not offset:
            return records


def delete_records(table: str, record_ids: list[str]) -> None:
    for index in range(0, len(record_ids), 10):
        batch = record_ids[index : index + 10]
        request("DELETE", table_url(table, {"records[]": batch}))
        time.sleep(0.2)


def create_records(table: str, records: list[dict]) -> list[dict]:
    created: list[dict] = []
    for index in range(0, len(records), 10):
        batch = {"records": [{"fields": record} for record in records[index : index + 10]]}
        payload = request("POST", table_url(table), batch)
        created.extend(payload.get("records", []))
        time.sleep(0.2)
    return created


def main() -> None:
    load_env()
    seed = json.loads(SEED_PATH.read_text())

    tables = [
        "Suppression List",
        "Replies",
        "Outreach",
        "Reports",
        "Clients",
        "Broker Prospects",
        "Scores",
        "Signals",
        "Companies",
    ]

    print("Clearing Airtable sample records...")
    for table in tables:
        ids = [record["id"] for record in list_records(table)]
        if ids:
            delete_records(table, ids)
        print(f"  {table}: deleted {len(ids)}")

    print("Seeding real FreightTrigger signal data...")
    company_records = []
    for item in seed:
        company_records.append(
            {
                "Company Name": item["company"],
                "Website": item["website"],
                "Vertical": item["vertical"],
                "Location": item["location"],
                "Status": "Qualified",
            }
        )
    created_companies = create_records("Companies", company_records)
    company_ids = {
        record["fields"]["Company Name"]: record["id"] for record in created_companies
    }

    signal_records = []
    score_records = []
    for item in seed:
        company_link = [company_ids[item["company"]]]
        signal_records.append(
            {
                "Trigger Summary": item["trigger_summary"],
                "Company": company_link,
                "Trigger Type": item["trigger_type"],
                "Evidence URL": item["evidence_url"],
                "Detected Date": "2026-06-03",
                "Status": "Qualified",
            }
        )
        score_records.append(
            {
                "Urgency Score": item["urgency_score"],
                "Confidence Score": item["confidence_score"],
                "Freight Relevance": item["freight_relevance"],
                "Notes": (
                    f"Likely need: {item['likely_freight_need']}\n"
                    f"Buyer path: {item['buyer_path']}\n"
                    f"Outreach angle: {item['outreach_angle']}"
                ),
                "Company": company_link,
            }
        )

    create_records("Signals", signal_records)
    create_records("Scores", score_records)
    create_records(
        "Reports",
        [
            {
                "Report Name": "FreightTrigger Sample Report - Food and Beverage",
                "Report Period": "2026-06-03",
                "Status": "Draft",
            }
        ],
    )

    print(f"Seeded {len(company_records)} companies, {len(signal_records)} signals, {len(score_records)} scores.")


if __name__ == "__main__":
    main()
