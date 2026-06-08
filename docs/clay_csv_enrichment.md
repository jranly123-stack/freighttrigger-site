# Clay CSV Enrichment Fallback

## Purpose

Clay webhook automation is not worth the $495/month upgrade before FreightTrigger
has paid validation. Use Clay as a manual enrichment layer for now, then import
the export into Airtable with a controlled script.

This preserves the business loop:

DataForSEO finds buyer targets -> Firecrawl extracts evidence -> Airtable stores
prospects -> Clay enriches weak contact paths -> FreightTrigger gates outreach ->
Gmail sends only qualified records.

## Clay Export Fields

Export a CSV with as many of these columns as Clay provides:

- Company Name
- Website or Domain
- Email or Work Email
- Phone or Company Phone
- Source URL or LinkedIn URL

The importer accepts common column-name variants, so exact capitalization is not
important.

## Local Import

Place the export here:

```bash
exports/clay_enrichment.csv
```

Run a dry validation:

```bash
python3 scripts/import_clay_enrichment_csv.py --dry-run
```

Write accepted enrichment to Airtable:

```bash
python3 scripts/import_clay_enrichment_csv.py
```

Then rebuild the send queue:

```bash
python3 scripts/prepare_outreach_queue.py
```

## Quality Gates

The importer only writes `Contact Email` when:

- the email format is valid
- the email is not a no-reply/legal/privacy style address
- the email domain matches the prospect website domain

Phones are captured in `Research Notes` because the current Airtable buyer table
does not expose a dedicated phone field in the send path.

Rejected or mismatched emails are stored as notes only and withheld from the send
gate. This prevents Clay enrichment from pushing weak contacts into live outreach.

## When To Upgrade Clay

Upgrade to Clay webhook/API automation only after one of these triggers:

- the CSV flow creates paid replies
- manual CSV import becomes a daily bottleneck
- contact enrichment is the main limit on send-ready volume
- MRR justifies $495/month without pressuring runway

Until then, CSV import gives most of the value without the fixed monthly cost.
