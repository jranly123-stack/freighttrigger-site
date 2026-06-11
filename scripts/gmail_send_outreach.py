#!/usr/bin/env python3
"""Send queued FreightTrigger outreach during safe business-hour windows."""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"
FROM_EMAIL = "signals@getfreighttrigger.com"
SEND_TZ = ZoneInfo("America/New_York")
MAX_SENDS_PER_RUN = 5
DEFAULT_DRY_RUN_LIMIT = 25
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


def env_value(*keys: str) -> str:
    for key in keys:
        value = os.environ.get(key)
        if value:
            return value
    return ""


def env_bool(*keys: str) -> bool:
    return env_value(*keys).strip().lower() == "true"


def max_sends_per_run() -> int:
    raw = env_value("OUTREACH_MAX_SENDS_PER_RUN", "OUTREACHMAXSENDSPERRUN")
    try:
        value = int(raw)
    except ValueError:
        value = MAX_SENDS_PER_RUN
    return max(1, min(10, value))


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


def refresh_access_token() -> str:
    payload = urllib.parse.urlencode(
        {
            "client_id": env_value("GOOGLE_CLIENT_ID", "GOOGLECLIENTID"),
            "client_secret": env_value("GOOGLE_CLIENT_SECRET", "GOOGLECLIENTSECRET"),
            "refresh_token": env_value("GMAIL_REFRESH_TOKEN", "GMAILREFRESHTOKEN"),
            "grant_type": "refresh_token",
        }
    ).encode()
    request = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=payload,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode())["access_token"]


def airtable_url(table: str, query: dict | None = None) -> str:
    raw_base = os.environ.get("AIRTABLE_BASE_ID") or os.environ.get("AIRTABLEBASEID", "")
    match = re.search(r"app[A-Za-z0-9]{14,}", raw_base)
    base = match.group(0) if match else raw_base.strip()
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


def in_send_window(now: datetime) -> bool:
    local = now.astimezone(SEND_TZ)
    if local.weekday() > 4:
        return False
    start = local.replace(hour=9, minute=0, second=0, microsecond=0)
    end = local.replace(hour=20, minute=0, second=0, microsecond=0)
    return start <= local <= end


def host(value: str) -> str:
    try:
        return urllib.parse.urlparse(value).netloc.lower().removeprefix("www.")
    except Exception:
        return ""


def email_host(value: str) -> str:
    return value.rsplit("@", 1)[1].lower().removeprefix("www.") if "@" in value else ""


def domains_match(email: str, website: str) -> bool:
    mail_host = email_host(email)
    site_host = host(website)
    if not mail_host or not site_host:
        return False
    return mail_host == site_host or mail_host.endswith("." + site_host) or site_host.endswith("." + mail_host)


def bad_source(fields: dict) -> bool:
    haystack = f"{fields.get('Website', '')}\n{fields.get('Research Notes', '')}".lower()
    return any(domain in haystack for domain in BAD_SOURCE_DOMAINS) or "ceo gate: rejected" in haystack


def contact_gate_reason(prospect_fields: dict, email: str, suppression: set[str]) -> str:
    if not email:
        return "missing contact email"
    if email in suppression:
        return "suppressed contact"
    if prospect_fields.get("Status") != "Qualified":
        return f"prospect status is {prospect_fields.get('Status') or 'blank'}"
    if bad_source(prospect_fields):
        return "bad or rejected source"
    if not domains_match(email, str(prospect_fields.get("Website", ""))):
        return "email domain does not match prospect website"
    return ""


def gmail_send(token: str, to_email: str, subject: str, body: str) -> dict:
    message = EmailMessage()
    message["To"] = to_email
    message["From"] = FROM_EMAIL
    message["Subject"] = subject
    message["Reply-To"] = FROM_EMAIL
    message.set_content(body)
    raw = base64.urlsafe_b64encode(message.as_bytes()).decode().rstrip("=")
    return http_json(
        "POST",
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        body={"raw": raw},
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force-window", action="store_true")
    parser.add_argument("--limit", type=int, default=DEFAULT_DRY_RUN_LIMIT)
    args = parser.parse_args()

    load_env()
    outreach_enabled = env_bool("OUTREACH_ENABLED", "OUTREACHENABLED")
    if not outreach_enabled and not args.dry_run:
        print("outreach disabled; set OUTREACHENABLED=true only after buyer-flow approval")
        return

    now = datetime.now(timezone.utc)
    if not args.force_window and not in_send_window(now):
        print("outside business-hour sending window; no email sent")
        return

    prospects = {record["id"]: record for record in list_records("Broker Prospects")}
    suppression = {
        str(record.get("fields", {}).get("Email", "")).strip().lower()
        for record in list_records("Suppression List")
    }
    queued = [
        record
        for record in list_records("Outreach")
        if record.get("fields", {}).get("Status") == "Queued"
    ]

    token = "" if args.dry_run else refresh_access_token()
    updates = []
    sent = 0
    skipped: dict[str, int] = {}
    for outreach in queued:
        fields = outreach["fields"]
        prospect_id = (fields.get("Prospect") or [None])[0]
        prospect = prospects.get(prospect_id or "")
        if not prospect:
            skipped["missing linked prospect"] = skipped.get("missing linked prospect", 0) + 1
            continue
        prospect_fields = prospect["fields"]
        to_email = str(prospect_fields.get("Contact Email", "")).strip().lower()
        gate_reason = contact_gate_reason(prospect_fields, to_email, suppression)
        if gate_reason:
            skipped[gate_reason] = skipped.get(gate_reason, 0) + 1
            continue
        subject = str(fields.get("Email Subject") or "Food/bev logistics opportunity queue")
        body = str(fields.get("Message") or "")
        if args.dry_run:
            company = str(prospect_fields.get("Company Name") or "Unknown company")
            print(f"dry-run eligible: {company} | {to_email} | {subject}")
        else:
            gmail_send(token, to_email, subject, body)
            print(f"sent: {to_email} | {subject}")
        updates.append(
            {
                "id": outreach["id"],
                "fields": {
                    "Status": "Scheduled" if args.dry_run else "Sent",
                    "Sent Date": now.isoformat().replace("+00:00", "Z"),
                },
            }
        )
        sent += 1
        max_records = args.limit if args.dry_run else max_sends_per_run()
        if sent >= max_records:
            break
    if updates and not args.dry_run:
        patch_records("Outreach", updates)
    elif updates:
        print("dry run only; Airtable not updated")
    print(f"outreach_enabled={str(outreach_enabled).lower()}")
    print(f"processed {sent} queued outreach records")
    if skipped:
        print("skip_reasons:")
        for reason, count in sorted(skipped.items()):
            print(f"- {reason}: {count}")


if __name__ == "__main__":
    main()
