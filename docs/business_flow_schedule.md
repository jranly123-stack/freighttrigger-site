# FreightTrigger Business Flow And Schedule

## Business Loop

1. Buyer discovery
   FreightTrigger searches for freight brokers, 3PLs, carriers, reefer/FTL providers, forwarders, warehousing, fulfillment, and logistics sales teams that are likely to care about shipper acquisition.

2. Buyer enrichment
   Candidate buyer companies are scraped, scored, checked for fit, and enriched for public contact paths. Weak contact records are routed toward Clay enrichment.

3. Controlled outreach
   Qualified prospects receive a concise preview email during business hours only after `OUTREACH_ENABLED=true` is set. Until the buyer-flow sample is approved, outreach remains queued but unsent.

   If `OUTREACH_ENABLED=false`, scheduled outreach jobs still run but return a
   skipped result. This proves the scheduler works without sending cold email.

4. Reply classification
   Gmail replies are read and classified as interested, needs info, follow-up, not interested, unsubscribe, or bad fit. Opt-outs go to suppression.

   Warm reply handling is separate from cold outbound. Existing `Interested` and
   `Needs Info` replies may be answered during business hours after Gmail runtime
   access is verified, even while cold outbound remains paused.

5. Checkout
   Stripe checkout sells the Beta FreightTrigger Signal Feed at $497/month.

6. Immediate fulfillment
   A new buyer receives the current signal feed immediately after checkout. They do not wait until Monday.

7. Weekly fulfillment
   Active clients receive the Monday signal feed every Monday morning Eastern.

8. Feedback learning
   Replies, objections, bounces, purchases, renewals, and client feedback are stored so future targeting, scoring, and outreach improve.

## Positioning Logic

FreightTrigger is not a lead list. A lead list tells a rep who might ship.
FreightTrigger tells a rep where timing may have changed.

The operating model is:

`company event -> possible freight demand -> evidence review -> freight interpretation -> buyer path -> outreach angle -> conversion learning`

The strategic asset is not the page or dashboard. It is the growing record of
which events, source types, verticals, buyer roles, and outreach angles produce
replies, checkouts, renewals, and client feedback.

## Tool Correlation

DataForSEO:
Radar layer. Finds buyer prospects, source pages, market pages, and shipper-signal pages through search.

SerpAPI:
Backup radar layer. Used when DataForSEO is unavailable or returns no usable result.

Firecrawl:
Extraction layer. Converts source URLs into readable page text so the system can score evidence instead of guessing from titles.

OpenAI:
Interpretation layer. Scores buyer fit, shipper trigger relevance, freight hypothesis, urgency, confidence, outreach positioning, and reply intent.

Airtable:
System memory. Stores companies, signals, scores, broker prospects, outreach, replies, clients, reports, and suppression records.

Gmail API:
Distribution and inbox layer. Sends controlled outreach, onboarding, immediate feed delivery, Monday feed delivery, follow-ups, and reads replies.

Stripe:
Conversion layer. Converts interested prospects into paid subscriptions and triggers onboarding/current-feed delivery.

Clay:
Enrichment layer. Improves company/contact intelligence after a target is identified. It is not the radar and not the system memory.

Vercel:
Internal operator app and protected API endpoints.

GitHub Actions:
Scheduler. Calls protected Vercel cron endpoints at business-safe times.

DigitalOcean VPS:
Worker layer. Runs the durable FreightTrigger scheduler, calls protected Vercel
cron endpoints, keeps worker logs, prevents duplicate same-minute jobs, and
becomes the foundation for retries, health checks, Gmail polling, and report
delivery.

## Weekday Schedule

All times are Eastern.

9:00 AM:
Signal scan. Find food/bev, reefer, and cold-chain-adjacent shipper change signals.

9:15 AM:
Buyer acquisition. Find and score broker/3PL/provider prospects.

9:30 AM:
Controlled outreach send window. Sends only queued, qualified records that pass suppression and business-hour checks.

10:00 AM:
Reply loop. Classify inbound replies, suppress opt-outs, send sample replies when appropriate.

11:30 AM:
Controlled outreach send window.

1:15 PM:
Buyer acquisition refresh.

1:30 PM:
Controlled outreach send window.

2:00 PM:
Reply loop.

3:30 PM:
Controlled outreach send window.

5:15 PM:
Buyer acquisition refresh.

5:30 PM:
Controlled outreach send window.

6:00 PM:
Reply loop.

7:30 PM:
Final controlled outreach send window.

Monday 10:00 AM:
Weekly paid-client signal feed delivery.

## Automation Status

Research: 75%
DataForSEO, Firecrawl, OpenAI, and Airtable automate discovery and scoring. Remaining gap: stronger source filters and Clay return integration.

Outreach: 70%
The system can queue and send controlled Gmail outreach. Remaining gap: better contact confidence and bounce/reply feedback loops.

Sales: 45%
Stripe checkout and reply handling exist. Remaining gap: objection handling, follow-up-to-checkout optimization, and conversion tracking depth.

Reporting: 70%
Monday and instant checkout feed delivery exist. Remaining gap: richer report formatting and better verified contact-path fields.

Operations: 75%
GitHub Actions and Vercel routes are scheduled/protected. Remaining gap: production monitoring, failure alerts, and Clay webhook return path.

Expansion: 35%
The system is currently food/bev + reefer focused. Expansion waits for conversion data.

Overall current autonomy: approximately 65%.

Cold outbound remains intentionally gated. Scheduler automation can run, but live
new-prospect sends require `OUTREACH_ENABLED=true` after buyer-flow and dry-run
approval.

## Monday Plan

1. Let scheduled signal scan run at 9:00 AM.
2. Let buyer acquisition run at 9:15 AM, 1:15 PM, and 5:15 PM.
3. Review first DataForSEO-powered output quality in Airtable.
4. Allow business-hour outreach only from qualified, non-suppressed prospects.
5. Watch Gmail replies through reply loop.
6. If Stripe checkout occurs, deliver current feed immediately.
7. Send Monday feed to active clients at 10:00 AM when clients exist.
8. After the day, inspect reply rate, bad-fit rate, contact quality, and source quality.

## Scale Plan

Stage 1: $0-$5k MRR
Tighten food/bev + reefer feed quality, prove replies and first paid beta subscriptions.

Stage 2: $5k-$15k MRR
Add Clay webhook enrichment, stronger source scoring, bounce tracking, and basic client preference fields.

Add a small VPS worker layer when Gmail runtime, reply handling, and dry-run
outreach quality are proven. The VPS should run the engine, not replace the
website or dashboard.

Stage 3: $15k-$50k MRR
Create territory feeds, vertical feeds, stronger contact enrichment, subscription-tier delivery, and conversion benchmark fields.

Stage 4: $50k-$100k MRR
Build client-facing dashboard only after the weekly feed has enough data and usage feedback to justify it.

Stage 5: $100k+ MRR
Move from reports to FreightTrigger API/feed infrastructure: verticalized signal feeds, CRM push, performance benchmarks, and proprietary trigger-conversion intelligence.

## Kill And Scale Triggers

Scale if:
- Reply rates improve after enrichment.
- Paid clients use or renew the weekly feed.
- Food/bev + reefer signals repeatedly create conversations.
- Contact enrichment reduces bounce and bad-fit rates.

Change direction if:
- Prospects reply but do not buy.
- Clients buy once but do not renew.
- Signal quality remains generic after DataForSEO and Clay.
- Contact confidence stays weak after paid enrichment.

Kill or pause a source if:
- It produces repeated directories, media, job boards, stale pages, or unverifiable contacts.
