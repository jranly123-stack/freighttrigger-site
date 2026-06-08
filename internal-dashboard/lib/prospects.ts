import { createRecords, listRecords, patchRecords } from "./airtable";
import { clayStatus, sendClayEnrichmentRequest } from "./clay";
import { requireEnv } from "./local-env";
import { searchWeb } from "./search";

const SAMPLE_URL = "https://getfreighttrigger.com/sample-feed.html";
const STRIPE_URL = "https://buy.stripe.com/14A8wO6R4df565JbjYfAc00";

const QUERIES = [
  "food beverage reefer freight broker contact",
  "refrigerated freight broker food beverage logistics contact",
  "food beverage 3PL refrigerated logistics contact",
  "reefer FTL broker food shippers contact",
  "cold chain logistics broker food beverage contact",
  "food beverage freight broker contact us inurl:contact",
  "reefer logistics 3PL contact us food beverage",
  "temperature controlled freight broker contact us"
];

const CONTACT_PATHS = [
  "",
  "/contact",
  "/contact-us",
  "/contactus",
  "/request-a-quote",
  "/quote",
  "/get-a-quote",
  "/about",
  "/about-us",
  "/team",
  "/sales",
  "/locations"
];

const NOISE_DOMAINS = [
  "linkedin.com",
  "facebook.com",
  "x.com",
  "twitter.com",
  "youtube.com",
  "indeed.com",
  "ziprecruiter.com",
  "glassdoor.com",
  "yelp.com",
  "mapquest.com",
  "yellowpages.com",
  "freightwaves.com",
  "foodlogistics.com",
  "usda.gov",
  "carriersource.io",
  "nfraweb.org",
  "pdfcoffee.com",
  "scribd.com",
  "dat.com",
  "truckstop.com"
];

const BAD_EMAIL_PREFIXES = [
  "noreply",
  "no-reply",
  "donotreply",
  "privacy",
  "legal",
  "abuse",
  "security",
  "support",
  "careers",
  "jobs"
];

type ProspectAnalysis = {
  include?: boolean;
  company_name?: string;
  buyer_type?: string;
  target_vertical?: string;
  fit_score?: number;
  reason?: string;
  personalization?: string;
  email_subject?: string;
  email_body?: string;
};

type AcquisitionOptions = {
  maxQueries?: number;
  maxResultsPerQuery?: number;
  maxProspects?: number;
  deadlineMs?: number;
};

type EnrichmentOptions = {
  maxProspects?: number;
  deadlineMs?: number;
};

async function jsonFetch<T>(url: string, init?: RequestInit & { timeoutMs?: number }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init?.timeoutMs ?? 12_000);
  const { timeoutMs: _timeoutMs, ...fetchInit } = init ?? {};

  try {
    const response = await fetch(url, { ...fetchInit, signal: controller.signal, cache: "no-store" });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${response.status}: ${text.slice(0, 180)}`);
    }
    return response.json() as Promise<T>;
  } finally {
    clearTimeout(timeout);
  }
}

function domain(url: string) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function rootUrl(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.hostname}`;
  } catch {
    return url;
  }
}

function extractEmails(text: string, sourceDomain: string) {
  const found = Array.from(new Set(text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []));
  const cleaned: string[] = [];

  for (const raw of found) {
    const email = raw.replace(/[.,;:()[\]{}<>]+$/g, "").toLowerCase();
    const prefix = email.split("@", 1)[0];
    if (BAD_EMAIL_PREFIXES.some((bad) => prefix.startsWith(bad))) continue;
    if (sourceDomain && email.endsWith(`@${sourceDomain}`)) cleaned.unshift(email);
    else if (["sales", "info", "contact", "hello", "team", "business"].includes(prefix)) cleaned.push(email);
  }

  return Array.from(new Set(cleaned)).slice(0, 3);
}

function extractPhones(text: string) {
  const pattern = /(?:\+1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g;
  const cleaned: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const raw = match[0];
    const context = text.slice(Math.max(0, match.index - 45), match.index + raw.length + 45).toLowerCase();
    if (!["phone", "tel", "call", "contact", "office", "main", "customer", "service"].some((token) => context.includes(token))) {
      continue;
    }
    let digits = raw.replace(/\D/g, "");
    if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
    if (digits.length !== 10) continue;
    if ("01".includes(digits[0]) || "01".includes(digits[3])) continue;
    if (["000", "111", "123", "555"].some((prefix) => digits.startsWith(prefix))) continue;
    cleaned.push(`(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`);
  }

  return Array.from(new Set(cleaned)).slice(0, 4);
}

async function searchContactSources(company: string, website: string, siteDomain: string) {
  const queries = [
    `site:${siteDomain} "@${siteDomain}" contact`,
    `site:${siteDomain} ("sales@${siteDomain}" OR "info@${siteDomain}" OR "contact@${siteDomain}" OR "logistics@${siteDomain}")`,
    `"${company}" "@${siteDomain}"`
  ];
  const emails: string[] = [];
  const phones: string[] = [];
  let sourceUrl = website;
  const seen = new Set<string>();

  for (const query of queries) {
    const results = await searchWeb(query, 4);
    for (const result of results) {
      const url = result.link || "";
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const snippet = [result.title || "", (result as { snippet?: string }).snippet || "", url].join("\n");
      emails.push(...extractEmails(snippet, siteDomain));
      phones.push(...extractPhones(snippet));
      if (emails.length || phones.length) {
        sourceUrl = url;
        return {
          emails: Array.from(new Set(emails)).slice(0, 3),
          phones: Array.from(new Set(phones)).slice(0, 4),
          sourceUrl
        };
      }
      if (domain(url) === siteDomain) {
        const text = await scrape(url);
        emails.push(...extractEmails(text, siteDomain));
        phones.push(...extractPhones(text));
        if (emails.length || phones.length) {
          sourceUrl = url;
          return {
            emails: Array.from(new Set(emails)).slice(0, 3),
            phones: Array.from(new Set(phones)).slice(0, 4),
            sourceUrl
          };
        }
      }
    }
  }

  return {
    emails: Array.from(new Set(emails)).slice(0, 3),
    phones: Array.from(new Set(phones)).slice(0, 4),
    sourceUrl
  };
}

async function scrape(url: string) {
  const data = await jsonFetch<{ data?: { markdown?: string; content?: string } }>(
    "https://api.firecrawl.dev/v1/scrape",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requireEnv("FIRECRAWL_API_KEY")}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ url, formats: ["markdown"] }),
      timeoutMs: 12_000
    }
  );
  return (data.data?.markdown || data.data?.content || "").slice(0, 7000);
}

function defaultEmailBody(company: string) {
  return [
    `Hi ${company} team,`,
    "",
    "I found your team while mapping logistics providers that sell into food, beverage, refrigerated, or time-sensitive freight.",
    "",
    "FreightTrigger sends a short weekly signal feed for reps who need a better reason to call than a stale shipper list.",
    "",
    "The feed points to companies showing freight-relevant business movement, then packages the evidence, contact route, freight read, and opener into a sales-ready record.",
    "",
    "A partial preview is here:",
    SAMPLE_URL,
    "",
    "The preview shows the format. The paid feed includes the source trail, scoring notes, buyer path, and outreach positioning.",
    "",
    "Beta is $497/month. Checkout delivers the current feed immediately, then Monday updates continue for the week ahead:",
    STRIPE_URL,
    "",
    "If this is not relevant, reply \"not a fit\" and I will suppress the address.",
    "",
    "FreightTrigger",
    "signals@getfreighttrigger.com",
    "",
    "FreightTrigger provides sales intelligence only. We do not broker freight, arrange transportation, select carriers, handle loads, manage shipments, process contracts, store shipping documents, manage invoices, or move payments between shippers and carriers."
  ].join("\n");
}

async function classifyProspect(title: string, url: string, text: string, emails: string[]) {
  const data = await jsonFetch<{ choices: Array<{ message: { content: string } }> }>(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requireEnv("OPENAI_API_KEY")}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "Return only valid JSON. Be conservative, B2B, and compliance-aware."
          },
          {
            role: "user",
            content:
              "Score this company as a possible buyer for a food/bev + reefer shipper trigger intelligence feed. " +
              "Return JSON keys: include, company_name, buyer_type, target_vertical, fit_score, reason, personalization, email_subject. " +
              "include true only for freight brokers, 3PLs, carriers, forwarders, warehousing, fulfillment, or logistics sales organizations. " +
              "Reject shippers, directories, media, load boards, job boards, and generic lists. No guaranteed lead/revenue claims. Include a soft opt-out.\n\n" +
              `Title: ${title}\nURL: ${url}\nCandidate emails: ${emails.join(", ") || "none"}\nSource text:\n${text.slice(0, 6000)}`
          }
        ]
      }),
      timeoutMs: 15_000
    }
  );
  return JSON.parse(data.choices[0]?.message.content || "{}") as ProspectAnalysis;
}

export async function acquireBuyerProspects(options: AcquisitionOptions = {}) {
  const startedAt = Date.now();
  const deadlineMs = options.deadlineMs ?? 50_000;
  const maxQueries = options.maxQueries ?? 1;
  const maxResultsPerQuery = options.maxResultsPerQuery ?? 4;
  const maxProspects = options.maxProspects ?? 4;
  const logs: string[] = [];

  const [existingProspects, suppression] = await Promise.all([
    listRecords("Broker Prospects", 100),
    listRecords("Suppression List", 100)
  ]);
  const existingWebsites = new Set(
    existingProspects.map((record) => String(record.fields.Website || "").trim().toLowerCase()).filter(Boolean)
  );
  const suppressed = new Set(
    suppression.map((record) => String(record.fields.Email || "").trim().toLowerCase()).filter(Boolean)
  );
  const seenDomains = new Set<string>();
  const prospects: Record<string, unknown>[] = [];
  const outreach: Record<string, unknown>[] = [];

  for (const query of QUERIES.slice(0, maxQueries)) {
    if (Date.now() - startedAt > deadlineMs) break;
    logs.push(`search: ${query}`);
    const results = await searchWeb(query, maxResultsPerQuery);
    const clay = clayStatus();
    logs.push(
      `radar source: ${results[0]?.source || "no-search-results"} | clay-api=${clay.apiKey ? "configured" : "not-configured"} | clay-webhook=${clay.webhookUrl ? "configured" : "not-configured"}`
    );

    for (const result of results) {
      if (Date.now() - startedAt > deadlineMs || prospects.length >= maxProspects) break;
      const url = result.link;
      const title = result.title || "Untitled result";
      if (!url) continue;
      const siteDomain = domain(url);
      const siteRoot = rootUrl(url);
      if (!siteDomain || NOISE_DOMAINS.some((noise) => siteDomain.includes(noise))) continue;
      if (seenDomains.has(siteDomain) || existingWebsites.has(siteRoot.toLowerCase())) continue;
      seenDomains.add(siteDomain);

      try {
        const pages = [];
        for (const path of CONTACT_PATHS.slice(0, 7)) {
          if (Date.now() - startedAt > deadlineMs) break;
          const contactUrl = new URL(path.replace(/^\//, ""), siteRoot.endsWith("/") ? siteRoot : `${siteRoot}/`).toString();
          const pageText = await scrape(contactUrl);
          if (pageText) pages.push({ url: contactUrl, text: pageText });
          if (pageText.length > 700 && (extractEmails(pageText, siteDomain).length || extractPhones(pageText).length)) break;
          if (Date.now() - startedAt > deadlineMs) break;
        }
        const primary = pages[0]?.text || "";
        const text = primary || (await scrape(url));
        if (text.length < 350) {
          logs.push(`skipped thin source: ${title}`);
          continue;
        }
        let contactSource = url;
        let emails = pages.flatMap((page) => extractEmails(page.text, siteDomain));
        let phones = pages.flatMap((page) => extractPhones(page.text));
        const bestPage = pages.find((page) => extractEmails(page.text, siteDomain).length || extractPhones(page.text).length);
        if (bestPage) contactSource = bestPage.url;
        if (!emails.length) {
          const discovered = await searchContactSources(title, siteRoot, siteDomain);
          emails = discovered.emails;
          phones = [...phones, ...discovered.phones];
          if (discovered.emails.length || discovered.phones.length) contactSource = discovered.sourceUrl;
        }
        emails = Array.from(new Set(emails)).slice(0, 3);
        phones = Array.from(new Set(phones)).slice(0, 4);
        const analysis = await classifyProspect(title, url, text, emails);
        const fitScore = Number(analysis.fit_score || 0);
        if (!analysis.include || fitScore < 70) {
          logs.push(`rejected: ${title} | ${analysis.reason || "low fit"}`);
          continue;
        }
        const contactEmail = (emails[0] || "").toLowerCase();
        if (contactEmail && suppressed.has(contactEmail)) {
          logs.push(`suppressed: ${title} | ${contactEmail}`);
          continue;
        }
        const company = analysis.company_name || title.slice(0, 80);
        prospects.push({
          "Company Name": company,
          Website: siteRoot,
          "Buyer Type": analysis.buyer_type || "Freight Broker / 3PL",
          "Target Vertical": analysis.target_vertical || "Food/bev + reefer",
          "Contact Email": contactEmail,
          Status: contactEmail ? "Qualified" : "Needs Contact",
          "Research Notes": [
            `Fit score: ${fitScore}`,
            `Reason: ${analysis.reason || "Qualified by scheduled acquisition."}`,
            `Personalization: ${analysis.personalization || "Lead with food/bev shipper timing intelligence."}`,
            `Source: ${url}`,
            `Public emails: ${emails.length ? emails.join(", ") : "not publicly verified"}`,
            `Public phones: ${phones.length ? phones.join(", ") : "not publicly verified"}`,
            `Contact route: ${contactSource}`
          ].join("\n")
        });
        outreach.push({
          "Email Subject": analysis.email_subject || "Food/bev shipper timing signals",
          Message: defaultEmailBody(company),
          Status: contactEmail ? "Queued" : "Needs Contact"
        });
        logs.push(`qualified: ${company} | ${contactEmail || "needs contact"}`);
      } catch (error) {
        logs.push(`skipped: ${title} | ${String(error).slice(0, 140)}`);
      }
    }
  }

  const createdProspects = await createRecords("Broker Prospects", prospects);
  const linkedOutreach = outreach
    .map((record, index) => ({
      ...record,
      Prospect: createdProspects[index] ? [createdProspects[index].id] : undefined
    }))
    .filter((record) => record.Prospect);
  const createdOutreach = await createRecords("Outreach", linkedOutreach);

  return {
    prospectsCreated: createdProspects.length,
    outreachCreated: createdOutreach.length,
    queuedWithEmail: prospects.filter((prospect) => prospect["Contact Email"]).length,
    logs
  };
}

export async function enrichBuyerProspectContacts(options: EnrichmentOptions = {}) {
  const startedAt = Date.now();
  const deadlineMs = options.deadlineMs ?? 35_000;
  const maxProspects = options.maxProspects ?? 4;
  const prospects = await listRecords("Broker Prospects", 100);
  const updates: Array<{ id: string; fields: Record<string, unknown> }> = [];
  const logs: string[] = [];
  let checked = 0;

  for (const prospect of prospects) {
    if (Date.now() - startedAt > deadlineMs || checked >= maxProspects) break;
    const fields = prospect.fields;
    if (fields["Contact Email"]) continue;
    const website = String(fields.Website || "");
    if (!website) continue;
    const siteDomain = domain(website);
    if (!siteDomain) continue;

    checked += 1;
    const company = String(fields["Company Name"] || siteDomain);
    let emails: string[] = [];
    let phones: string[] = [];
    let contactSource = website;

    for (const path of CONTACT_PATHS.slice(0, 7)) {
      if (Date.now() - startedAt > deadlineMs) break;
      const contactUrl = new URL(path.replace(/^\//, ""), website.endsWith("/") ? website : `${website}/`).toString();
      try {
        const text = await scrape(contactUrl);
        emails.push(...extractEmails(text, siteDomain));
        phones.push(...extractPhones(text));
        if (emails.length || phones.length) {
          contactSource = contactUrl;
          break;
        }
      } catch {
        logs.push(`contact scrape skipped: ${company} | ${path || "/"}`);
      }
    }

    if (!emails.length) {
      try {
        const discovered = await searchContactSources(company, website, siteDomain);
        emails.push(...discovered.emails);
        phones.push(...discovered.phones);
        if (discovered.emails.length || discovered.phones.length) contactSource = discovered.sourceUrl;
      } catch {
        logs.push(`contact search skipped: ${company}`);
      }
    }

    emails = Array.from(new Set(emails)).slice(0, 3);
    phones = Array.from(new Set(phones)).slice(0, 4);
    if (!emails.length && !phones.length) {
      const clayResult = await sendClayEnrichmentRequest({
        airtableRecordId: prospect.id,
        companyName: company,
        website,
        sourceUrl: website,
        reason: "No direct public email or phone found during FreightTrigger contact enrichment."
      });
      updates.push({
        id: prospect.id,
        fields: {
          Status: "Needs Contact",
          "Research Notes": [
            String(fields["Research Notes"] || "").trim(),
            `Clay enrichment: ${clayResult.status} | ${clayResult.note}`
          ]
            .filter(Boolean)
            .join("\n")
        }
      });
      logs.push(`needs contact route: ${company} | clay=${clayResult.status}`);
      continue;
    }

    const clayResult =
      emails.length < 2 && phones.length < 1
        ? await sendClayEnrichmentRequest({
            airtableRecordId: prospect.id,
            companyName: company,
            website,
            email: emails[0],
            phone: phones[0],
            sourceUrl: contactSource,
            reason: "Public contact route exists but confidence is thin; request secondary enrichment."
          })
        : null;

    updates.push({
      id: prospect.id,
      fields: {
        "Contact Email": emails[0] || "",
        Status: emails[0] ? "Qualified" : "Needs Contact",
        "Research Notes": [
          String(fields["Research Notes"] || "").trim(),
          `Contact enrichment route: ${contactSource}`,
          `Public emails: ${emails.length ? emails.join(", ") : "not publicly verified"}`,
          `Public phones: ${phones.length ? phones.join(", ") : "not publicly verified"}`,
          clayResult ? `Clay enrichment: ${clayResult.status} | ${clayResult.note}` : ""
        ]
          .filter(Boolean)
          .join("\n")
      }
    });
    logs.push(`enriched: ${company} | ${emails[0] || "no email"} | phones=${phones.length}`);
  }

  const updated = await patchRecords("Broker Prospects", updates);
  return {
    checked,
    updated: updated.length,
    emailQualified: updates.filter((record) => record.fields["Contact Email"]).length,
    logs
  };
}
