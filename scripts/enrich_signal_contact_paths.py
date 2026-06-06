#!/usr/bin/env python3
"""Enrich shipper signal records with public contact paths.

This does not invent direct contacts. It appends public contact pages, visible
emails, visible phone numbers, and search paths into Score notes for weekly
client reports.
"""

from __future__ import annotations

import json
import os
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path
from urllib.parse import urljoin

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"
CONTACT_PATHS = ["", "/contact", "/contact-us", "/locations", "/about", "/about-us"]
BAD_EMAIL_PREFIXES = (
    "noreply",
    "no-reply",
    "donotreply",
    "privacy",
    "legal",
    "abuse",
    "security",
    "careers",
    "jobs",
    "press",
    "pr",
    "support",
    "billing",
    "accounts",
)
GOOD_EMAIL_PREFIXES = ("info", "contact", "sales", "transportation", "logistics", "shipping", "ops", "operations")


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


def scrape(url: str) -> str:
    try:
        payload = http_json(
            "POST",
            "https://api.firecrawl.dev/v1/scrape",
            headers={
                "Authorization": f"Bearer {os.environ['FIRECRAWL_API_KEY']}",
                "Content-Type": "application/json",
            },
            body={"url": url, "formats": ["markdown"]},
        )
        data = payload.get("data") or {}
        return (data.get("markdown") or data.get("content") or "")[:10000]
    except Exception:
        return ""


def site_domain(url: str) -> str:
    try:
        return urllib.parse.urlparse(url).netloc.lower().removeprefix("www.")
    except Exception:
        return ""


def clean_emails(text: str, domain: str) -> list[str]:
    found = set(re.findall(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", text))
    scored: list[tuple[int, str]] = []
    for raw in found:
        email = raw.strip(".,;:()[]{}<>").lower()
        if "@" not in email:
            continue
        prefix, email_domain = email.split("@", 1)
        if any(prefix.startswith(bad) for bad in BAD_EMAIL_PREFIXES):
            continue
        score = 0
        if domain and email_domain == domain:
            score += 30
        if any(good in prefix for good in GOOD_EMAIL_PREFIXES):
            score += 15
        if score <= 0:
            continue
        scored.append((score, email))
    return [email for _, email in sorted(scored, reverse=True)[:4]]


def clean_phones(text: str) -> list[str]:
    candidates = re.findall(r"(?:\+1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}", text)
    cleaned = []
    for raw in candidates:
        digits = re.sub(r"\D", "", raw)
        if len(digits) == 11 and digits.startswith("1"):
            digits = digits[1:]
        if len(digits) != 10:
            continue
        if digits.startswith(("000", "111", "123", "555")):
            continue
        phone = f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"
        cleaned.append(phone)
    return list(dict.fromkeys(cleaned))[:4]


def note_value(notes: str, label: str) -> str:
    match = re.search(rf"{re.escape(label)}:\s*([^\n]+)", notes, re.I)
    return match.group(1).strip() if match else ""


def main() -> None:
    load_env()
    companies = list_records("Companies")
    scores = list_records("Scores")
    companies_by_id = {record["id"]: record for record in companies}
    updates = []

    for score in scores:
        fields = score.get("fields", {})
        notes = str(fields.get("Notes", ""))
        if "Contact path:" in notes:
            continue
        company_id = (fields.get("Company") or [None])[0]
        company = companies_by_id.get(company_id)
        if not company:
            continue
        company_fields = company.get("fields", {})
        name = str(company_fields.get("Company Name", "Unknown account"))
        website = str(company_fields.get("Website", "")).strip()
        if not website:
            continue

        domain = site_domain(website)
        chosen_url = website
        combined = ""
        for path in CONTACT_PATHS:
            url = urljoin(website.rstrip("/") + "/", path.lstrip("/"))
            text = scrape(url)
            if len(text) > len(combined):
                combined = text
                chosen_url = url
            emails = clean_emails(text, domain)
            phones = clean_phones(text)
            if emails or phones:
                combined = text
                chosen_url = url
                break

        emails = clean_emails(combined, domain)
        phones = clean_phones(combined)
        buyer_path = note_value(notes, "Buyer path") or "logistics, transportation, operations, supply chain, or facility leadership"
        search = f"https://www.google.com/search?q={urllib.parse.quote(name + ' logistics manager transportation manager operations director')}"

        contact_path = " | ".join(
            [
                f"Primary roles: {buyer_path}",
                f"Public route: {chosen_url}",
                f"Emails: {', '.join(emails) if emails else 'not publicly verified'}",
                f"Phones: {', '.join(phones) if phones else 'not publicly verified'}",
                f"Search path: {search}",
            ]
        )
        updates.append(
            {
                "id": score["id"],
                "fields": {
                    "Notes": notes.rstrip() + f"\nContact path: {contact_path}",
                },
            }
        )
        print(f"contact path: {name} | emails={len(emails)} phones={len(phones)}")

    patch_records("Scores", updates)
    print(f"updated {len(updates)} score contact paths")


if __name__ == "__main__":
    main()
