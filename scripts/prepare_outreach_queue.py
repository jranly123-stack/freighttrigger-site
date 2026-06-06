#!/usr/bin/env python3
"""Create compliant send-ready outreach drafts for enriched prospects."""

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
SAMPLE_URL = "https://getfreighttrigger.com/sample-feed.html"
STRIPE_URL = "https://buy.stripe.com/14A8wO6R4df565JbjYfAc00"
PUBLIC_SITE_URL = "https://getfreighttrigger.com"
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


def create_records(table: str, records: list[dict]) -> list[dict]:
    created = []
    for index in range(0, len(records), 10):
        payload = airtable(
            "POST",
            table,
            {"typecast": True, "records": [{"fields": record} for record in records[index : index + 10]]},
        )
        created.extend(payload.get("records", []))
        time.sleep(0.2)
    return created


def patch_records(table: str, records: list[dict]) -> list[dict]:
    updated = []
    for index in range(0, len(records), 10):
        payload = airtable(
            "PATCH",
            table,
            {"typecast": True, "records": records[index : index + 10]},
        )
        updated.extend(payload.get("records", []))
        time.sleep(0.2)
    return updated


def build_message(company: str) -> str:
    return (
        f"Hi {company} team,\n\n"
        "Quick note. I am testing FreightTrigger for logistics sales teams selling into food/bev and reefer-adjacent accounts.\n\n"
        "It is not another shipper list. Each week we send a short signal feed showing companies with current business movement, why the timing may matter, and the angle a rep can use.\n\n"
        "I put a partial preview here:\n"
        f"{SAMPLE_URL}\n\n"
        "The preview keeps the full source trail and contact path locked, but it shows the shape.\n\n"
        "Beta is $497/month if you want the current feed now and Monday updates after that:\n"
        f"{STRIPE_URL}\n\n"
        f"Website: {PUBLIC_SITE_URL}\n\n"
        "If this is not relevant, reply \"not a fit\" and I will not follow up.\n\n"
        "FreightTrigger\n"
        "signals@getfreighttrigger.com\n\n"
        "FreightTrigger provides sales intelligence only. We do not broker freight, arrange transportation, select carriers, handle loads, manage shipments, process contracts, store shipping documents, manage invoices, or move payments between shippers and carriers."
    )


def host(value: str) -> str:
    try:
        return urlparse(value).netloc.lower().removeprefix("www.")
    except Exception:
        return ""


def email_host(value: str) -> str:
    if "@" not in value:
        return ""
    return value.rsplit("@", 1)[1].lower().removeprefix("www.")


def same_domain(email: str, website: str) -> bool:
    mail_host = email_host(email)
    site_host = host(website)
    if not mail_host or not site_host:
        return False
    return mail_host == site_host or mail_host.endswith("." + site_host) or site_host.endswith("." + mail_host)


def bad_source(fields: dict) -> bool:
    website = str(fields.get("Website", "")).lower()
    notes = str(fields.get("Research Notes", "")).lower()
    haystack = f"{website}\n{notes}"
    return any(domain in haystack for domain in BAD_SOURCE_DOMAINS) or "ceo gate: rejected" in haystack


def main() -> None:
    load_env()
    prospects = list_records("Broker Prospects")
    existing_outreach = list_records("Outreach")
    prospects_by_id = {prospect["id"]: prospect for prospect in prospects}
    suppression = {
        str(record.get("fields", {}).get("Email", "")).strip().lower()
        for record in list_records("Suppression List")
    }
    prospects_with_outreach = {
        link
        for record in existing_outreach
        for link in record.get("fields", {}).get("Prospect", [])
        if record.get("fields", {}).get("Status") in {"Queued", "Sent", "Scheduled", "Rejected"}
    }
    drafts = []
    for prospect in prospects:
        fields = prospect.get("fields", {})
        email = str(fields.get("Contact Email") or "").strip().lower()
        if not email or prospect["id"] in prospects_with_outreach:
            continue
        if fields.get("Status") != "Qualified":
            continue
        if email in suppression:
            continue
        if bad_source(fields):
            continue
        if not same_domain(email, str(fields.get("Website", ""))):
            continue
        company = fields.get("Company Name", "your team")
        target = fields.get("Target Vertical", "food/bev + reefer")
        subject = "Food/bev shipper timing signals"
        message = build_message(str(company))
        drafts.append(
            {
                "Email Subject": subject,
                "Prospect": [prospect["id"]],
                "Message": message,
                "Status": "Queued",
                "AI Personalization Tips": f"Buyer appears relevant for {target}. Keep first touch concise and direct to sample feed.",
            }
        )
    created = create_records("Outreach", drafts)
    updates = []
    for record in existing_outreach:
        fields = record.get("fields", {})
        if fields.get("Status") not in {"Queued", "Needs Contact", "Scheduled"}:
            continue
        prospect_id = (fields.get("Prospect") or [""])[0]
        prospect = prospects_by_id.get(prospect_id)
        if not prospect:
            continue
        company = prospect.get("fields", {}).get("Company Name", "your team")
        updates.append(
            {
                "id": record["id"],
                "fields": {
                    "Email Subject": "Food/bev shipper timing signals",
                    "Message": build_message(str(company)),
                    "AI Personalization Tips": "Use the partial preview as the hook. Do not expose the full source trail before checkout.",
                },
            }
        )
    updated = patch_records("Outreach", updates)
    print(f"created {len(created)} send-ready outreach drafts")
    print(f"updated {len(updated)} existing unsent outreach drafts")


if __name__ == "__main__":
    main()
