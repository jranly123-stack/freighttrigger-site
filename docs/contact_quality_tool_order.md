# Contact Quality Tool Order

## Objective

Increase send-ready volume without lowering deliverability, compliance, or buyer
fit. The problem is not only "more emails." The problem is reaching the person
who owns logistics prospecting pain.

## Current Stack

DataForSEO:
Finds buyer accounts and source pages.

Clay:
Structures and enriches rows after a target is identified. Current mode is CSV
bridge until webhook cost is justified by conversion.

Firecrawl:
Extracts pages for evidence and context.

Airtable:
System memory for prospects, outreach, replies, suppressions, clients, reports,
and conversion learning.

## Buying Order

### 1. Apollo

Buy first if the next spend is for client acquisition.

Reason:
FreightTrigger's bottleneck is weak direct-contact coverage. Apollo should move
records from generic inboxes toward named owner, sales, operations,
transportation, logistics, supply-chain, and procurement contacts.

Guardrail:
Use Apollo internally for FreightTrigger acquisition only. Do not resell Apollo
raw data or expose it as a customer-facing data product unless a separate
agreement allows that use.

### 2. ZeroBounce or NeverBounce

Buy immediately after Apollo, or at the same time if budget allows.

Reason:
Apollo/Clay/RocketReach/Lusha can find contacts; verification protects domain
reputation and keeps bounce data from poisoning conversion learning.

Guardrail:
No scaled sends from newly enriched emails until verification status is stored
and the contact passes the send gate.

### 3. LinkedIn Sales Navigator

Use as targeting intelligence, not the automation backbone.

Reason:
It helps confirm account fit, buyer role, headcount, seniority, geography, and
whether the person appears active/relevant. It is especially useful for avoiding
generic inboxes and wrong-person outreach.

Guardrail:
Do not scrape aggressively or automate against LinkedIn in a way that violates
platform terms. Use it as a validation and research layer.

### 4. Lusha or RocketReach

Use as a gap-fill tool.

Reason:
Freight often has phone-heavy sales motion. If Apollo does not surface enough
direct phones or role-specific contacts, use one of these to fill high-value
gaps only.

Guardrail:
Phone numbers are more expensive and should be spent on high-fit accounts, not
bulk-low-quality lists.

### 5. Twilio

Add after the email/contact loop is stable.

Reason:
Twilio is phone infrastructure, not a contact database. It becomes useful for
alias numbers, call routing, voicemail, recording, transcription, and AI-assisted
phone workflows once there is a proven reason to add voice.

Guardrail:
Do not start automated phone outreach until contact quality, consent/compliance
rules, and call handling scripts are defined.

## Send-Ready Gate

A record is send-ready only when:

- account fit is qualified
- target role is relevant
- email is direct or high-quality departmental, not generic when avoidable
- email domain matches the company
- verification status is valid or acceptable
- suppression check passes
- no duplicate outreach is active
- message uses opportunity-queue positioning

## Contact Path For Paid Reports

Paid customer records should not expose raw vendor data as the product. The
customer value is the route:

- likely buyer role
- public contact path
- recommended channel
- confidence level
- suggested first-touch angle
- evidence-backed reason to contact

The moat remains interpretation and conversion learning, not scraped contact
inventory.
