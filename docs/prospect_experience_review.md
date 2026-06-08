# Prospect Experience Review

## Status

Outbound remains paused until this experience is approved.

Runtime control:

```text
OUTREACH_ENABLED=false
```

## Prospect Entry Point

Target recipient:

Freight broker, 3PL, reefer/FTL provider, forwarder, warehousing provider, or
logistics sales team that appears relevant to food/bev, refrigerated, regional
distribution, or time-sensitive freight.

## First Email

Subject:

```text
Food/bev shipper timing signals
```

Body:

```text
Hi [Company] team,

I found your team while mapping logistics providers that sell into food/bev, refrigerated, and time-sensitive freight.

FreightTrigger is a weekly shipper timing feed for sales teams that need a stronger reason to reach out than a static shipper list.

Each record starts with public business movement, then turns it into a freight read, contact route, and first-touch angle.

Preview:
https://getfreighttrigger.com/sample-feed.html

The preview shows the shape of the record. The paid beta feed includes current accounts, source context, contact path, scoring notes, and outreach positioning.

Beta is $497/month. Checkout delivers the current feed immediately, then Monday updates continue each week:
https://buy.stripe.com/14A8wO6R4df565JbjYfAc00

Website: https://getfreighttrigger.com

If this is not relevant, reply "not a fit" and I will close the loop.

FreightTrigger
signals@getfreighttrigger.com

FreightTrigger provides sales intelligence only. We do not broker freight, arrange transportation, select carriers, handle loads, manage shipments, process contracts, store shipping documents, manage invoices, or move payments between shippers and carriers.
```

## What The Email Reveals

- FreightTrigger is a weekly timing feed.
- It is for logistics sales teams.
- Initial vertical is food/bev, refrigerated, and time-sensitive freight.
- The buyer gets a preview before paying.
- Checkout delivers the current feed immediately.
- Monday updates continue weekly.
- FreightTrigger is sales intelligence only.

## What The Email Does Not Reveal

- Full source list.
- Full live signal records.
- Exact scoring mechanics.
- Complete contact paths.
- Full outreach positioning.
- Conversion-learning logic.
- Internal automation stack.

## Prospect Click Path

1. Prospect receives the email.
2. Prospect clicks the public preview:
   `https://getfreighttrigger.com/sample-feed.html`
3. Prospect sees a realistic feed preview with limited detail.
4. Prospect can subscribe through Stripe:
   `https://buy.stripe.com/14A8wO6R4df565JbjYfAc00`
5. If they reply instead, Gmail reply classification routes them into:
   - interested
   - needs info
   - not interested
   - unsubscribe
   - bad fit

## Approval Gate

Do not set `OUTREACH_ENABLED=true` until:

- first email is approved
- sample preview is approved
- needs-info response is approved
- paid buyer onboarding is approved
- Monday feed format is approved
