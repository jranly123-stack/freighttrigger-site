# FreightTrigger Internal Dashboard

Internal operator cockpit for the FreightTrigger engine.

This is not the public marketing website and not a client dashboard. It is the internal review and operations layer for:

- Airtable signal database visibility
- Engine run status
- Candidate signal generation
- Report operations
- Future Gmail/API automation

## Local Development

From `internal-dashboard/`:

```bash
npm install
npm run dev
```

The app reads environment variables from:

1. `internal-dashboard/.env.local`
2. the parent project `.env` as a local fallback
3. Vercel environment variables in production

## Vercel Deployment

Create a separate Vercel project using:

- Repository: `freighttrigger-site`
- Root directory: `internal-dashboard`
- Framework: Next.js

Add the same API environment variables in Vercel project settings.

Also add internal dashboard protection:

- `INTERNAL_DASHBOARD_USER`
- `INTERNAL_DASHBOARD_PASSWORD`

If `INTERNAL_DASHBOARD_PASSWORD` is missing in production, the dashboard returns `503` instead of exposing internal data.

Suggested internal domain:

`ops.getfreighttrigger.com`

## Current Boundary

This dashboard runs the engine and reviews signals. It is not customer-facing yet.

Beta clients should receive polished report/feed deliverables, not access to this operator dashboard.
