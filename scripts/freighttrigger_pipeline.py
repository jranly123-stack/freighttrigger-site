#!/usr/bin/env python3
"""First-pass FreightTrigger signal discovery pipeline.

This is a one-shot engine run:
search -> scrape -> classify -> score -> write candidate output

It is intentionally internal-only. The 24/7 scheduler and Gmail automation are
added later after the signal quality loop is stable.
"""

from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "run_outputs"
QUERIES = [
    "food distributor expansion distribution center refrigerated 2026",
    "beverage distributor new warehouse expansion 2026",
    "food company hiring logistics transportation coordinator 2026",
]

NOISE_DOMAINS = (
    "linkedin.com/jobs",
    "indeed.com",
    "ziprecruiter.com",
    "simplyhired.com",
    "glassdoor.com",
)


def load_env() -> None:
    for raw in (ROOT / ".env").read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ[key] = value


def http_json(method: str, url: str, headers: dict | None = None, body: dict | None = None) -> dict:
    data = None
    request_headers = headers or {}
    if body is not None:
        data = json.dumps(body).encode()
        request_headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=request_headers)
    with urllib.request.urlopen(req, timeout=45) as response:
        return json.loads(response.read().decode())


def serpapi_search(query: str) -> list[dict]:
    params = urllib.parse.urlencode(
        {
            "engine": "google",
            "q": query,
            "api_key": os.environ["SERPAPI_API_KEY"],
            "num": 5,
        }
    )
    payload = http_json("GET", f"https://serpapi.com/search.json?{params}")
    return payload.get("organic_results", [])[:5]


def firecrawl_scrape(url: str) -> str:
    payload = http_json(
        "POST",
        "https://api.firecrawl.dev/v1/scrape",
        headers={"Authorization": f"Bearer {os.environ['FIRECRAWL_API_KEY']}"},
        body={"url": url, "formats": ["markdown"]},
    )
    data = payload.get("data") or {}
    return (data.get("markdown") or data.get("content") or "")[:6000]


def openai_classify(title: str, url: str, text: str) -> dict:
    prompt = {
        "role": "user",
        "content": (
            "You are FreightTrigger's shipper signal scoring agent. "
            "Classify this public source for food/bev or reefer-adjacent logistics sales relevance. "
            "Return strict JSON with keys: company, trigger_summary, likely_freight_need, buyer_path, "
            "outreach_angle, urgency_score, confidence_score, freight_relevance, include, reason.\n\n"
            "Rules: urgency_score and confidence_score must be integers from 0 to 100. "
            "freight_relevance must be High, Medium, or Low. include must be true only when the source "
            "points to a specific company/account with a plausible current logistics change window. "
            "Reject generic articles, login pages, broad industry statistics, and job aggregator pages.\n\n"
            f"Title: {title}\nURL: {url}\nSource text:\n{text}"
        ),
    }
    payload = {
        "model": "gpt-4.1-mini",
        "messages": [
            {
                "role": "system",
                "content": "Return only valid JSON. Use cautious language. Do not claim verified buyer intent.",
            },
            prompt,
        ],
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
    }
    response = http_json(
        "POST",
        "https://api.openai.com/v1/chat/completions",
        headers={"Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}"},
        body=payload,
    )
    return json.loads(response["choices"][0]["message"]["content"])


def main() -> None:
    load_env()
    OUT_DIR.mkdir(exist_ok=True)
    candidates = []
    seen = set()

    for query in QUERIES:
        for result in serpapi_search(query):
            url = result.get("link")
            if not url or url in seen:
                continue
            if any(domain in url for domain in NOISE_DOMAINS):
                continue
            seen.add(url)
            title = result.get("title", "")
            try:
                text = firecrawl_scrape(url)
                if len(text) < 300:
                    continue
                analysis = openai_classify(title, url, text)
                if not analysis.get("include"):
                    print(f"rejected: {title[:80]}")
                    continue
                analysis["source_title"] = title
                analysis["source_url"] = url
                analysis["query"] = query
                candidates.append(analysis)
                print(f"scored: {title[:80]}")
            except Exception as exc:
                print(f"skipped: {url} | {str(exc)[:160]}")

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = OUT_DIR / f"signal_candidates_{stamp}.json"
    out.write_text(json.dumps(candidates, indent=2))
    print(f"wrote {len(candidates)} candidates to {out}")


if __name__ == "__main__":
    main()
