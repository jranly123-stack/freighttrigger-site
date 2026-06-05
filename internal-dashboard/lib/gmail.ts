import { requireEnv } from "./local-env";

const FROM_EMAIL = "signals@getfreighttrigger.com";

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status}: ${text.slice(0, 220)}`);
  }
  return response.json() as Promise<T>;
}

function base64Url(input: string) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function refreshGmailAccessToken() {
  const params = new URLSearchParams({
    client_id: requireEnv("GOOGLE_CLIENT_ID"),
    client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
    refresh_token: requireEnv("GMAIL_REFRESH_TOKEN"),
    grant_type: "refresh_token"
  });

  const data = await jsonFetch<{ access_token: string }>("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString()
  });

  return data.access_token;
}

export async function sendGmailMessage(to: string, subject: string, body: string) {
  const token = await refreshGmailAccessToken();
  const mime = [
    `To: ${to}`,
    `From: ${FROM_EMAIL}`,
    `Reply-To: ${FROM_EMAIL}`,
    `Subject: ${subject}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    body
  ].join("\r\n");

  return jsonFetch<{ id: string }>("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ raw: base64Url(mime) })
  });
}

type GmailHeader = {
  name: string;
  value: string;
};

type GmailPart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
};

export type GmailMessage = {
  id: string;
  threadId: string;
  snippet?: string;
  payload?: {
    headers?: GmailHeader[];
    body?: { data?: string };
    parts?: GmailPart[];
  };
};

function decodeBody(data = "") {
  if (!data) return "";
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function bodyFromParts(parts: GmailPart[] = []): string {
  for (const part of parts) {
    if (part.mimeType === "text/plain" && part.body?.data) return decodeBody(part.body.data);
    const nested = bodyFromParts(part.parts);
    if (nested) return nested;
  }
  return "";
}

export function headerValue(message: GmailMessage, name: string) {
  return (
    message.payload?.headers?.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value || ""
  );
}

export function messageBody(message: GmailMessage) {
  return decodeBody(message.payload?.body?.data) || bodyFromParts(message.payload?.parts) || message.snippet || "";
}

export function emailFromHeader(header: string) {
  const match = header.match(/<([^>]+)>/);
  return (match?.[1] || header).trim().toLowerCase();
}

export async function listGmailMessages(query: string, maxResults = 10) {
  const token = await refreshGmailAccessToken();
  const params = new URLSearchParams({
    q: query,
    maxResults: String(maxResults)
  });
  const data = await jsonFetch<{ messages?: Array<{ id: string; threadId: string }> }>(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );
  return data.messages ?? [];
}

export async function getGmailMessage(id: string) {
  const token = await refreshGmailAccessToken();
  return jsonFetch<GmailMessage>(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`,
    {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );
}
