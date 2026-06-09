#!/usr/bin/env python3
"""Simulate FreightTrigger reply handling without Gmail or Airtable writes."""

from __future__ import annotations

import argparse
import re
from datetime import datetime, timezone

SAMPLE_URL = "https://getfreighttrigger.com/sample-feed"
CHECKOUT_URL = "https://buy.stripe.com/14A8wO6R4df565JbjYfAc00"


def classify_by_rules(text: str) -> str:
    lower = text.lower()
    if re.search(r"(unsubscribe|remove me|do not email|don't email|stop emailing|opt out)", lower):
        return "Unsubscribe"
    if re.search(r"(not interested|no thanks|no thank you|not a fit|wrong person)", lower):
        return "Bad Fit" if "wrong person" in lower else "Not Interested"
    if re.search(r"(how much|price|pricing|what.*include|details|territory|coverage|more info|more information)", lower):
        return "Needs Info"
    if re.search(r"(send|share|show|see|sample|example|report|feed|interested|tell me more)", lower):
        return "Follow-up" if "later" in lower else "Interested"
    if re.search(r"(later|next week|next month|circle back|follow up)", lower):
        return "Follow-up"
    return "Needs Info"


def link_with_context(url: str, intent: str, email: str) -> str:
    campaign = intent.lower().replace(" ", "-")
    return f"{url}?utm_source=gmail&utm_medium=reply&utm_campaign={campaign}&contact={email}"


def infer_question_asked(subject: str, body: str) -> str:
    text = re.sub(r"\s+", " ", f"{subject}\n{body}").strip()
    question = re.search(r"[^.!?]*\?", text)
    if question:
        return question.group(0).strip()[:260]
    lower = text.lower()
    if "price" in lower or "cost" in lower or "how much" in lower:
        return "Pricing / cost clarity"
    if "include" in lower or "what do" in lower or "details" in lower:
        return "Product inclusion clarity"
    if "sample" in lower or "example" in lower or "preview" in lower:
        return "Sample / proof request"
    return "General information request"


def infer_objection_category(subject: str, body: str) -> str:
    lower = f"{subject}\n{body}".lower()
    if re.search(r"(price|cost|expensive|budget|too much)", lower):
        return "price"
    if re.search(r"(trust|proof|real|source|accurate|verify|verified)", lower):
        return "trust/data"
    if re.search(r"(fit|vertical|industry|territory|region|service)", lower):
        return "fit"
    if re.search(r"(how|what|include|details|sample|example|preview)", lower):
        return "clarity"
    return "unknown"


def build_needs_info_reply(email: str) -> str:
    return "\n".join(
        [
            "Good question.",
            "",
            "FreightTrigger is a weekly shipper-timing feed for logistics sales teams. It is built to answer: who has a current business event worth contacting, why the timing matters, what freight angle fits, and what first touch should say.",
            "",
            "Preview:",
            link_with_context(SAMPLE_URL, "Needs Info", email),
            "",
            "The preview shows the structure. The paid beta feed includes current account records, source context, freight read, contact route, scoring notes, and sales positioning.",
            "",
            "Current beta:",
            "$497/month. Checkout delivers the current feed immediately, then Monday updates continue each week:",
            link_with_context(CHECKOUT_URL, "Needs Info", email),
            "",
            "If you want a direct answer before checkout, reply with the specific lane, region, or customer type your team sells into and I will tell you whether the beta feed fits.",
            "",
            "FreightTrigger provides sales intelligence only. We do not broker freight, arrange transportation, select carriers, handle loads, manage shipments, process contracts, store shipping documents, manage invoices, or move payments between shippers and carriers.",
        ]
    )


def build_interested_reply(email: str) -> str:
    return "\n".join(
        [
            "Here is the clean path.",
            "",
            "Preview:",
            link_with_context(SAMPLE_URL, "Interested", email),
            "",
            "Beta feed:",
            link_with_context(CHECKOUT_URL, "Interested", email),
            "",
            "After checkout, the current FreightTrigger feed is delivered right away. Monday updates continue each week after that.",
            "",
            "The feed includes current shipper opportunities with evidence, freight read, buyer/contact route, urgency/confidence notes, and outreach positioning.",
            "",
            "If you want to sanity-check fit first, reply with your target region and whether you sell reefer, FTL/LTL, brokerage, 3PL, warehousing, or final mile.",
        ]
    )


def conversion_block(gmail_id: str, email: str, intent: str, subject: str, body: str) -> str:
    answer = "interested-direct-path-v1" if intent == "Interested" else "needs-info-clarity-v1"
    return "\n".join(
        [
            f"[conversion-response:{intent.lower().replace(' ', '-')}:{gmail_id}]",
            f"tracked_at: {datetime.now(timezone.utc).isoformat()}",
            f"contact: {email}",
            f"question_asked: {infer_question_asked(subject, body)}",
            f"answer_sent: {answer}",
            f"sample_url: {link_with_context(SAMPLE_URL, intent, email)}",
            f"stripe_url: {link_with_context(CHECKOUT_URL, intent, email)}",
            "sample_click: pending_tracking",
            "stripe_click: pending_tracking",
            "purchase_status: pending_stripe_match",
            f"objection_category: {infer_objection_category(subject, body)}",
        ]
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--email", default="buyer@example-logistics.com")
    parser.add_argument("--subject", default="Re: Food/bev shipper timing signals")
    parser.add_argument(
        "--body",
        default="Can you send more info? What does the paid feed include and how much is it?",
    )
    args = parser.parse_args()

    intent = classify_by_rules(f"{args.subject}\n{args.body}")
    response = build_interested_reply(args.email) if intent == "Interested" else build_needs_info_reply(args.email)

    print("SIMULATED INBOUND REPLY")
    print(f"from: {args.email}")
    print(f"subject: {args.subject}")
    print(f"body: {args.body}")
    print()
    print(f"classified_intent: {intent}")
    print()
    print("ENGINE RESPONSE")
    print(response)
    print()
    print("AIRTABLE CONVERSION BLOCK")
    print(conversion_block("simulated-gmail-id", args.email, intent, args.subject, args.body))


if __name__ == "__main__":
    main()
