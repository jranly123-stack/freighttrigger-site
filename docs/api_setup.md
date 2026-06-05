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
- `GOOGLE_REDIRECT_URI` - local OAuth callback URL. Default: `http://localhost:8765/oauth2callback`.
- `GMAIL_REFRESH_TOKEN` - long-lived Gmail OAuth token created by the local setup helper.

## Later Variables

These are not required for the current static site, but will be needed when Stripe automation is built into an app:

- `STRIPE_SECRET_KEY`
- `STRIPESECRETKEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPEWEBHOOKSECRET`

## Stripe Webhook Automation

Internal dashboard endpoint:

`https://triggerops.vercel.app/api/stripe/webhook`

Events to send:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_succeeded`

What it does:

1. Verifies the Stripe webhook signature.
2. Creates or updates the Airtable `Clients` record.
3. Marks the Stripe status.
4. Sends the beta onboarding email from `signals@getfreighttrigger.com`.

Required Vercel environment variables for the `triggerops` project:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

The code also accepts the current Vercel names:

- `STRIPESECRETKEY`
- `STRIPEWEBHOOKSECRET`

Do not put these keys in the public website project.

## Gmail OAuth Setup

Gmail automation requires one account-owner browser approval. After that, the engine can refresh access in the background.

1. In Google Cloud, make sure the Gmail API is enabled.
2. In the OAuth client settings, add this authorized redirect URI:

   `http://localhost:8765/oauth2callback`

3. Run:

   `python3 scripts/gmail_oauth_setup.py`

4. Approve the consent screen for `signals@getfreighttrigger.com`.
5. The script writes `GMAIL_REFRESH_TOKEN` into `.env`.
6. Verify with:

   `python3 scripts/gmail_smoke_test.py`

Do not paste the refresh token into chat. It is equivalent to long-lived inbox access.

## Current Boundary

The public website does not use these keys. These credentials are for the later FreightTrigger operating engine:

`search -> extract -> classify -> score -> report -> outreach/reply handling`
