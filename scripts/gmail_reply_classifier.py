#!/usr/bin/env python3
"""Classify Gmail replies and update Airtable."""

from __future__ import annotations

import base64
import json
import os
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"
FROM_EMAIL = "signals@getfreighttrigger.com"


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


def airtable_url(table: str) -> str:
    return f"https://api.airtable.com/v0/{os.environ['AIRTABLE_BASE_ID']}/{urllib.parse.quote(table)}"


def create_record(table: str, fields: dict) -> None:
    http_json(
        "POST",
        airtable_url(table),
        headers={"Authorization": f"Bearer {os.environ['AIRTABLE_API_TOKEN']}"},
        body={"typecast": True, "records": [{"fields": fields}]},
    )


def sender_from(headers: list[dict]) -> str:
    for header in headers:
        if header.get("name", "").lower() == "from":
            value = header.get("value", "")
            if "<" in value and ">" in value:
                return value.split("<", 1)[1].split(">", 1)[0].lower()
            return value.lower()
    return ""


def main() -> None:
    load_env()
    token = refresh_access_token()
    results = gmail(token, "GET", "messages?q=in:inbox newer_than:14d -from:signals@getfreighttrigger.com&maxResults=10")
    processed = 0
    for item in results.get("messages", []) or []:
        message = gmail(token, "GET", f"messages/{item['id']}?format=full")
        headers = message.get("payload", {}).get("headers", [])
        sender = sender_from(headers)
        text = decode_body(message.get("payload", {}))
        if not sender or FROM_EMAIL in sender or not text:
            continue
        result = classify(text)
        create_record(
            "Replies",
            {
                "Reply Summary": result.get("summary", text[:500]),
                "Intent": result.get("intent", "Needs Info"),
                "Next Action": result.get("next_action", "Review reply."),
            },
        )
        if result.get("suppress"):
            create_record(
                "Suppression List",
                {"Email": sender, "Reason": "Reply requested no further contact", "Date Added": str(date.today())},
            )
        processed += 1
    print(f"classified {processed} recent inbox replies")


if __name__ == "__main__":
    main()
