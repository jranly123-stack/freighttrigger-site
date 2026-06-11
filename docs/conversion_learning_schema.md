# FreightTrigger Conversion Learning Schema

## Purpose

FreightTrigger should not treat replies as one-off messages. Every reply,
sample click, checkout click, purchase, objection, and unsubscribe must become
conversion intelligence.

The first version stores this data in Airtable records and appended tracking
blocks. Later versions should promote the highest-value fields into dedicated
Airtable columns or a Postgres event table.

## Core Event Types

Prospect discovered:
- buyer company
- buyer vertical
- provider type
- region
- source URL
- discovery query
- fit score
- source quality

Contact enriched:
- contact email
- email source
- email domain match
- phone if available
- enrichment source
- contact confidence
- Clay CSV import status

Outreach queued:
- email subject
- message variant
- sample URL
- checkout URL
- target vertical
- contact gate result
- suppression status

Outreach sent:
- sent timestamp
- send route
- message variant
- recipient
- delivery attempt status

Reply received:
- Gmail message ID
- reply timestamp
- sender
- classified intent
- question asked
- objection category
- linked prospect

Conversion response sent:
- answer variant
- sample URL with UTM/contact context
- checkout URL with UTM/contact context
- next action

Checkout/purchase:
- Stripe customer
- Stripe subscription
- buyer email
- plan
- checkout timestamp
- onboarding email sent
- current opportunity queue delivered

Client feedback:
- useful signal
- bad fit signal
- replied/booked/closed outcome
- preferred vertical
- preferred region
- preferred service mode

## Reply Intent Labels

Use these labels exactly:

- `Interested`
- `Needs Info`
- `Follow-up`
- `Not Interested`
- `Unsubscribe`
- `Bad Fit`

`Needs Info` is a revenue state, not a neutral state. It means the buyer did not
reject the offer and needs clarity before paying.

## Current Airtable Memory

Current implementation stores conversion-learning data in:

- `Broker Prospects`
- `Outreach`
- `Replies`
- `Suppression List`
- `Clients`
- `Reports`

Warm reply responses append a conversion block into `Replies.Reply Summary`:

```text
[conversion-response:needs-info:<id>]
tracked_at:
contact:
question_asked:
answer_sent:
sample_url:
stripe_url:
sample_click: pending_tracking
stripe_click: pending_tracking
purchase_status: pending_stripe_match
objection_category:
```

## Fields To Promote Next

Promote these into dedicated Airtable columns when the reply volume grows:

- `Question Asked`
- `Answer Variant`
- `Objection Category`
- `Sample URL`
- `Stripe URL`
- `Sample Clicked`
- `Stripe Clicked`
- `Purchase Status`
- `Follow-up Due`
- `Reply Age`
- `Conversion Stage`

## Contact Confidence Gate

A prospect should not enter live cold outreach unless:

- status is `Qualified`
- email exists
- email is not suppressed
- source is not rejected or low quality
- email domain matches the prospect website domain
- message exists

Clay-enriched records must still pass the same gate. Enrichment improves contact
quality; it does not override compliance or deliverability rules.

## Sample And Checkout Tracking

Every reply response should use contextual URLs:

- sample URL includes `utm_source=gmail`
- sample URL includes intent campaign
- Stripe URL includes intent campaign
- both include contact context

This is not perfect click tracking yet, but it creates a path to connect:

reply intent -> answer variant -> sample/checkout interest -> purchase

## Kill And Scale Signals

Scale a message variant when:

- `Needs Info` replies convert to checkout clicks
- `Interested` replies convert to purchases
- unsubscribes stay low
- bad-fit replies decline after targeting changes

Kill or rewrite a variant when:

- it generates clarity questions that should have been answered upfront
- it creates trust/data objections
- it gets unsubscribes
- it attracts buyers outside food/bev, reefer, or logistics sales fit
