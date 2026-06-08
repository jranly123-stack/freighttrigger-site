#!/usr/bin/env python3
"""Enrich queued buyer prospects with public contact emails."""

from __future__ import annotations

import json
import os
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path
from urllib.parse import urljoin, urlparse

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"
HTTP_TIMEOUT = 18
MAX_PROSPECTS_PER_RUN = 18
MAX_SEARCH_RESULTS = 4
CONTACT_PATHS = [
    "",
    "/contact",
    "/contact-us",
    "/contactus",
    "/request-a-quote",
    "/quote",
    "/get-a-quote",
    "/about",
    "/about-us",
    "/team",
    "/sales",
    "/locations",
]
BAD_PREFIXES = (
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
    "safety",
    "billing",
    "accounting",
)
GOOD_PREFIXES = ("sales", "info", "contact", "hello", "team", "business", "shipping", "logistics")
BAD_DOMAINS = ("zohoforms.com", "sentry.io", "example.com")
EMAIL_SEARCH_PREFIXES = (
    "sales",
    "info",
    "contact",
    "hello",
    "team",
    "business",
    "logistics",
    "shipping",
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
    with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT) as response:
        raw = response.read().decode()
        return json.loads(raw) if raw else {}


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
        return data.get("markdown") or data.get("content") or ""
    except Exception:
        return ""


def serp_search(query: str) -> list[dict]:
    try:
        params = urllib.parse.urlencode(
            {
                "engine": "google",
                "q": query,
                "api_key": os.environ["SERPAPI_API_KEY"],
                "num": MAX_SEARCH_RESULTS,
            }
        )
        return http_json("GET", f"https://serpapi.com/search.json?{params}").get("organic_results", [])[:MAX_SEARCH_RESULTS]
    except Exception:
        return []


def domain(url: str) -> str:
    return urlparse(url).netloc.lower().removeprefix("www.")


def emails_from(text: str, site_domain: str) -> list[str]:
    candidates = set(re.findall(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", text))
    scored: list[tuple[int, str]] = []
    for email in candidates:
        email = email.strip(".,;:()[]{}<>").lower()
        prefix, email_domain = email.split("@", 1)
        if any(prefix.startswith(bad) for bad in BAD_PREFIXES):
            continue
        if any(email_domain.endswith(domain) for domain in BAD_DOMAINS):
            continue
        if not any(prefix == good or good in prefix for good in GOOD_PREFIXES):
            continue
        score = 0
        if email_domain == site_domain:
            score += 30
        if prefix in GOOD_PREFIXES:
            score += 20
        if "sales" in prefix or "logistics" in prefix:
            score += 10
        scored.append((score, email))
    return [email for _, email in sorted(scored, reverse=True)[:3]]


def query_contact_sources(company: str, website: str, site_domain: str) -> tuple[list[str], list[str], str]:
    queries = [
        f'site:{site_domain} "@{site_domain}" contact',
        f'site:{site_domain} ("sales@{site_domain}" OR "info@{site_domain}" OR "contact@{site_domain}" OR "logistics@{site_domain}")',
        f'"{company}" "@{site_domain}"',
    ]
    emails: list[str] = []
    phones: list[str] = []
    source_url = website
    seen_urls: set[str] = set()

    for query in queries:
        for result in serp_search(query):
            url = str(result.get("link") or "")
            if not url or url in seen_urls:
                continue
            seen_urls.add(url)
            snippet = "\n".join(
                str(result.get(key) or "")
                for key in ("title", "snippet", "displayed_link")
            )
            emails.extend(emails_from(snippet, site_domain))
            phones.extend(phones_from(snippet))
            if emails or phones:
                source_url = url
                return list(dict.fromkeys(emails)), list(dict.fromkeys(phones)), source_url
            if domain(url) == site_domain:
                text = scrape(url)
                emails.extend(emails_from(text, site_domain))
                phones.extend(phones_from(text))
                if emails or phones:
                    source_url = url
                    return list(dict.fromkeys(emails)), list(dict.fromkeys(phones)), source_url
    return list(dict.fromkeys(emails)), list(dict.fromkeys(phones)), source_url


def phones_from(text: str) -> list[str]:
    pattern = re.compile(r"(?:\+1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}")
    cleaned = []
    for match in pattern.finditer(text):
        raw = match.group(0)
        context = text[max(0, match.start() - 45) : match.end() + 45].lower()
        if not any(token in context for token in ("phone", "tel", "call", "contact", "office", "main", "customer", "service")):
            continue
        digits = re.sub(r"\D", "", raw)
        if len(digits) == 11 and digits.startswith("1"):
            digits = digits[1:]
        if len(digits) != 10:
            continue
        if digits[0] in "01" or digits[3] in "01":
            continue
        if digits.startswith(("000", "111", "123", "555")):
            continue
        cleaned.append(f"({digits[:3]}) {digits[3:6]}-{digits[6:]}")
    return list(dict.fromkeys(cleaned))[:4]


def main() -> None:
    load_env()
    prospects = list_records("Broker Prospects")
    updates = []
    checked = 0
    for prospect in prospects:
        fields = prospect.get("fields", {})
        if fields.get("Contact Email"):
            continue
        website = fields.get("Website")
        if not website:
            continue
        checked += 1
        if checked > MAX_PROSPECTS_PER_RUN:
            break
        print(f"checking contact routes: {fields.get('Company Name')}")
        site_domain = domain(str(website))
        found: list[str] = []
        phones: list[str] = []
        contact_url = str(website)
        for path in CONTACT_PATHS:
            url = urljoin(str(website).rstrip("/") + "/", path.lstrip("/"))
            text = scrape(url)
            found.extend(emails_from(text, site_domain))
            phones.extend(phones_from(text))
            if found or phones:
                contact_url = url
                break
        if not found:
            search_emails, search_phones, search_url = query_contact_sources(
                str(fields.get("Company Name") or ""),
                str(website),
                site_domain,
            )
            found.extend(search_emails)
            phones.extend(search_phones)
            if search_emails or search_phones:
                contact_url = search_url
        found = list(dict.fromkeys(found))
        phones = list(dict.fromkeys(phones))[:4]
        if not found and not phones:
            print(f"needs manual contact path: {fields.get('Company Name')}")
            continue
        updates.append(
            {
                "id": prospect["id"],
                "fields": {
                    "Contact Email": found[0] if found else fields.get("Contact Email", ""),
                    "Status": "Qualified",
                    "Research Notes": (
                        f"{fields.get('Research Notes', '')}\n"
                        f"Contact enrichment route: {contact_url}\n"
                        f"Public emails: {', '.join(found) if found else 'not publicly verified'}\n"
                        f"Public phones: {', '.join(phones) if phones else 'not publicly verified'}"
                    ),
                },
            }
        )
        print(
            f"enriched: {fields.get('Company Name')} -> "
            f"{found[0] if found else 'no email'} | phones={len(phones)}"
        )
    patch_records("Broker Prospects", updates)
    print(f"updated {len(updates)} prospect contacts")


if __name__ == "__main__":
    main()
