# Prospect Experience Review

## Status

Outbound is live only when the runtime send gate is enabled.

Runtime control:

```text
OUTREACHENABLED=true
```

## Prospect Entry Point

Target recipient:

Freight broker, 3PL, reefer/FTL provider, forwarder, warehousing provider, or
logistics sales team that appears relevant to food/bev, refrigerated, regional
distribution, or time-sensitive freight.

Preferred contact:

- owner/operator
- sales leader
- logistics sales leader
- transportation leader
- operations leader
- supply-chain or procurement leader

Generic inboxes are acceptable only as a temporary route when no direct buyer
path exists.

## First Email

Subject:

```text
Food/bev logistics opportunity queue
```

Body:

```text
Hi [Company] team,

I found your team while mapping logistics providers that sell into food/bev, refrigerated, and time-sensitive freight.

FreightTrigger is a weekly logistics opportunity queue. It turns business-change data into a prioritized list of companies where a logistics conversation may be worth testing before the account shows up on another static shipper list.

Each record answers: what changed, why it may matter for freight, who to contact, and what angle to test.

Preview:
https://getfreighttrigger.com/sample-feed

The preview shows the shape of the record without exposing the current-week queue. The paid beta includes current accounts, source context, contact path, scoring notes, and outreach positioning.

Beta is $497/month. Checkout delivers the current queue immediately, then Monday updates continue each week:
https://buy.stripe.com/14A8wO6R4df565JbjYfAc00

Website: https://getfreighttrigger.com

If this is not relevant, reply "not a fit" and I will close the loop.

FreightTrigger
signals@getfreighttrigger.com

FreightTrigger provides sales intelligence only. We do not broker freight, arrange transportation, select carriers, handle loads, manage shipments, process contracts, store shipping documents, manage invoices, or move payments between shippers and carriers.
```

## What The Email Reveals

- FreightTrigger is a logistics opportunity intelligence queue.
- It is for logistics sales teams.
- Initial vertical is food/bev, refrigerated, and time-sensitive freight.
- The buyer gets a partial preview before paying.
- Checkout delivers the current queue immediately.
- Monday updates continue weekly.
- FreightTrigger is sales intelligence only.

## What The Email Does Not Reveal

- Full source list.
- Full live opportunity records.
- Exact scoring mechanics.
- Complete contact paths.
- Full outreach positioning.
- Conversion-learning logic.
- Internal automation stack.

## Prospect Click Path

1. Prospect receives the email.
2. Prospect clicks the public preview:
   `https://getfreighttrigger.com/sample-feed`
3. Prospect sees a realistic queue preview with limited current-week detail.
4. Prospect can subscribe through Stripe:
   `https://buy.stripe.com/14A8wO6R4df565JbjYfAc00`
5. If they reply instead, Gmail reply classification routes them into:
   - interested
   - needs info
   - not interested
   - unsubscribe
   - bad fit

## Approval Gate

Before scaled outbound:

- first email must use opportunity positioning
- sample preview must withhold the current-week queue
- needs-info response must route to preview and checkout
- paid buyer onboarding must deliver the current queue immediately
- Monday queue format must meet the opportunity-record standard
