#!/usr/bin/env python3
"""Audit FreightTrigger Airtable replies for vendor noise and duplicates.

Default mode is read-only. Use --mark-noise to tag obvious non-buyer replies
without deleting records.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"
HTTP_TIMEOUT = 30

NOISE_DOMAINS = {
    "airtable.com",
    "clay.com",
    "dataforseo.com",
    "digitalocean.com",
    "firecrawl.dev",
    "github.com",
    "google.com",
    "googleworkspace.com",
    "namecheap.com",
    "openai.com",
    "stripe.com",
    "vercel.com",
}

NOISE_TEXT = re.compile(
    r"(verify your account|billing|invoice|security alert|new sign-in|workspace|api key|"
    r"onboarding|trial|receipt|password reset|domain|deployment|subscription|"
    r"welcome to|confirm your|payment|login code)",
    re.I,
)


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


def airtable_request(method: str, table: str, payload: dict | None = None, query: dict | None = None) -> dict:
    base = env_value("AIRTABLE_BASE_ID", "AIRTABLEBASEID")
    token = env_value("AIRTABLE_API_TOKEN", "AIRTABLEAPITOKEN")
    missing = []
    if not base:
        missing.append("AIRTABLE_BASE_ID/AIRTABLEBASEID")
    if not token:
        missing.append("AIRTABLE_API_TOKEN/AIRTABLEAPITOKEN")
    if missing:
        raise RuntimeError(f"missing env: {', '.join(missing)}")

    data = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(
        airtable_url(table, query),
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT) as response:
        raw = response.read().decode()
        return json.loads(raw) if raw else {}


def list_records(table: str) -> list[dict]:
    records: list[dict] = []
    offset = None
    while True:
        query = {"pageSize": 100}
        if offset:
            query["offset"] = offset
        payload = airtable_request("GET", table, query=query)
        records.extend(payload.get("records", []))
        offset = payload.get("offset")
        if not offset:
            return records


def patch_records(table: str, records: list[dict]) -> None:
    for index in range(0, len(records), 10):
        batch = records[index : index + 10]
        airtable_request("PATCH", table, {"typecast": True, "records": batch})


def normalize_email(value: object) -> str:
    return str(value or "").strip().lower()


def extract_email(text: str) -> str:
    match = re.search(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", text, re.I)
    return normalize_email(match.group(0)) if match else ""


def email_domain(email: str) -> str:
    return email.rsplit("@", 1)[1].lower() if "@" in email else ""


def is_noise_domain(email: str) -> bool:
    host = email_domain(email)
    return any(host == domain or host.endswith("." + domain) for domain in NOISE_DOMAINS)


def linked_prospect_email(reply: dict, prospect_email_by_id: dict[str, str]) -> str:
    links = reply.get("fields", {}).get("Prospect")
    if isinstance(links, list) and links:
        return prospect_email_by_id.get(str(links[0]), "")
    return ""


def gmail_id(summary: str) -> str:
    match = re.search(r"\[gmail:([^\]]+)\]", summary)
    return match.group(1) if match else ""


def signature(reply: dict, email: str) -> str:
    fields = reply.get("fields", {})
    summary = re.sub(r"\s+", " ", str(fields.get("Reply Summary", ""))).strip().lower()
    summary = re.sub(r"\[noise-filter:[^\]]+\]", "", summary)
    summary = re.sub(r"\[conversion-response:[^\]]+\]", "", summary)
    return "|".join([email, str(fields.get("Intent", "")), summary[:180]])


def classify_reply(reply: dict, prospect_email_by_id: dict[str, str], prospect_emails: set[str]) -> tuple[str, str]:
    fields = reply.get("fields", {})
    summary = str(fields.get("Reply Summary", ""))
    email = linked_prospect_email(reply, prospect_email_by_id) or extract_email(summary)
    if "[noise-filter:" in summary:
        return "already_marked_noise", email
    if email and is_noise_domain(email):
        return "vendor_tool_noise", email
    if NOISE_TEXT.search(summary) and (not email or email not in prospect_emails):
        return "vendor_tool_noise", email
    if not email:
        return "missing_email", email
    if email not in prospect_emails:
        return "unlinked_non_prospect", email
    return "linked_buyer_reply", email


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mark-noise", action="store_true", help="Patch obvious noise rows; does not delete records.")
    args = parser.parse_args()

    load_env()
    prospects = list_records("Broker Prospects")
    replies = list_records("Replies")

    prospect_email_by_id = {
        record["id"]: normalize_email(record.get("fields", {}).get("Contact Email"))
        for record in prospects
        if normalize_email(record.get("fields", {}).get("Contact Email"))
    }
    prospect_emails = set(prospect_email_by_id.values())

    categories: Counter[str] = Counter()
    by_email: Counter[str] = Counter()
    duplicate_keys: defaultdict[str, list[str]] = defaultdict(list)
    rows: list[tuple[dict, str, str]] = []

    for reply in replies:
        category, email = classify_reply(reply, prospect_email_by_id, prospect_emails)
        categories[category] += 1
        if email:
            by_email[email] += 1
        key = gmail_id(str(reply.get("fields", {}).get("Reply Summary", ""))) or signature(reply, email)
        duplicate_keys[key].append(reply["id"])
        rows.append((reply, category, email))

    duplicates = {key: ids for key, ids in duplicate_keys.items() if key and len(ids) > 1}

    print("FreightTrigger Reply Noise Audit")
    print(f"total_replies={len(replies)}")
    for category, count in sorted(categories.items(), key=lambda item: (-item[1], item[0])):
        print(f"{category}={count}")
    print(f"duplicate_groups={len(duplicates)}")
    print()

    print("Likely Real Buyer Replies")
    real_rows = [(reply, email) for reply, category, email in rows if category == "linked_buyer_reply"]
    if not real_rows:
        print("- none")
    for reply, email in real_rows[:25]:
        fields = reply.get("fields", {})
        print(f"- {email} | {fields.get('Intent', '')} | {str(fields.get('Reply Summary', ''))[:160]}")

    print()
    print("Noise / Unlinked Examples")
    examples = [(reply, category, email) for reply, category, email in rows if category != "linked_buyer_reply"]
    if not examples:
        print("- none")
    for reply, category, email in examples[:20]:
        fields = reply.get("fields", {})
        print(f"- {category} | {email or 'no-email'} | {fields.get('Intent', '')} | {str(fields.get('Reply Summary', ''))[:140]}")

    if args.mark_noise:
        patches = []
        for reply, category, email in rows:
            if category not in {"vendor_tool_noise", "unlinked_non_prospect", "missing_email"}:
                continue
            fields = reply.get("fields", {})
            summary = str(fields.get("Reply Summary", ""))
            if "[noise-filter:" in summary:
                continue
            patches.append(
                {
                    "id": reply["id"],
                    "fields": {
                        "Intent": "Bad Fit",
                        "Next Action": f"Noise excluded from conversion learning: {category}.",
                        "Reply Summary": f"{summary}\n[noise-filter:{category}]",
                    },
                }
            )
        patch_records("Replies", patches)
        print()
        print(f"marked_noise={len(patches)}")


if __name__ == "__main__":
    main()
