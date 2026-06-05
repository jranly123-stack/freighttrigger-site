import { requireEnv } from "./local-env";

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

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status}: ${text.slice(0, 220)}`);
  }
  return response.json() as Promise<T>;
}

async function serpSearch(query: string) {
  const params = new URLSearchParams({
    engine: "google",
    q: query,
    api_key: requireEnv("SERPAPI_API_KEY"),
    num: "5"
  });
  const data = await jsonFetch<{ organic_results?: Array<{ title?: string; link?: string }> }>(
    `https://serpapi.com/search.json?${params.toString()}`
  );
  return data.organic_results?.slice(0, 5) ?? [];
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
      body: JSON.stringify({ url, formats: ["markdown"] })
    }
  );
  return (data.data?.markdown || data.data?.content || "").slice(0, 6000);
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
            "Rules: urgency_score and confidence_score must be integers from 0 to 100. freight_relevance must be High, Medium, or Low. include must be true only when the source points to a specific company/account with a plausible current logistics change window. Reject generic articles, login pages, broad industry statistics, and job aggregator pages.\n\n" +
            `Title: ${title}\nURL: ${url}\nSource text:\n${text}`
        }
      ]
    })
  });

  return JSON.parse(data.choices[0]?.message.content || "{}");
}

export async function runEngine() {
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  const logs: string[] = [];

  for (const query of QUERIES) {
    const results = await serpSearch(query);
    for (const result of results) {
      const url = result.link;
      const title = result.title || "Untitled source";
      if (!url || seen.has(url)) continue;
      if (NOISE_DOMAINS.some((domain) => url.includes(domain))) continue;
      seen.add(url);

      try {
        const text = await scrape(url);
        if (text.length < 300) {
          logs.push(`skipped: ${title} | too little extractable text`);
          continue;
        }
        const analysis = await classify(title, url, text);
        if (!analysis.include) {
          logs.push(`rejected: ${title}`);
          continue;
        }
        candidates.push({ ...analysis, source_title: title, source_url: url, query });
        logs.push(`scored: ${title}`);
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
