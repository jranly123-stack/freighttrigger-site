#!/usr/bin/env python3
"""Import Clay CSV enrichment into Airtable buyer prospects.

This is the low-cost Clay path. It avoids paying for Clay webhook access before
revenue while still letting the engine use Clay-enriched emails, phones, and
source notes for outreach gating.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"
DEFAULT_CSV = ROOT / "exports" / "clay_enrichment.csv"
HTTP_TIMEOUT = 45

EMAIL_KEYS = (
    "email",
    "work email",
    "business email",
    "contact email",
    "person email",
    "verified email",
)
PHONE_KEYS = ("phone", "phone number", "company phone", "direct phone", "mobile phone")
COMPANY_KEYS = ("company", "company name", "account", "account name", "organization")
WEBSITE_KEYS = ("website", "company website", "domain", "company domain", "url")
SOURCE_KEYS = ("source", "source url", "linkedin", "linkedin url", "person linkedin", "company linkedin")


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


def http_json(method: str, url: str, headers: dict | None = None, body: dict | None = None) -> dict:
    data = None
    request_headers = headers or {}
    if body is not None:
        data = json.dumps(body).encode()
        request_headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, method=method, headers=request_headers)
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


def clean(value: object) -> str:
    return str(value or "").strip()


def normalized_headers(row: dict) -> dict[str, str]:
    return {str(key).strip().lower(): clean(value) for key, value in row.items()}


def first_value(row: dict[str, str], keys: tuple[str, ...]) -> str:
    for key in keys:
        value = row.get(key)
        if value:
            return value
    for key, value in row.items():
        if any(candidate in key for candidate in keys) and value:
            return value
    return ""


def domain(value: str) -> str:
    value = value.strip().lower()
    if not value:
        return ""
    if "://" not in value:
        value = "https://" + value
    parsed = urlparse(value)
    host = parsed.netloc or parsed.path
    host = host.split("/")[0].split(":")[0].removeprefix("www.")
    return host


def email_domain(email: str) -> str:
    if "@" not in email:
        return ""
    return email.rsplit("@", 1)[1].lower().removeprefix("www.")


def valid_email(email: str) -> bool:
    if not re.fullmatch(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", email):
        return False
    prefix = email.split("@", 1)[0].lower()
    return not prefix.startswith(("noreply", "no-reply", "donotreply", "abuse", "privacy", "legal"))


def domain_match(email: str, website: str) -> bool:
    mail_host = email_domain(email)
    site_host = domain(website)
    if not mail_host or not site_host:
        return False
    return mail_host == site_host or mail_host.endswith("." + site_host) or site_host.endswith("." + mail_host)


def normalize_company(value: str) -> str:
    text = re.sub(r"[^a-z0-9 ]+", " ", value.lower())
    text = re.sub(r"\b(inc|llc|ltd|co|company|corp|corporation|logistics|transportation)\b", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def build_indexes(prospects: list[dict]) -> tuple[dict[str, dict], dict[str, dict]]:
    by_domain: dict[str, dict] = {}
    by_company: dict[str, dict] = {}
    for prospect in prospects:
        fields = prospect.get("fields", {})
        site_domain = domain(str(fields.get("Website", "")))
        company_key = normalize_company(str(fields.get("Company Name", "")))
        if site_domain:
            by_domain[site_domain] = prospect
        if company_key:
            by_company[company_key] = prospect
    return by_domain, by_company


def find_match(row: dict[str, str], by_domain: dict[str, dict], by_company: dict[str, dict]) -> dict | None:
    site = first_value(row, WEBSITE_KEYS)
    company = first_value(row, COMPANY_KEYS)
    site_domain = domain(site)
    if site_domain and site_domain in by_domain:
        return by_domain[site_domain]
    company_key = normalize_company(company)
    if company_key and company_key in by_company:
        return by_company[company_key]
    if company_key:
        for key, prospect in by_company.items():
            if company_key in key or key in company_key:
                return prospect
    return None


def clay_note(row: dict[str, str], accepted_email: bool, accepted_phone: bool, reason: str) -> str:
    email = first_value(row, EMAIL_KEYS)
    phone = first_value(row, PHONE_KEYS)
    source = first_value(row, SOURCE_KEYS)
    company = first_value(row, COMPANY_KEYS)
    parts = [
        "Clay CSV enrichment:",
        f"company={company or 'not supplied'}",
        f"email_status={'accepted' if accepted_email else 'not accepted'}",
        f"phone_status={'captured' if accepted_phone else 'not supplied'}",
    ]
    if reason:
        parts.append(f"reason={reason}")
    if phone:
        parts.append(f"phone={phone}")
    if source:
        parts.append(f"source={source}")
    if email and not accepted_email:
        parts.append("email withheld from send gate")
    return " | ".join(parts)


def import_csv(path: Path, dry_run: bool) -> dict[str, int]:
    if not path.exists():
        raise FileNotFoundError(f"Clay CSV not found: {path}")
    prospects = list_records("Broker Prospects")
    by_domain, by_company = build_indexes(prospects)
    updates = []
    stats = {
        "rows": 0,
        "matched": 0,
        "email_accepted": 0,
        "phone_captured": 0,
        "updates": 0,
        "unmatched": 0,
    }

    with path.open(newline="") as handle:
        reader = csv.DictReader(handle)
        for raw_row in reader:
            stats["rows"] += 1
            row = normalized_headers(raw_row)
            prospect = find_match(row, by_domain, by_company)
            if not prospect:
                stats["unmatched"] += 1
                continue

            stats["matched"] += 1
            fields = prospect.get("fields", {})
            website = str(fields.get("Website", ""))
            email = first_value(row, EMAIL_KEYS).lower()
            phone = first_value(row, PHONE_KEYS)
            accepted_email = bool(email and valid_email(email) and domain_match(email, website))
            accepted_phone = bool(phone)
            reason = ""

            patch_fields = {}
            if accepted_email:
                patch_fields["Contact Email"] = email
                patch_fields["Status"] = "Qualified"
                stats["email_accepted"] += 1
            elif email:
                reason = "email domain did not match prospect website or failed format gate"
                if not fields.get("Contact Email"):
                    patch_fields["Status"] = "Needs Contact"

            if accepted_phone:
                stats["phone_captured"] += 1

            notes = str(fields.get("Research Notes", "")).strip()
            note = clay_note(row, accepted_email, accepted_phone, reason)
            patch_fields["Research Notes"] = f"{notes}\n{note}".strip()

            updates.append({"id": prospect["id"], "fields": patch_fields})

    stats["updates"] = len(updates)
    if updates and not dry_run:
        patch_records("Broker Prospects", updates)
    return stats


def main() -> None:
    parser = argparse.ArgumentParser(description="Import Clay enrichment CSV into Airtable.")
    parser.add_argument("--path", default=str(DEFAULT_CSV), help="Path to Clay CSV export.")
    parser.add_argument("--dry-run", action="store_true", help="Validate and summarize without writing Airtable.")
    args = parser.parse_args()

    load_env()
    stats = import_csv(Path(args.path), args.dry_run)
    mode = "dry_run" if args.dry_run else "written"
    print(f"clay_csv_import={mode}")
    for key, value in stats.items():
        print(f"{key}={value}")


if __name__ == "__main__":
    main()
