import { listRecords, patchRecords } from "./airtable";
import { sendGmailMessage } from "./gmail";
import { optionalEnv } from "./local-env";
import { inBusinessWindow } from "./time";

function outreachEnabled() {
  return optionalEnv("OUTREACH_ENABLED", "OUTREACHENABLED").toLowerCase() === "true";
}

function maxSendsPerRun() {
  const raw = optionalEnv("OUTREACH_MAX_SENDS_PER_RUN", "OUTREACHMAXSENDSPERRUN");
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 3;
  return Math.max(1, Math.min(10, Math.floor(parsed)));
}

const BAD_SOURCE_DOMAINS = [
  "foodlogistics.com",
  "usda.gov",
  "carriersource.io",
  "nfraweb.org",
  "pdfcoffee.com",
  "scribd.com"
];

function host(value: unknown) {
  try {
    return new URL(String(value || "")).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function emailHost(email: string) {
  return email.includes("@") ? email.split("@").pop() || "" : "";
}

function domainsMatch(email: string, website: unknown) {
  const mailHost = emailHost(email).toLowerCase().replace(/^www\./, "");
  const siteHost = host(website);
  if (!mailHost || !siteHost) return false;
  return mailHost === siteHost || mailHost.endsWith(`.${siteHost}`) || siteHost.endsWith(`.${mailHost}`);
}

function badSource(prospect: Record<string, unknown>) {
  const haystack = `${String(prospect.Website || "")}\n${String(prospect["Research Notes"] || "")}`.toLowerCase();
  return BAD_SOURCE_DOMAINS.some((domain) => haystack.includes(domain)) || haystack.includes("ceo gate: rejected");
}

export async function sendQueuedOutreach({ force = false } = {}) {
  if (!outreachEnabled()) {
    return {
      sent: 0,
      skipped: "outreach disabled; set OUTREACHENABLED=true only after buyer-flow approval"
    };
  }

  const now = new Date();
  if (!force && !inBusinessWindow(now)) {
    return {
      sent: 0,
      skipped: "outside business-hour sending window"
    };
  }

  const [prospects, outreach, suppression] = await Promise.all([
    listRecords("Broker Prospects", 100),
    listRecords("Outreach", 100),
    listRecords("Suppression List", 100)
  ]);

  const prospectsById = new Map(prospects.map((record) => [record.id, record]));
  const suppressed = new Set(
    suppression.map((record) => String(record.fields.Email || "").trim().toLowerCase()).filter(Boolean)
  );
  const queued = outreach.filter((record) => record.fields.Status === "Queued");

  const updates: Array<{ id: string; fields: Record<string, unknown> }> = [];
  const sentTo: string[] = [];
  const maxSends = maxSendsPerRun();

  for (const record of queued) {
    const prospectId = (record.fields.Prospect as string[] | undefined)?.[0];
    const prospect = prospectId ? prospectsById.get(prospectId) : undefined;
    const email = String(prospect?.fields["Contact Email"] || "").trim().toLowerCase();
    if (!email || suppressed.has(email)) continue;
    if (prospect?.fields.Status !== "Qualified") continue;
    if (badSource(prospect.fields)) continue;
    if (!domainsMatch(email, prospect.fields.Website)) continue;

    await sendGmailMessage(
      email,
      String(record.fields["Email Subject"] || "Food/bev freight demand signals"),
      String(record.fields.Message || "")
    );

    sentTo.push(email);
    updates.push({
      id: record.id,
      fields: {
        Status: "Sent",
        "Sent Date": now.toISOString()
      }
    });

    if (sentTo.length >= maxSends) break;
  }

  await patchRecords("Outreach", updates);

  return {
    sent: sentTo.length,
    maxSends,
    sentTo
  };
}
