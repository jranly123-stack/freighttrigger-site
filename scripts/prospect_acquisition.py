#!/usr/bin/env python3
"""FreightTrigger buyer acquisition pipeline.

Finds freight brokers/3PL prospects, scores fit, drafts outbound, and stores
send-ready records in Airtable. It does not send email.
"""

from __future__ import annotations

import json
import os
import re
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "run_outputs"
ENV_PATH = ROOT / ".env"
SAMPLE_URL = "https://getfreighttrigger.com/sample-feed.html"
STRIPE_URL = "https://buy.stripe.com/14A8wO6R4df565JbjYfAc00"
PUBLIC_SITE_URL = "https://getfreighttrigger.com"

QUERIES = [
    "food beverage reefer freight broker contact",
    "refrigerated freight broker food beverage logistics contact",
    "food beverage 3PL refrigerated logistics contact",
    "reefer FTL broker food shippers contact",
    "cold chain logistics broker food beverage contact",
    "food beverage freight broker contact us inurl:contact",
    "reefer logistics 3PL contact us food beverage",
    "temperature controlled freight broker contact us",
]

NOISE_DOMAINS = (
    "linkedin.com",
    "facebook.com",
    "x.com",
    "twitter.com",
    "youtube.com",
    "indeed.com",
    "ziprecruiter.com",
    "glassdoor.com",
    "yelp.com",
    "mapquest.com",
    "yellowpages.com",
    "freightwaves.com",
    "foodlogistics.com",
    "usda.gov",
    "carriersource.io",
    "nfraweb.org",
    "pdfcoffee.com",
    "scribd.com",
    "dat.com",
    "truckstop.com",
)

BAD_EMAIL_PREFIXES = (
    "noreply",
    "no-reply",
    "donotreply",
    "privacy",
    "legal",
    "abuse",
    "security",
    "support",
    "careers",
    "jobs",
)


def load_env() -> None:
    for raw in ENV_PATH.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
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
    raw_base = os.environ.get("AIRTABLE_BASE_ID") or os.environ.get("AIRTABLEBASEID", "")
    match = re.search(r"app[A-Za-z0-9]{14,}", raw_base)
    base = match.group(0) if match else raw_base.strip()
    url = f"https://api.airtable.com/v0/{base}/{urllib.parse.quote(table)}"
    if query:
        url += "?" + urllib.parse.urlencode(query, doseq=True)
    return url


def airtable(method: str, table: str, body: dict | None = None, query: dict | None = None) -> dict:
    headers = {
        "Authorization": f"Bearer {os.environ['AIRTABLE_API_TOKEN']}",
        "Content-Type": "application/json",
    }
    return http_json(method, airtable_url(table, query), headers=headers, body=body)


def list_airtable(table: str) -> list[dict]:
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


def create_airtable(table: str, records: list[dict]) -> list[dict]:
    created: list[dict] = []
    for index in range(0, len(records), 10):
        batch = records[index : index + 10]
        payload = airtable(
            "POST",
            table,
            {
                "typecast": True,
                "records": [{"fields": record} for record in batch],
            },
        )
        created.extend(payload.get("records", []))
        time.sleep(0.2)
    return created


def serp_search(query: str) -> list[dict]:
    params = urllib.parse.urlencode(
        {
            "engine": "google",
            "q": query,
            "api_key": os.environ["SERPAPI_API_KEY"],
            "num": 10,
        }
    )
    payload = http_json("GET", f"https://serpapi.com/search.json?{params}")
    return payload.get("organic_results", [])[:10]


def scrape(url: str) -> str:
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
    return (data.get("markdown") or data.get("content") or "")[:8000]


def domain(url: str) -> str:
    parsed = urlparse(url)
    return parsed.netloc.lower().removeprefix("www.")


def root_url(url: str) -> str:
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}"


def extract_emails(text: str, source_domain: str) -> list[str]:
    found = set(re.findall(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", text))
    cleaned = []
    for email in found:
        email = email.strip(".,;:()[]{}<>").lower()
        prefix = email.split("@", 1)[0]
        if any(prefix.startswith(bad) for bad in BAD_EMAIL_PREFIXES):
            continue
        if source_domain and email.endswith("@" + source_domain):
            cleaned.insert(0, email)
        elif prefix in {"sales", "info", "contact", "hello", "team", "business"}:
            cleaned.append(email)
    return list(dict.fromkeys(cleaned))[:3]


def classify_prospect(title: str, url: str, text: str, emails: list[str]) -> dict:
    prompt = (
        "You are FreightTrigger's prospect scoring agent. Score this company as a possible buyer "
        "for a weekly food/bev + reefer shipper trigger intelligence feed. Return strict JSON with "
        "keys: include, company_name, buyer_type, target_vertical, fit_score, reason, personalization, "
        "email_subject.\n\n"
        "Rules: include true only for freight brokers, 3PLs, carriers, forwarders, warehousing, "
        "fulfillment, final-mile, or logistics sales organizations that could pay for shipper sales "
        "intelligence. Reject shippers, directories, media articles, load boards, job boards, and generic lists. "
        "fit_score must be 0-100. Do not say FreightTrigger handles freight.\n\n"
        f"Title: {title}\nURL: {url}\nCandidate emails: {', '.join(emails) or 'none'}\nSource text:\n{text[:6000]}"
    )
    payload = {
        "model": "gpt-4.1-mini",
        "temperature": 0.25,
        "response_format": {"type": "json_object"},
        "messages": [
            {
                "role": "system",
                "content": "Return only valid JSON. Be conservative and compliance-aware.",
            },
            {"role": "user", "content": prompt},
        ],
    }
    response = http_json(
        "POST",
        "https://api.openai.com/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}",
            "Content-Type": "application/json",
        },
        body=payload,
    )
    return json.loads(response["choices"][0]["message"]["content"])


def outreach_body(company: str) -> str:
    return "\n".join(
        [
            f"Hi {company} team,",
            "",
            "I found your team while mapping logistics providers that sell into food, beverage, refrigerated, or time-sensitive freight.",
            "",
            "FreightTrigger sends a short weekly signal feed for reps who need a better reason to call than a stale shipper list.",
            "",
            "The feed points to companies showing freight-relevant business movement, then packages the evidence, contact route, freight read, and opener into a sales-ready record.",
            "",
            "A partial preview is here:",
            SAMPLE_URL,
            "",
            "The preview shows the format. The paid feed includes the source trail, scoring notes, buyer path, and outreach positioning.",
            "",
            "Beta is $497/month. Checkout delivers the current feed immediately, then Monday updates continue for the week ahead:",
            STRIPE_URL,
            "",
            f"Website: {PUBLIC_SITE_URL}",
            "",
            'If this is not relevant, reply "not a fit" and I will not follow up.',
            "",
            "FreightTrigger",
            "signals@getfreighttrigger.com",
            "",
            "FreightTrigger provides sales intelligence only. We do not broker freight, arrange transportation, select carriers, handle loads, manage shipments, process contracts, store shipping documents, manage invoices, or move payments between shippers and carriers.",
        ]
    )


def main() -> None:
    load_env()
    OUT_DIR.mkdir(exist_ok=True)

    existing_prospects = list_airtable("Broker Prospects")
    existing_websites = {
        str(record.get("fields", {}).get("Website", "")).strip().lower()
        for record in existing_prospects
    }
    suppression = {
        str(record.get("fields", {}).get("Email", "")).strip().lower()
        for record in list_airtable("Suppression List")
    }

    seen_domains: set[str] = set()
    prospects: list[dict] = []
    outreach_records: list[dict] = []
    run_log: list[str] = []

    for query in QUERIES:
        print(f"Signal Acquisition Agent: searching {query}")
        for result in serp_search(query):
            url = result.get("link")
            title = result.get("title") or "Untitled result"
            if not url:
                continue
            site_domain = domain(url)
            if any(noise in site_domain for noise in NOISE_DOMAINS):
                continue
            site_root = root_url(url)
            if site_domain in seen_domains or site_root.lower() in existing_websites:
                continue
            seen_domains.add(site_domain)

            try:
                text = scrape(url)
                if len(text) < 400:
                    run_log.append(f"skipped thin source: {title}")
                    continue
                emails = extract_emails(text, site_domain)
                analysis = classify_prospect(title, url, text, emails)
                if not analysis.get("include") or int(analysis.get("fit_score", 0)) < 68:
                    run_log.append(f"rejected: {title} | {analysis.get('reason')}")
                    continue
                contact_email = (emails[0] if emails else "").lower()
                if contact_email and contact_email in suppression:
                    run_log.append(f"suppressed: {title} | {contact_email}")
                    continue

                prospects.append(
                    {
                        "Company Name": analysis.get("company_name") or title[:80],
                        "Website": site_root,
                        "Buyer Type": analysis.get("buyer_type") or "Freight Broker",
                        "Target Vertical": analysis.get("target_vertical") or "Food/bev + reefer",
                        "Contact Email": contact_email,
                        "Status": "Qualified" if contact_email else "Needs Contact",
                        "Research Notes": (
                            f"Fit score: {analysis.get('fit_score')}\n"
                            f"Reason: {analysis.get('reason')}\n"
                            f"Personalization: {analysis.get('personalization')}\n"
                            f"Source: {url}"
                        ),
                    }
                )
                outreach_records.append(
                    {
                        "Email Subject": analysis.get("email_subject")
                        or "Food/bev shipper timing signals",
                        "Message": outreach_body(analysis.get("company_name") or title[:80]),
                        "Status": "Queued" if contact_email else "Needs Contact",
                    }
                )
                run_log.append(f"qualified: {analysis.get('company_name')} | {contact_email or 'needs contact'}")
                print(f"Scoring Agent: qualified {analysis.get('company_name')} ({analysis.get('fit_score')})")
                if len(prospects) >= 12:
                    break
            except Exception as exc:
                run_log.append(f"skipped: {title} | {str(exc)[:160]}")
        if len(prospects) >= 12:
            break

    created_prospects = create_airtable("Broker Prospects", prospects)
    linked_outreach = []
    for index, outreach in enumerate(outreach_records):
        if index < len(created_prospects):
            outreach["Prospect"] = [created_prospects[index]["id"]]
            linked_outreach.append(outreach)
    created_outreach = create_airtable("Outreach", linked_outreach)

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    output = {
        "ran_at": stamp,
        "prospects_created": len(created_prospects),
        "outreach_created": len(created_outreach),
        "queued_with_email": sum(1 for prospect in prospects if prospect.get("Contact Email")),
        "log": run_log,
        "prospects": prospects,
    }
    out = OUT_DIR / f"prospect_acquisition_{stamp}.json"
    out.write_text(json.dumps(output, indent=2))
    print(f"Outbound Angle Agent: created {len(created_outreach)} outreach drafts.")
    print(f"Compliance Agent: queued records only; no email sent.")
    print(f"wrote acquisition output to {out}")


if __name__ == "__main__":
    main()
