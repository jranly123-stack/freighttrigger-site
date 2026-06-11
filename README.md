# FreightTrigger Site

Public FreightTrigger website for `getfreighttrigger.com`.

## Files

- `index.html` - page content
- `sample-feed.html` - public sample opportunity queue preview
- `styles.css` - responsive styling

## Included Sections

- Hero and business positioning
- What FreightTrigger does
- Customer deliverables
- Sample opportunity queue preview
- Beta and custom pricing tiers
- Compliance disclaimer
- Subscription, refund, privacy, and no-guarantee policies
- Public contact details

## Public Contact

The footer currently uses:

- `signals@getfreighttrigger.com`
- `getfreighttrigger.com`

Update `index.html` if the public contact details change.

## Deploy To Vercel

1. Create a new Vercel project.
2. Import this folder/repository.
3. Use the static defaults. No build command is required.
4. Set the output/public directory to the project root if Vercel asks.
5. Add `getfreighttrigger.com` in Vercel project domain settings.
6. Update DNS at the domain registrar using Vercel's provided records.

## Deploy To Netlify

1. Create a new Netlify site.
2. Import this folder/repository or drag the folder into Netlify Drop.
3. Leave build command blank.
4. Set publish directory to `.` if Netlify asks.
5. Add `getfreighttrigger.com` in Netlify domain settings.
6. Update DNS at the domain registrar using Netlify's provided records.

## Notes

No API keys or secrets are included in the public site. The operating engine, dashboard, Gmail automation, Airtable memory, DataForSEO, Firecrawl, OpenAI, and related integrations run through the internal ops layer.
