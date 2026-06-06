import { requireEnv } from "./local-env";
import type { Candidate } from "./engine";

export type AirtableRecord = {
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

export async function createRecords(table: string, records: Array<Record<string, unknown>>) {
  if (!records.length) return [];
  const created: AirtableRecord[] = [];

  for (let index = 0; index < records.length; index += 10) {
    const batch = records.slice(index, index + 10);
    const data = await airtableFetch<{ records: AirtableRecord[] }>(baseUrl(table), {
      method: "POST",
      body: JSON.stringify({
        typecast: true,
        records: batch.map((fields) => ({ fields }))
      })
    });
    created.push(...(data.records ?? []));
  }

  return created;
}

export async function patchRecords(table: string, records: Array<{ id: string; fields: Record<string, unknown> }>) {
  if (!records.length) return [];
  const updated: AirtableRecord[] = [];

  for (let index = 0; index < records.length; index += 10) {
    const batch = records.slice(index, index + 10);
    const data = await airtableFetch<{ records: AirtableRecord[] }>(baseUrl(table), {
      method: "PATCH",
      body: JSON.stringify({
        typecast: true,
        records: batch
      })
    });
    updated.push(...(data.records ?? []));
  }

  return updated;
}

function scoreValue(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function candidateKey(candidate: Candidate) {
  return String(candidate.source_url || "").trim().toLowerCase();
}

export async function createReviewCandidates(candidates: Candidate[]) {
  const existingSignals = await listRecords("Signals", 100);
  const existingUrls = new Set(
    existingSignals
      .map((record) => String(record.fields["Evidence URL"] || "").trim().toLowerCase())
      .filter(Boolean)
  );

  const reviewCandidates = candidates
    .filter((candidate) => candidate.include !== false)
    .filter((candidate) => candidateKey(candidate))
    .filter((candidate) => !existingUrls.has(candidateKey(candidate)))
    .filter(
      (candidate) =>
        scoreValue(candidate.urgency_score) >= 70 &&
        scoreValue(candidate.confidence_score) >= 65
    )
    .slice(0, 10);

  const companyRecords = reviewCandidates.map((candidate) => ({
    "Company Name": String(candidate.company || "Unknown account"),
    "Website": String(candidate.source_url || ""),
    "Vertical": "Food/bev and reefer-adjacent",
    "Location": "Review required",
    "Status": "Candidate"
  }));

  const createdCompanies = await createRecords("Companies", companyRecords);

  const signalRecords = reviewCandidates.map((candidate, index) => ({
    "Trigger Summary": String(candidate.trigger_summary || candidate.source_title),
    "Company": [createdCompanies[index].id],
    "Trigger Type": "Other",
    "Evidence URL": String(candidate.source_url),
    "Detected Date": new Date().toISOString().slice(0, 10),
    "Status": "Review"
  }));

  const scoreRecords = reviewCandidates.map((candidate, index) => ({
    "Urgency Score": scoreValue(candidate.urgency_score),
    "Confidence Score": scoreValue(candidate.confidence_score),
    "Freight Relevance": String(candidate.freight_relevance || "Medium"),
    "Notes": [
      `Likely need: ${candidate.likely_freight_need || "Review required"}`,
      `Buyer path: ${candidate.buyer_path || "Review required"}`,
      `Outreach angle: ${candidate.outreach_angle || "Review required"}`,
      `Automated source: ${candidate.source_title}`,
      "Status: review candidate; not approved for client delivery."
    ].join("\n"),
    "Company": [createdCompanies[index].id]
  }));

  await createRecords("Signals", signalRecords);
  await createRecords("Scores", scoreRecords);

  await createRecords("Reports", [
    {
      "Report Name": `Automated Signal Scan - ${new Date().toISOString().slice(0, 10)}`,
      "Report Period": new Date().toISOString().slice(0, 10),
      "Status": "Draft"
    }
  ]);

  return {
    created: reviewCandidates.length,
    skippedDuplicateOrLowScore: candidates.length - reviewCandidates.length
  };
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

  function noteValue(notes: string, label: string) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = notes.match(new RegExp(`${escaped}:\\s*([^\\n]+)`, "i"));
    return match?.[1]?.trim() || "";
  }

  function contactPath(companyName: string, website: string, notes: string, buyerPath: string) {
    const enriched = noteValue(notes, "Contact path");
    if (enriched) return enriched;

    const contactUrl = website ? `${website.replace(/\/$/, "")}/contact` : "Public contact route required";
    const linkedInQuery = encodeURIComponent(`${companyName} logistics manager transportation manager operations director`);
    return [
      `Primary roles: ${buyerPath || "logistics, transportation, operations, supply chain, or facility-level distribution leadership"}`,
      `Public route: ${contactUrl}`,
      `LinkedIn/search path: https://www.google.com/search?q=${linkedInQuery}`,
      "Direct email/phone: include only when verified by enrichment; do not invent."
    ].join(" | ");
  }

  return signals.map((signal) => {
    const companyId = (signal.fields.Company as string[] | undefined)?.[0];
    const company = companyId ? companiesById.get(companyId) : undefined;
    const score = companyId ? scoresByCompanyId.get(companyId) : undefined;
    const notes = String(score?.fields.Notes ?? "");
    const companyName = String(company?.fields["Company Name"] ?? "Unknown account");
    const website = String(company?.fields.Website ?? "");
    const buyerPath = noteValue(notes, "Buyer path");
    return {
      id: signal.id,
      company: companyName,
      website,
      vertical: String(company?.fields.Vertical ?? ""),
      location: String(company?.fields.Location ?? ""),
      trigger: String(signal.fields["Trigger Summary"] ?? ""),
      evidenceUrl: String(signal.fields["Evidence URL"] ?? ""),
      urgency: Number(score?.fields["Urgency Score"] ?? 0),
      confidence: Number(score?.fields["Confidence Score"] ?? 0),
      relevance: String(score?.fields["Freight Relevance"] ?? "Unscored"),
      likelyNeed: noteValue(notes, "Likely need"),
      buyerPath,
      contactPath: contactPath(companyName, website, notes, buyerPath),
      outreachAngle: noteValue(notes, "Outreach angle")
    };
  });
}
