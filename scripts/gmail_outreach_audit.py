#!/usr/bin/env python3
"""Read-only Gmail audit for FreightTrigger outreach and replies."""

from __future__ import annotations

import base64
import json
import os
import re
import urllib.parse
import urllib.request
from dataclasses import dataclass
from email.utils import parsedate_to_datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"
FROM_EMAIL = "signals@getfreighttrigger.com"
HTTP_TIMEOUT = 20
NOISE_DOMAINS = {
    "airtable.com",
    "clay.com",
    "dataforseo.com",
    "digitalocean.com",
    "firecrawl.dev",
    "github.com",
    "google.com",
    "login.gov",
    "namecheap.com",
    "openai.com",
    "sam.gov",
    "serpapi.com",
    "stripe.com",
    "vercel.com",
}


@dataclass
class Message:
    id: str
    email: str
    subject: str
    date: str
    snippet: str


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


def refresh_access_token() -> str:
    payload = urllib.parse.urlencode(
        {
            "client_id": env_value("GOOGLE_CLIENT_ID", "GOOGLECLIENTID"),
            "client_secret": env_value("GOOGLE_CLIENT_SECRET", "GOOGLECLIENTSECRET"),
            "refresh_token": env_value("GMAIL_REFRESH_TOKEN", "GMAILREFRESHTOKEN"),
            "grant_type": "refresh_token",
        }
    ).encode()
    return http_json(
        "POST",
        "https://oauth2.googleapis.com/token",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        body=None,
    ) if False else _token_request(payload)


def _token_request(payload: bytes) -> str:
    request = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=payload,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT) as response:
        return json.loads(response.read().decode())["access_token"]


def gmail(token: str, method: str, path: str) -> dict:
    return http_json(
        method,
        f"https://gmail.googleapis.com/gmail/v1/users/me/{path}",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )


def header(message: dict, name: str) -> str:
    for item in message.get("payload", {}).get("headers", []) or []:
        if item.get("name", "").lower() == name.lower():
            return item.get("value", "")
    return ""


def email_from(value: str) -> str:
    match = re.search(r"<([^>]+)>", value)
    raw = match.group(1) if match else value
    match = re.search(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", raw, re.I)
    return match.group(0).lower() if match else ""


def extract_recipients(value: str) -> list[str]:
    return [match.group(0).lower() for match in re.finditer(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", value, re.I)]


def domain(email: str) -> str:
    return email.rsplit("@", 1)[1].lower() if "@" in email else ""


def is_noise_email(email: str) -> bool:
    host = domain(email)
    local = email.split("@", 1)[0].lower() if "@" in email else email.lower()
    return (
        local in {"noreply", "no-reply", "donotreply", "do-not-reply"}
        or local.startswith("no-reply")
        or local.startswith("noreply")
        or any(host == item or host.endswith("." + item) for item in NOISE_DOMAINS)
    )


def list_messages(token: str, query: str, max_results: int = 50) -> list[dict]:
    params = urllib.parse.urlencode({"q": query, "maxResults": max_results})
    data = gmail(token, "GET", f"messages?{params}")
    return data.get("messages", []) or []


def get_message(token: str, message_id: str) -> dict:
    return gmail(token, "GET", f"messages/{message_id}?format=full")


def message_date(value: str) -> str:
    try:
        return parsedate_to_datetime(value).isoformat()
    except Exception:
        return value


def sent_outreach(token: str) -> list[Message]:
    refs = list_messages(token, 'in:sent newer_than:30d ("Food/bev shipper timing signals" OR "Food/bev freight demand signals" OR "FreightTrigger")', 50)
    messages: list[Message] = []
    for ref in refs:
        message = get_message(token, ref["id"])
        subject = header(message, "Subject")
        haystack = f"{subject} {message.get('snippet', '')}".lower()
        if (
            "freighttrigger" not in haystack
            and "shipper timing" not in subject.lower()
            and "freight demand" not in subject.lower()
        ):
            continue
        for to in extract_recipients(header(message, "To")):
            if to == FROM_EMAIL or is_noise_email(to):
                continue
            messages.append(
                Message(
                    id=ref["id"],
                    email=to,
                    subject=subject,
                    date=message_date(header(message, "Date")),
                    snippet=message.get("snippet", ""),
                )
            )
    return messages


def inbound_replies(token: str, sent_emails: set[str]) -> list[Message]:
    replies: list[Message] = []
    seen_ids: set[str] = set()
    for email in sorted(sent_emails):
        refs = list_messages(token, f'in:inbox newer_than:30d from:{email}', 10)
        for ref in refs:
            if ref["id"] in seen_ids:
                continue
            seen_ids.add(ref["id"])
            message = get_message(token, ref["id"])
            sender = email_from(header(message, "From"))
            if not sender or sender not in sent_emails or is_noise_email(sender):
                continue
            replies.append(
                Message(
                    id=ref["id"],
                    email=sender,
                    subject=header(message, "Subject"),
                    date=message_date(header(message, "Date")),
                    snippet=message.get("snippet", ""),
                )
            )
    return replies


def main() -> None:
    load_env()
    token = refresh_access_token()
    sent = sent_outreach(token)
    unique_sent = sorted({message.email for message in sent})
    replies = inbound_replies(token, set(unique_sent))

    print("FreightTrigger Gmail Outreach Audit")
    print(f"sent_outreach_messages={len(sent)}")
    print(f"unique_business_recipients={len(unique_sent)}")
    print(f"matched_business_replies={len(replies)}")
    print()
    print("Recipients")
    for email in unique_sent:
        print(f"- {email}")
    print()
    print("Matched Replies")
    if not replies:
        print("- none")
    for reply in replies:
        print(f"- {reply.email} | {reply.date} | {reply.subject} | {reply.snippet[:140]}")


if __name__ == "__main__":
    main()
