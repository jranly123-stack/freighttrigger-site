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
