import { createRecords, listRecords } from "./airtable";
import { requireEnv } from "./local-env";

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

async function serpSearch(query: string, maxResults: number) {
  const params = new URLSearchParams({
    engine: "google",
    q: query,
    api_key: requireEnv("SERPAPI_API_KEY"),
    num: String(maxResults)
  });
  const data = await jsonFetch<{ organic_results?: Array<{ title?: string; link?: string }> }>(
    `https://serpapi.com/search.json?${params.toString()}`,
    { timeoutMs: 8_000 }
  );
  return data.organic_results?.slice(0, maxResults) ?? [];
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
    "FreightTrigger is a weekly shipper trigger intelligence feed for logistics sales teams.",
    "",
    "Instead of another stale shipper list, the feed highlights companies showing freight-relevant business movement and packages the why, likely freight read, buyer path, and outreach angle.",
    "",
    `Sample feed: ${SAMPLE_URL}`,
    "",
    "Beta is $497/month and includes weekly signal records with evidence URLs, likely freight need, buyer path, outreach angle, and urgency/confidence scoring.",
    "",
    `Subscribe: ${STRIPE_URL}`,
    "",
    "If this is not relevant, reply not a fit and I will suppress the address.",
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
              "Return JSON keys: include, company_name, buyer_type, target_vertical, fit_score, reason, personalization, email_subject, email_body. " +
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
    const results = await serpSearch(query, maxResultsPerQuery);

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
        const text = await scrape(url);
        if (text.length < 350) {
          logs.push(`skipped thin source: ${title}`);
          continue;
        }
        const emails = extractEmails(text, siteDomain);
        const phones = extractPhones(text);
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
            `Contact route: ${siteRoot}/contact`
          ].join("\n")
        });
        outreach.push({
          "Email Subject": analysis.email_subject || "Food/bev shipper timing signals",
          Message: analysis.email_body || defaultEmailBody(company),
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
