# FreightTrigger API Setup

Use `.env.example` as the template for local credentials.

## Local Setup

1. Copy `.env.example` to `.env`.
2. Fill in the real values locally.
3. Do not paste secrets into chat.
4. Do not commit `.env`.

## Required Variables

- `OPENAI_API_KEY` - model calls for scoring, summarization, classification, and outreach drafting.
- `FIRECRAWL_API_KEY` - web extraction and evidence capture.
- `SERPAPI_API_KEY` - search discovery at scale.
- `AIRTABLE_API_TOKEN` - Airtable API access.
- `AIRTABLE_BASE_ID` - FreightTrigger Airtable base ID.
- `SAM_GOV_API_KEY` - public procurement opportunity source.
- `GOOGLE_CLIENT_ID` - Gmail API OAuth client ID.
- `GOOGLE_CLIENT_SECRET` - Gmail API OAuth client secret.

## Later Variables

These are not required for the current static site, but will be needed when Stripe or Gmail automation is built into an app:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `GOOGLE_REDIRECT_URI`

## Current Boundary

The public website does not use these keys. These credentials are for the later FreightTrigger operating engine:

`search -> extract -> classify -> score -> report -> outreach/reply handling`
