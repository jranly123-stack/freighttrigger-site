#!/usr/bin/env python3
"""Classify Gmail replies and update Airtable."""

from __future__ import annotations

import base64
import json
import os
import re
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from email.message import EmailMessage
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"
FROM_EMAIL = "signals@getfreighttrigger.com"
SAMPLE_URL = "https://getfreighttrigger.com/sample-feed"
CHECKOUT_URL = "https://buy.stripe.com/14A8wO6R4df565JbjYfAc00"
SEND_TZ = ZoneInfo("America/New_York")
MAX_AUTO_REPLIES = 3


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


def refresh_access_token() -> str:
    payload = urllib.parse.urlencode(
        {
            "client_id": os.environ["GOOGLE_CLIENT_ID"],
            "client_secret": os.environ["GOOGLE_CLIENT_SECRET"],
            "refresh_token": os.environ["GMAIL_REFRESH_TOKEN"],
            "grant_type": "refresh_token",
        }
    ).encode()
    req = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=payload,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.loads(response.read().decode())["access_token"]


def gmail(token: str, method: str, path: str, body: dict | None = None) -> dict:
    return http_json(
        method,
        f"https://gmail.googleapis.com/gmail/v1/users/me/{path}",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        body=body,
    )


def gmail_send(token: str, to_email: str, subject: str, body: str) -> dict:
    message = EmailMessage()
    message["To"] = to_email
    message["From"] = FROM_EMAIL
    message["Subject"] = subject
    message["Reply-To"] = FROM_EMAIL
    message.set_content(body)
    raw = base64.urlsafe_b64encode(message.as_bytes()).decode().rstrip("=")
    return gmail(token, "POST", "messages/send", {"raw": raw})


def decode_body(payload: dict) -> str:
    data = payload.get("body", {}).get("data")
    if data:
        return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4)).decode(errors="ignore")
    for part in payload.get("parts", []) or []:
        text = decode_body(part)
        if text:
            return text
    return ""


def classify(text: str) -> dict:
    response = http_json(
        "POST",
        "https://api.openai.com/v1/chat/completions",
        headers={"Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}"},
        body={
            "model": "gpt-4.1-mini",
            "temperature": 0.1,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": "Return only valid JSON."},
                {
                    "role": "user",
                    "content": (
                        "Classify this FreightTrigger email reply. Return JSON keys: intent, summary, next_action, suppress. "
                        "intent must be one of Interested, Not Interested, Needs Info, Follow-up, Unsubscribe. "
                        "suppress true if the sender asks not to be contacted.\n\n"
                        f"Reply:\n{text[:5000]}"
                    ),
                },
            ],
        },
    )
    return json.loads(response["choices"][0]["message"]["content"])


def airtable_url(table: str, query: dict | None = None) -> str:
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
        payload = http_json(
            "GET",
            airtable_url(table, query),
            headers={"Authorization": f"Bearer {os.environ['AIRTABLE_API_TOKEN']}"},
        )
        records.extend(payload.get("records", []))
        offset = payload.get("offset")
        if not offset:
            return records


def create_record(table: str, fields: dict) -> None:
    http_json(
        "POST",
        airtable_url(table),
        headers={"Authorization": f"Bearer {os.environ['AIRTABLE_API_TOKEN']}"},
        body={"typecast": True, "records": [{"fields": fields}]},
    )


def patch_records(table: str, records: list[dict]) -> None:
    if not records:
        return
    http_json(
        "PATCH",
        airtable_url(table),
        headers={"Authorization": f"Bearer {os.environ['AIRTABLE_API_TOKEN']}"},
        body={"typecast": True, "records": records},
    )


def sender_from(headers: list[dict]) -> str:
    for header in headers:
        if header.get("name", "").lower() == "from":
            value = header.get("value", "")
            if "<" in value and ">" in value:
                return value.split("<", 1)[1].split(">", 1)[0].lower()
            return value.lower()
    return ""


def in_business_window() -> bool:
    local = datetime.now(timezone.utc).astimezone(SEND_TZ)
    return local.weekday() <= 4 and 9 <= local.hour < 20


def sample_reply() -> str:
    return "\n".join(
        [
            "Here is the partial FreightTrigger preview:",
            "",
            SAMPLE_URL,
            "",
            "The preview shows the format. The paid beta queue includes current opportunity records with source context, contact route, scoring notes, and sales positioning.",
            "",
            "If you want the current queue now, beta checkout is here. Monday updates continue after that:",
            CHECKOUT_URL,
            "",
            "FreightTrigger provides sales intelligence only. We do not broker freight, arrange transportation, select carriers, handle loads, manage shipments, process contracts, store shipping documents, manage invoices, or move payments between shippers and carriers.",
        ]
    )


def prospect_by_email(prospects: list[dict], email: str) -> dict | None:
    for prospect in prospects:
        if str(prospect.get("fields", {}).get("Contact Email", "")).strip().lower() == email:
            return prospect
    return None


def update_prospect(prospect: dict | None, intent: str, summary: str) -> None:
    if not prospect:
        return
    status = (
        "Qualified"
        if intent in {"Interested", "Needs Info"}
        else "Suppressed"
        if intent == "Unsubscribe"
        else "Contacted"
        if intent == "Follow-up"
        else "Unresponsive"
    )
    notes = str(prospect.get("fields", {}).get("Research Notes", "")).strip()
    patch_records(
        "Broker Prospects",
        [
            {
                "id": prospect["id"],
                "fields": {
                    "Status": status,
                    "Research Notes": f"{notes}\n{datetime.now(timezone.utc).isoformat()} reply feedback: {summary}".strip(),
                },
            }
        ],
    )


def main() -> None:
    load_env()
    token = refresh_access_token()
    query = urllib.parse.urlencode(
        {
            "q": f"in:inbox newer_than:14d -from:{FROM_EMAIL}",
            "maxResults": 10,
        }
    )
    results = gmail(token, "GET", f"messages?{query}")
    existing = {
        str(record.get("fields", {}).get("Reply Summary", ""))
        for record in list_records("Replies")
    }
    prospects = list_records("Broker Prospects")
    processed = 0
    auto_replies = 0
    for item in results.get("messages", []) or []:
        message = gmail(token, "GET", f"messages/{item['id']}?format=full")
        headers = message.get("payload", {}).get("headers", [])
        sender = sender_from(headers)
        text = decode_body(message.get("payload", {}))
        if not sender or FROM_EMAIL in sender or not text:
            continue
        marker = f"[gmail:{item['id']}]"
        if any(marker in summary for summary in existing):
            continue
        result = classify(text)
        intent = result.get("intent", "Needs Info")
        prospect = prospect_by_email(prospects, sender)
        summary = f"{marker} {result.get('summary', text[:500])}"
        create_record(
            "Replies",
            {
                "Reply Summary": summary,
                "Prospect": [prospect["id"]] if prospect else [],
                "Intent": intent,
                "Next Action": result.get("next_action", "Review reply."),
            },
        )
        update_prospect(prospect, intent, summary)
        if result.get("suppress"):
            create_record(
                "Suppression List",
                {"Email": sender, "Reason": "Reply requested no further contact", "Date Added": str(date.today())},
            )
        if intent in {"Interested", "Needs Info"} and in_business_window() and auto_replies < MAX_AUTO_REPLIES:
            gmail_send(token, sender, "FreightTrigger sample opportunity queue", sample_reply())
            auto_replies += 1
        processed += 1
    print(f"classified {processed} recent inbox replies")
    print(f"auto-sent {auto_replies} sample/checkout replies")


if __name__ == "__main__":
    main()
