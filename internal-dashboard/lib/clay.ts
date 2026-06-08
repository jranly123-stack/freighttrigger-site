import { optionalEnv } from "./local-env";

type ClayInput = {
  airtableRecordId: string;
  companyName: string;
  website: string;
  email?: string;
  phone?: string;
  sourceUrl?: string;
  reason: string;
};

type ClayResult = {
  status: "sent" | "not-configured" | "failed";
  note: string;
};

async function jsonFetch<T>(url: string, init?: RequestInit & { timeoutMs?: number }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init?.timeoutMs ?? 15_000);
  const { timeoutMs: _timeoutMs, ...fetchInit } = init ?? {};

  try {
    const response = await fetch(url, { ...fetchInit, signal: controller.signal, cache: "no-store" });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${response.status}: ${text.slice(0, 180)}`);
    }
    if (!text) {
      return {} as T;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      return { raw: text } as T;
    }
  } finally {
    clearTimeout(timeout);
  }
}

export function clayStatus() {
  return {
    apiKey: Boolean(optionalEnv("CLAYAPIKEY", "CLAY_API_KEY")),
    webhookUrl: Boolean(optionalEnv("CLAYWEBHOOKURL", "CLAY_WEBHOOK_URL"))
  };
}

export async function sendClayEnrichmentRequest(input: ClayInput): Promise<ClayResult> {
  const webhookUrl = optionalEnv("CLAYWEBHOOKURL", "CLAY_WEBHOOK_URL");

  if (!webhookUrl) {
    return {
      status: "not-configured",
      note:
        "Clay API key detected only as workspace credential. Add CLAYWEBHOOKURL after creating a Clay webhook table/workflow for automated enrichment return."
    };
  }

  try {
    await jsonFetch<Record<string, unknown>>(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        source: "FreightTrigger",
        requested_at: new Date().toISOString(),
        record_type: "broker_prospect",
        ...input
      }),
      timeoutMs: 18_000
    });
    return {
      status: "sent",
      note: `Clay enrichment requested for ${input.companyName}. Await workflow return/update.`
    };
  } catch (error) {
    return {
      status: "failed",
      note: `Clay enrichment request failed: ${String(error).slice(0, 180)}`
    };
  }
}
