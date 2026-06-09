# FreightTrigger Needs Info Conversion Playbook

## Purpose

`Needs Info` is a warm intent state, not a passive label. The prospect has not rejected the offer and has not opted out. The system must answer clearly, route them to the sample and checkout path, and record what question or objection blocked purchase.

## Current Control

Outbound remains gated by `OUTREACH_ENABLED=false` until buyer-flow approval is complete. Reply handling can still process existing warm replies once Gmail runtime access is working.

## Warm Reply States

Interested:
- Send the public sample preview.
- Send the beta checkout link.
- Explain that checkout delivers the current feed immediately and Monday updates continue weekly.
- Ask for target region/service fit if they want to sanity-check before purchase.

Needs Info:
- Answer what FreightTrigger is.
- Show the public partial sample.
- Explain what the paid beta feed includes.
- Link checkout.
- Invite a direct reply with target lane, region, or customer type.

Unsubscribe:
- Add to suppression.
- Do not follow up.

Not Interested / Bad Fit:
- Do not continue active selling.
- Preserve feedback for targeting.

Follow-up:
- Queue later follow-up only inside business-hour send windows.

## Conversion Tracking Asset

Each warm reply response appends a tracking block into the Airtable `Replies` record:

- question_asked
- answer_sent
- sample_url
- stripe_url
- sample_click
- stripe_click
- purchase_status
- objection_category

This creates the first conversion-learning loop:

reply wording -> question/objection -> answer sent -> sample/checkout behavior -> purchase/no purchase -> future scoring and messaging.

## Business-Hour Rule

Automated warm-reply responses only send during the existing business window unless a route is explicitly forced for testing:

- Monday through Friday
- 9:00 AM to 8:00 PM Eastern

## Kill / Scale Triggers

Scale this path if:
- warm replies convert to checkout,
- questions cluster around the same objections,
- sample preview clicks rise,
- no opt-out spike appears.

Change this path if:
- prospects ask for a different proof format,
- replies show confusion about what is being sold,
- price objection dominates,
- sample clicks happen but checkout does not.

Stop automated sends if:
- unsubscribe rate spikes,
- bounce rate rises,
- reply classification creates wrong responses,
- Gmail deliverability degrades.
