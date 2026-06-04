import { requireEnv } from "./local-env";

type AirtableRecord = {
  id: string;
  fields: Record<string, unknown>;
};

const TABLES = [
  "Companies",
  "Signals",
  "Scores",
  "Broker Prospects",
  "Outreach",
  "Replies",
  "Clients",
  "Reports",
  "Suppression List"
];

function baseUrl(table: string) {
  const base = requireEnv("AIRTABLE_BASE_ID");
  return `https://api.airtable.com/v0/${base}/${encodeURIComponent(table)}`;
}

async function airtableFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const token = requireEnv("AIRTABLE_API_TOKEN");
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Airtable ${response.status}: ${text.slice(0, 240)}`);
  }

  return response.json() as Promise<T>;
}

export async function listRecords(table: string, maxRecords = 100) {
  const url = `${baseUrl(table)}?pageSize=${Math.min(maxRecords, 100)}`;
  const data = await airtableFetch<{ records: AirtableRecord[] }>(url);
  return data.records ?? [];
}

export async function getSummary() {
  const entries = await Promise.all(
    TABLES.map(async (table) => [table, (await listRecords(table)).length] as const)
  );
  return Object.fromEntries(entries);
}

export async function getSignalRows() {
  const [companies, signals, scores] = await Promise.all([
    listRecords("Companies"),
    listRecords("Signals"),
    listRecords("Scores")
  ]);

  const companiesById = new Map(companies.map((record) => [record.id, record]));
  const scoresByCompanyId = new Map<string, AirtableRecord>();

  for (const score of scores) {
    const links = score.fields.Company as string[] | undefined;
    if (links?.[0]) scoresByCompanyId.set(links[0], score);
  }

  return signals.map((signal) => {
    const companyId = (signal.fields.Company as string[] | undefined)?.[0];
    const company = companyId ? companiesById.get(companyId) : undefined;
    const score = companyId ? scoresByCompanyId.get(companyId) : undefined;
    return {
      id: signal.id,
      company: String(company?.fields["Company Name"] ?? "Unknown account"),
      vertical: String(company?.fields.Vertical ?? ""),
      location: String(company?.fields.Location ?? ""),
      trigger: String(signal.fields["Trigger Summary"] ?? ""),
      evidenceUrl: String(signal.fields["Evidence URL"] ?? ""),
      urgency: Number(score?.fields["Urgency Score"] ?? 0),
      confidence: Number(score?.fields["Confidence Score"] ?? 0),
      relevance: String(score?.fields["Freight Relevance"] ?? "Unscored")
    };
  });
}
