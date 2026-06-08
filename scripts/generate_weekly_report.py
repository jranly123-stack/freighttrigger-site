#!/usr/bin/env python3
"""Generate a client-ready weekly FreightTrigger report from Airtable signals."""

from __future__ import annotations

import json
import os
import re
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"
REPORT_DIR = ROOT / "reports" / "weekly"


def load_env() -> None:
    for raw in ENV_PATH.read_text().splitlines():
        line = raw.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key, value)


def http_json(url: str) -> dict:
    request = urllib.request.Request(url, headers={"Authorization": f"Bearer {os.environ['AIRTABLE_API_TOKEN']}"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode())


def list_records(table: str) -> list[dict]:
    records = []
    offset = None
    while True:
        query = {"pageSize": 100}
        if offset:
            query["offset"] = offset
        raw_base = os.environ.get("AIRTABLE_BASE_ID") or os.environ.get("AIRTABLEBASEID", "")
        match = re.search(r"app[A-Za-z0-9]{14,}", raw_base)
        base = match.group(0) if match else raw_base.strip()
        url = f"https://api.airtable.com/v0/{base}/{urllib.parse.quote(table)}?" + urllib.parse.urlencode(query)
        payload = http_json(url)
        records.extend(payload.get("records", []))
        offset = payload.get("offset")
        if not offset:
            return records


def main() -> None:
    load_env()
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    companies = {record["id"]: record for record in list_records("Companies")}
    scores_by_company = {}
    for score in list_records("Scores"):
        links = score.get("fields", {}).get("Company", [])
        if links:
            scores_by_company[links[0]] = score
    rows = []
    for signal in list_records("Signals"):
        fields = signal.get("fields", {})
        company_id = (fields.get("Company") or [None])[0]
        company = companies.get(company_id or "", {}).get("fields", {})
        score = scores_by_company.get(company_id or "", {}).get("fields", {})
        rows.append(
            {
                "company": company.get("Company Name", "Unknown"),
                "vertical": company.get("Vertical", ""),
                "location": company.get("Location", ""),
                "trigger": fields.get("Trigger Summary", ""),
                "evidence": fields.get("Evidence URL", ""),
                "urgency": score.get("Urgency Score", 0),
                "confidence": score.get("Confidence Score", 0),
                "notes": score.get("Notes", ""),
            }
        )
    rows.sort(key=lambda row: int(row.get("urgency") or 0), reverse=True)
    today = date.today().isoformat()
    path = REPORT_DIR / f"freighttrigger-weekly-feed-{today}.md"
    lines = [
        f"# FreightTrigger Weekly Signal Feed - {today}",
        "",
        "Coverage: Food/bev + reefer-adjacent shipper signals",
        "",
        "FreightTrigger provides sales intelligence only. This report does not claim verified buyer intent.",
        "",
    ]
    for index, row in enumerate(rows[:25], 1):
        lines.extend(
            [
                f"## {index}. {row['company']}",
                "",
                f"Vertical: {row['vertical']}",
                f"Location: {row['location']}",
                f"Urgency: {row['urgency']}/100",
                f"Confidence: {row['confidence']}/100",
                "",
                f"Trigger: {row['trigger']}",
                "",
                f"Evidence: {row['evidence']}",
                "",
                "Signal notes:",
                "",
                str(row["notes"]),
                "",
                "---",
                "",
            ]
        )
    path.write_text("\n".join(lines))
    print(path)


if __name__ == "__main__":
    main()
