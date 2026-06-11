# DigitalOcean VPS Operating Plan

## Diagnosis

GitHub Actions plus Vercel is enough for early scheduled jobs, but it is not the
final operating engine. It is good for proving the loop and bad for durable
always-on operations.

The VPS should not replace the website or internal Vercel dashboard. It should
become the worker layer that runs jobs, retries failures, stores logs, and
monitors health.

## Strategic Objective

Use a VPS to make FreightTrigger less dependent on browser sessions, local
scripts, and GitHub schedule timing while keeping public surfaces lightweight:

- public website stays on Vercel
- internal dashboard stays on Vercel
- VPS runs the worker engine
- Airtable remains system memory until scale justifies Postgres
- Gmail remains send/read layer

## When To Add It

Do not add the VPS before the current gates are verified:

1. Gmail runtime works from Vercel.
2. GitHub Actions scheduler runs successfully.
3. Reply loop handles `Interested` and `Needs Info` correctly.
4. Dry-run outreach quality is reviewed.
5. Contact gates are producing enough qualified records.

Add the VPS after those are true because then the worker has a proven loop to
run. Adding it earlier creates infrastructure before the intelligence loop is
clean.

## Why Add It

The VPS improves:

- continuous operation
- retry control
- long-running jobs
- log retention
- health checks
- failure alerts
- queue processing
- Gmail reply polling
- report generation
- future migration from Airtable to Postgres/Redis

## Recommended Architecture

Vercel:
- public site
- sample queue
- Stripe webhook
- internal dashboard
- protected control routes

GitHub:
- source control
- emergency scheduler backup
- deploy history

DigitalOcean VPS:
- worker process
- scheduled job runner
- job logs
- retry queue
- health checks
- Gmail polling
- report delivery worker

Airtable:
- prospects
- outreach
- replies
- clients
- reports
- suppression list

Gmail:
- send outreach only after `OUTREACH_ENABLED=true`
- read replies
- send warm replies
- send onboarding/current-feed/Monday feed

Stripe:
- checkout
- subscription state
- webhook events

## VPS Job Schedule

Use business-safe times in America/New_York.

Weekdays:
- 9:00 AM: signal scan
- 9:15 AM: prospect acquisition
- 9:30 AM: outreach send if enabled
- 10:00 AM: reply loop
- 11:30 AM: outreach send if enabled
- 1:15 PM: prospect acquisition refresh
- 1:30 PM: outreach send if enabled
- 2:00 PM: reply loop
- 3:30 PM: outreach send if enabled
- 5:15 PM: prospect acquisition refresh
- 5:30 PM: outreach send if enabled
- 6:00 PM: reply loop
- 7:30 PM: final outreach send if enabled

Monday:
- 10:00 AM: paid-client weekly feed delivery

Night:
- no outreach
- optional maintenance only: logs, duplicate cleanup, source quality audit

## Environment Variables

The VPS needs the same runtime variables as Vercel:

- `OPENAI_API_KEY`
- `FIRECRAWL_API_KEY`
- `SERPAPI_API_KEY`
- `AIRTABLE_API_TOKEN`
- `AIRTABLE_BASE_ID`
- `SAM_GOV_API_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GMAILREFRESHTOKEN`
- `DATAFORSEOLOGIN`
- `DATAFORSEOPASSWORD`
- `CLAYAPIKEY`
- `STRIPESECRETKEY`
- `STRIPEWEBHOOKSECRET`
- `CRONSECRET`
- `OUTREACH_ENABLED`

Keep `OUTREACH_ENABLED=false` until the full dry-run and buyer-flow gates pass.

## Deployment Sequence

1. Create the smallest reasonable Ubuntu droplet.
2. Create a dedicated Linux user for FreightTrigger.
3. Install Node, Python, Git, and process manager tooling.
4. Clone the GitHub repo.
5. Create `.env` from secured values.
6. Install Python and Node dependencies.
7. Run non-sending smoke tests:
   - Gmail smoke test
   - Airtable validation
   - outreach dry-run
   - weekly report dry-run
8. Add systemd timers or cron entries for worker jobs.
9. Send worker logs to files under `/var/log/freighttrigger`.
10. Add a health check endpoint or heartbeat log.
11. Keep GitHub Actions as a backup scheduler for the first week.
12. Disable duplicate scheduling only after VPS reliability is proven.

## Failure Controls

Never let the VPS send uncontrolled volume.

Controls:
- `OUTREACH_ENABLED=false` default
- max sends per run
- business-hours gate
- suppression list
- domain-match gate
- source-quality gate
- retry limits
- error logs
- daily send cap
- manual kill switch through env var

## Kill / Scale Trigger

Add VPS when:

- Gmail runtime is confirmed
- scheduled reply loop succeeds
- dry-run outreach shows enough qualified contacts
- scheduled jobs need better logs/retries than GitHub Actions

Do not add VPS yet if:

- Gmail runtime is still failing
- reply loop is untested
- no qualified records pass contact gates
- the main bottleneck is offer quality rather than infrastructure
