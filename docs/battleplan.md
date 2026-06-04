# FreightTrigger Battleplan

## Current State

Completed:

- Domain: `getfreighttrigger.com`
- Email: `signals@getfreighttrigger.com`
- Public website and Stripe checkout
- GitHub + Vercel deployment
- API keys loaded locally
- Airtable system of record
- Real seed data from the first researched report
- First one-shot signal discovery pipeline
- 8-agent operating model

## Current Product

Active Stripe product:

- **Beta FreightTrigger Signal Feed**
- `$497/month`
- Weekly trigger-scored shipper opportunities with evidence, likely freight need, buyer role/contact path, and outreach angle.

Keep this as the only public checkout product until the delivery engine has repeatable data quality.

## Why Not Add More Stripe Links Yet

The higher tiers should stay by request:

- `$1,500/month Broker Growth`
- `$3k-$5k/month Territory Command`
- `$10k+/month CRM/API Intelligence`

Reason:

- We need more conversion data before charging for exclusivity.
- The software/API tier requires a working internal database, report builder, and delivery process.
- Enterprise/API buyers will expect reliability, auditability, and integration controls.

## Internal Engine Path

1. Airtable is the system of record.
2. Seeded real signals replace fake sample data.
3. One-shot pipeline discovers candidates:
   `search -> extract -> classify -> score -> local candidate output`
4. Review gate prevents noisy data from entering Airtable.
5. Qualified candidates are inserted into Airtable.
6. Reports are generated from Airtable.
7. Outreach angles are generated from the signal record.

## 8-Agent Operating Loop

1. CEO/Mastermind Agent chooses vertical, pricing, and kill/scale decisions.
2. Signal Acquisition Agent finds candidate business movement.
3. Shipper Scoring Agent scores urgency, relevance, and confidence.
4. Contact/Org Agent maps buyer role and contact path.
5. Lane/Need Intelligence Agent infers freight/service fit.
6. Outbound Angle Agent writes hooks and follow-up logic.
7. Strategic Edge Agent finds underpriced verticals, regions, and patterns.
8. Compliance/Audit Agent enforces source-backed claims, opt-outs, and no brokerage language.

## Vercel / Vibe Code Path

Do not use vibe code for the public website. The website is already done.

Use Vercel/vibe code later for an internal app:

- Framework: Next.js on Vercel
- Database: Airtable first, Supabase later if needed
- Purpose: internal admin and report operations

First internal app screens:

- Signal candidate review
- Airtable signal database view
- Report builder
- Client feed generator
- Outreach draft generator
- Suppression list manager

Client-facing dashboard comes later, after 3-5 paying clients.

## 24/7 Automation Path

Phase 1:

- Manual/AI-assisted report delivery.
- One-shot signal pipeline.
- Human review before Airtable insertion.

Phase 2:

- Scheduled scans.
- Daily candidate output.
- Airtable insert for qualified signals only.
- Weekly report generation.

Phase 3:

- Gmail API OAuth.
- Reply classification.
- Follow-up drafts.
- Opt-out/suppression enforcement.

Phase 4:

- Stripe subscription status checks.
- Client feed access rules.
- Internal Vercel admin app.

Phase 5:

- Client dashboard.
- CRM exports.
- API feed.
- Conversion intelligence tracking.

## Non-Negotiable Boundaries

- FreightTrigger is faceless AI sales intelligence.
- No freight brokerage.
- No carrier selection.
- No load handling.
- No private freight documents.
- No invoices or payments between shippers and carriers.
- No guaranteed buyer intent claims.
