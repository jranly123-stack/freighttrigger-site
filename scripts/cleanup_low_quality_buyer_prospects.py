#!/usr/bin/env python3
"""Reject buyer prospects sourced from low-quality directory/media pages."""

from __future__ import annotations

import json
import os
import time
import urllib.parse
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"
BAD_SOURCE_DOMAINS = (
    "foodlogistics.com",
    "usda.gov",
    "carriersource.io",
    "nfraweb.org",
    "pdfcoffee.com",
    "scribd.com",
)


def load_env() -> None:
    for raw in ENV_PATH.read_text().splitlines():
        line = raw.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key, value)


def http_json(method: str, url: str, headers: dict | None = None, body: dict | None = None) -> dict:
    data = None
    request_headers = headers or {}
    if body is not None:
        data = json.dumps(body).encode()
        request_headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, method=method, headers=request_headers)
    with urllib.request.urlopen(request, timeout=45) as response:
        raw = response.read().decode()
        return json.loads(raw) if raw else {}


def airtable_url(table: str, query: dict | None = None) -> str:
    url = f"https://api.airtable.com/v0/{os.environ['AIRTABLE_BASE_ID']}/{urllib.parse.quote(table)}"
    if query:
        url += "?" + urllib.parse.urlencode(query, doseq=True)
    return url


def airtable(method: str, table: str, body: dict | None = None, query: dict | None = None) -> dict:
    return http_json(
        method,
        airtable_url(table, query),
        headers={
            "Authorization": f"Bearer {os.environ['AIRTABLE_API_TOKEN']}",
            "Content-Type": "application/json",
        },
        body=body,
    )


def list_records(table: str) -> list[dict]:
    records: list[dict] = []
    offset = None
    while True:
        query = {"pageSize": 100}
        if offset:
            query["offset"] = offset
        payload = airtable("GET", table, query=query)
        records.extend(payload.get("records", []))
        offset = payload.get("offset")
        if not offset:
            return records


def patch_records(table: str, records: list[dict]) -> None:
    for index in range(0, len(records), 10):
        airtable("PATCH", table, {"typecast": True, "records": records[index : index + 10]})
        time.sleep(0.2)


def domain(url: str) -> str:
    return urlparse(url).netloc.lower().removeprefix("www.")


def is_bad(record: dict) -> bool:
    fields = record.get("fields", {})
    website = str(fields.get("Website", ""))
    notes = str(fields.get("Research Notes", ""))
    haystack = f"{domain(website)}\n{notes}".lower()
    return any(bad in haystack for bad in BAD_SOURCE_DOMAINS)


def email_domain(email: str) -> str:
    if "@" not in email:
        return ""
    return email.rsplit("@", 1)[1].lower().removeprefix("www.")


def mismatched_email(record: dict) -> bool:
    fields = record.get("fields", {})
    email = str(fields.get("Contact Email", "")).strip().lower()
    website = str(fields.get("Website", ""))
    if not email:
        return False
    mail_host = email_domain(email)
    site_host = domain(website)
    if not mail_host or not site_host:
        return True
    return not (mail_host == site_host or mail_host.endswith("." + site_host) or site_host.endswith("." + mail_host))


def main() -> None:
    load_env()
    prospects = list_records("Broker Prospects")
    outreach = list_records("Outreach")
    bad_reasons = {}
    for record in prospects:
        reasons = []
        if is_bad(record):
            reasons.append("source was a directory/media/government page, not a verified company-owned buyer page")
        if mismatched_email(record):
            reasons.append("contact email domain did not match the company website domain")
        if reasons:
            bad_reasons[record["id"]] = "; ".join(reasons)
    bad_ids = set(bad_reasons)

    prospect_updates = []
    for record in prospects:
        if record["id"] not in bad_ids:
            continue
        fields = record.get("fields", {})
        prospect_updates.append(
            {
                "id": record["id"],
                "fields": {
                    "Status": "Rejected",
                    "Research Notes": (
                        f"{fields.get('Research Notes', '')}\n"
                        f"CEO gate: rejected because {bad_reasons[record['id']]}."
                    ),
                },
            }
        )

    outreach_updates = []
    for record in outreach:
        prospect_id = (record.get("fields", {}).get("Prospect") or [None])[0]
        if prospect_id in bad_ids and record.get("fields", {}).get("Status") != "Sent":
            outreach_updates.append({"id": record["id"], "fields": {"Status": "Rejected"}})

    patch_records("Broker Prospects", prospect_updates)
    patch_records("Outreach", outreach_updates)
    print(f"rejected {len(prospect_updates)} low-quality prospects")
    print(f"rejected {len(outreach_updates)} linked outreach records")


if __name__ == "__main__":
    main()
