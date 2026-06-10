import { requireEnv } from "./local-env";
import { searchWeb, type SearchResult } from "./search";

const QUERIES = [
  "food distributor expansion distribution center refrigerated 2026",
  "beverage distributor new warehouse expansion 2026",
  "food company hiring logistics transportation coordinator 2026"
];

const NOISE_DOMAINS = [
  "linkedin.com/jobs",
  "indeed.com",
  "ziprecruiter.com",
  "simplyhired.com",
  "glassdoor.com"
];

export type Candidate = {
  company?: string;
  trigger_summary?: string;
  likely_freight_need?: string;
  buyer_path?: string;
  outreach_angle?: string;
  urgency_score?: number;
  confidence_score?: number;
  freight_relevance?: string;
  include?: boolean;
  reason?: string;
  source_title: string;
  source_url: string;
  query: string;
};

type EngineOptions = {
  maxQueries?: number;
  maxResultsPerQuery?: number;
  deadlineMs?: number;
};

type Extraction = {
  text: string;
  source: "firecrawl" | "direct-fetch" | "search-snippet";
  quality: "full" | "fallback" | "thin";
  warning?: string;
};

async function jsonFetch<T>(url: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init?.timeoutMs ?? 15_000);
  const { timeoutMs: _timeoutMs, ...fetchInit } = init ?? {};

  let response: Response;
  try {
    response = await fetch(url, { ...fetchInit, signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status}: ${text.slice(0, 220)}`);
  }
  return response.json() as Promise<T>;
}

async function scrapeWithFirecrawl(url: string) {
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
  return (data.data?.markdown || data.data?.content || "").slice(0, 6000);
}

function htmlToText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

async function directFetchText(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "User-Agent": "Mozilla/5.0 FreightTrigger signal validation bot; public-source review"
      }
    });
    if (!response.ok) throw new Error(`${response.status}: direct fetch failed`);
    const html = await response.text();
    return htmlToText(html).slice(0, 6000);
  } finally {
    clearTimeout(timeout);
  }
}

async function extractSource(result: SearchResult): Promise<Extraction> {
  const url = result.link || "";
  const snippet = `${result.title || ""}\n${result.snippet || ""}`.trim();

  try {
    const text = await scrapeWithFirecrawl(url);
    return { text, source: "firecrawl", quality: text.length >= 1200 ? "full" : "fallback" };
  } catch (firecrawlError) {
    const warning = `firecrawl_failed: ${String(firecrawlError).slice(0, 140)}`;
    try {
      const text = await directFetchText(url);
      if (text.length >= 300) {
        return { text, source: "direct-fetch", quality: "fallback", warning };
      }
    } catch {
      // Keep moving to snippet fallback. Vendor/source failure must not kill the run.
    }

    if (snippet.length >= 80) {
      return { text: snippet, source: "search-snippet", quality: "thin", warning };
    }
    throw new Error(warning);
  }
}

async function classify(title: string, url: string, text: string): Promise<Omit<Candidate, "source_title" | "source_url" | "query">> {
  const data = await jsonFetch<{
    choices: Array<{ message: { content: string } }>;
  }>("https://api.openai.com/v1/chat/completions", {
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
          content: "Return only valid JSON. Use cautious language. Do not claim verified buyer intent."
        },
        {
          role: "user",
          content:
            "You are FreightTrigger's shipper signal scoring agent. Classify this public source for food/bev or reefer-adjacent logistics sales relevance. " +
            "Return strict JSON with keys: company, trigger_summary, likely_freight_need, buyer_path, outreach_angle, urgency_score, confidence_score, freight_relevance, include, reason.\n\n" +
            "Rules: urgency_score and confidence_score must be integers from 0 to 100. freight_relevance must be High, Medium, or Low. include must be true only when the source points to a specific company/account with a plausible current logistics change window. Reject generic articles, login pages, broad industry statistics, and job aggregator pages. If source text is thin or only a search snippet, use lower confidence and include only when the evidence still identifies a specific company and change event.\n\n" +
            `Title: ${title}\nURL: ${url}\nSource text:\n${text}`
        }
      ]
    }),
    timeoutMs: 15_000
  });

  return JSON.parse(data.choices[0]?.message.content || "{}");
}

export async function runEngine(options: EngineOptions = {}) {
  const startedAt = Date.now();
  const deadlineMs = options.deadlineMs ?? 52_000;
  const maxQueries = options.maxQueries ?? QUERIES.length;
  const maxResultsPerQuery = options.maxResultsPerQuery ?? 5;
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  const logs: string[] = [];

  for (const query of QUERIES.slice(0, maxQueries)) {
    if (Date.now() - startedAt > deadlineMs) {
      logs.push("stopped: engine deadline reached before next query");
      break;
    }

    const results = await searchWeb(query, maxResultsPerQuery);
    logs.push(`radar: ${query} | ${results[0]?.source || "no-search-results"}`);
    for (const result of results) {
      if (Date.now() - startedAt > deadlineMs) {
        logs.push("stopped: engine deadline reached before next source");
        break;
      }

      const url = result.link;
      const title = result.title || "Untitled source";
      if (!url || seen.has(url)) continue;
      if (NOISE_DOMAINS.some((domain) => url.includes(domain))) continue;
      seen.add(url);

      try {
        const extraction = await extractSource(result);
        const text = extraction.text;
        if (text.length < 300 && extraction.source !== "search-snippet") {
          logs.push(`skipped: ${title} | too little extractable text`);
          continue;
        }
        const analysis = await classify(title, url, text);
        if (extraction.source === "search-snippet") {
          analysis.confidence_score = Math.min(Number(analysis.confidence_score || 0), 62);
          analysis.reason = `${analysis.reason || "Snippet-only source."} Evidence quality capped because Firecrawl/direct extraction failed.`;
        } else if (extraction.source === "direct-fetch") {
          analysis.confidence_score = Math.min(Number(analysis.confidence_score || 0), 72);
          analysis.reason = `${analysis.reason || "Direct fetch fallback."} Firecrawl unavailable; evidence requires operator review before client delivery.`;
        }
        if (!analysis.include) {
          logs.push(`rejected: ${title}`);
          continue;
        }
        candidates.push({ ...analysis, source_title: title, source_url: url, query });
        logs.push(`scored: ${title} | extraction=${extraction.source} | quality=${extraction.quality}${extraction.warning ? ` | ${extraction.warning}` : ""}`);
      } catch (error) {
        logs.push(`skipped: ${title} | ${String(error).slice(0, 160)}`);
      }
    }
  }

  return {
    ranAt: new Date().toISOString(),
    count: candidates.length,
    logs,
    candidates
  };
}
