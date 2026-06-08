import { optionalEnv } from "./local-env";

export type SearchResult = {
  title?: string;
  link?: string;
  snippet?: string;
  source: "dataforseo" | "serpapi";
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

function dataForSeoAuth() {
  const login = optionalEnv("DATAFORSEOLOGIN", "DATAFORSEO_LOGIN");
  const password = optionalEnv("DATAFORSEOPASSWORD", "DATAFORSEO_PASSWORD");
  if (!login || !password) return "";
  return `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`;
}

async function dataForSeoSearch(query: string, maxResults: number): Promise<SearchResult[]> {
  const auth = dataForSeoAuth();
  if (!auth) return [];

  const data = await jsonFetch<{
    tasks?: Array<{
      result?: Array<{
        items?: Array<{
          type?: string;
          title?: string;
          url?: string;
          description?: string;
        }>;
      }>;
    }>;
  }>("https://api.dataforseo.com/v3/serp/google/organic/live/advanced", {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json"
    },
    body: JSON.stringify([
      {
        keyword: query,
        location_code: 2840,
        language_code: "en",
        device: "desktop",
        depth: Math.max(10, maxResults)
      }
    ]),
    timeoutMs: 18_000
  });

  const items = data.tasks?.[0]?.result?.[0]?.items ?? [];
  return items
    .filter((item) => item.type === "organic" && item.url)
    .slice(0, maxResults)
    .map((item) => ({
      title: item.title,
      link: item.url,
      snippet: item.description,
      source: "dataforseo" as const
    }));
}

async function serpApiSearch(query: string, maxResults: number): Promise<SearchResult[]> {
  const apiKey = optionalEnv("SERPAPI_API_KEY");
  if (!apiKey) return [];

  const params = new URLSearchParams({
    engine: "google",
    q: query,
    api_key: apiKey,
    num: String(maxResults)
  });
  const data = await jsonFetch<{ organic_results?: Array<{ title?: string; link?: string; snippet?: string }> }>(
    `https://serpapi.com/search.json?${params.toString()}`,
    { timeoutMs: 8_000 }
  );
  return (data.organic_results ?? []).slice(0, maxResults).map((item) => ({
    ...item,
    source: "serpapi" as const
  }));
}

export async function searchWeb(query: string, maxResults: number): Promise<SearchResult[]> {
  const hasDataForSeo = Boolean(dataForSeoAuth());
  if (hasDataForSeo) {
    try {
      const results = await dataForSeoSearch(query, maxResults);
      if (results.length) return results;
    } catch {
      // Fall back to SerpAPI when configured. The caller logs source-level outcomes.
    }
  }

  const results = await serpApiSearch(query, maxResults);
  if (results.length) return results;
  if (hasDataForSeo) return dataForSeoSearch(query, maxResults);
  return [];
}

export function clayConfigured() {
  return Boolean(optionalEnv("CLAYAPIKEY", "CLAY_API_KEY"));
}
