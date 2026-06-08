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
- `DATAFORSEOLOGIN` - DataForSEO API login for buyer and signal radar. Hosted Vercel variable name.
- `DATAFORSEOPASSWORD` - DataForSEO API password. Hosted Vercel variable name.
- `AIRTABLE_API_TOKEN` - Airtable API access.
- `AIRTABLE_BASE_ID` - FreightTrigger Airtable base ID. The code extracts `app...` if a full Airtable URL is pasted.
- `SAM_GOV_API_KEY` - public procurement opportunity source.
- `GOOGLE_CLIENT_ID` - Gmail API OAuth client ID.
- `GOOGLE_CLIENT_SECRET` - Gmail API OAuth client secret.
- `GOOGLE_REDIRECT_URI` - local OAuth callback URL. Default: `http://localhost:8765/oauth2callback`.
- `GMAIL_REFRESH_TOKEN` - long-lived Gmail OAuth token created by the local setup helper.
- `CLAYAPIKEY` - Clay workspace API key when API access is available.
- `CLAYWEBHOOKURL` - optional Clay webhook/workflow URL for automated enrichment handoff.

The code also accepts underscore aliases locally:

- `DATAFORSEO_LOGIN`
- `DATAFORSEO_PASSWORD`
- `AIRTABLEBASEID`
- `CLAY_API_KEY`
- `CLAY_WEBHOOK_URL`

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

## DataForSEO And Clay

DataForSEO is the radar layer. It finds candidate pages, companies, search results, and source URLs for buyer discovery and shipper-signal discovery.

Clay is the enrichment/workflow layer. It improves company/contact records after a target has been discovered. It should not replace Airtable as the system of record unless the operating model changes.

Current flow:

`DataForSEO -> Firecrawl -> OpenAI/FreightTrigger scoring -> Airtable -> Gmail/report engine`

Clay is added at the enrichment step:

`Qualified prospect/signal -> Clay enrichment -> Airtable contact/source fields -> outreach/report decision`

Implementation boundary:

- With `CLAYAPIKEY` only, FreightTrigger records Clay as available and logs records that need enrichment.
- With `CLAYWEBHOOKURL`, FreightTrigger sends weak-contact prospects into the Clay workflow automatically.
- Airtable remains the system memory; Clay is not the final database.

## Airtable Validation

Run:

`python3 scripts/validate_airtable.py`

Expected result:

- all required tables return `OK`
- no secrets are printed
- copied Airtable URLs are normalized to the underlying `app...` base ID

If every table returns `404`, the base ID/token pair is wrong or the token lacks access to that base.
