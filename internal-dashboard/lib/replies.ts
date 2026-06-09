import { createRecords, listRecords, patchRecords, type AirtableRecord } from "./airtable";
import {
  emailFromHeader,
  getGmailMessage,
  headerValue,
  listGmailMessages,
  messageBody,
  sendGmailMessage
} from "./gmail";
import { optionalEnv } from "./local-env";
import { inBusinessWindow } from "./time";

const SAMPLE_URL = "https://getfreighttrigger.com/sample-feed";
const CHECKOUT_URL = "https://buy.stripe.com/14A8wO6R4df565JbjYfAc00";
const FROM_EMAIL = "signals@getfreighttrigger.com";
const MAX_AUTO_REPLIES = 3;
const MAX_WARM_FOLLOWUPS = 5;
const CONVERSION_TAG = "[conversion-response:";
const VENDOR_NOISE_DOMAINS = [
  "airtable.com",
  "clay.com",
  "dataforseo.com",
  "digitalocean.com",
  "firecrawl.dev",
  "github.com",
  "google.com",
  "googleworkspace.com",
  "login.gov",
  "namecheap.com",
  "openai.com",
  "sam.gov",
  "serpapi.com",
  "stripe.com",
  "vercel.com"
];

type ReplyIntent = "Interested" | "Needs Info" | "Follow-up" | "Not Interested" | "Unsubscribe" | "Bad Fit";

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function emailDomain(email: string) {
  return email.includes("@") ? email.split("@").pop()?.toLowerCase() || "" : "";
}

function isVendorNoise(from: string, subject = "", body = "") {
  const domain = emailDomain(from);
  const text = `${from}\n${subject}\n${body}`.toLowerCase();
  return (
    VENDOR_NOISE_DOMAINS.some((noiseDomain) => domain === noiseDomain || domain.endsWith(`.${noiseDomain}`)) ||
    /(^no-?reply|donotreply|verify your account|billing|invoice|security alert|new sign-in|workspace|api key|onboarding|trial|receipt|password reset|one-time password|confirm your email)/.test(
      text
    )
  );
}

function classifyByRules(text: string): ReplyIntent | undefined {
  const lower = text.toLowerCase();
  if (/(unsubscribe|remove me|do not email|don't email|stop emailing|opt out)/.test(lower)) {
    return "Unsubscribe";
  }
  if (/(not interested|no thanks|no thank you|not a fit|wrong person)/.test(lower)) {
    return lower.includes("wrong person") ? "Bad Fit" : "Not Interested";
  }
  if (/(how much|price|pricing|what.*include|details|territory|coverage|more info|more information)/.test(lower)) {
    return "Needs Info";
  }
  if (/(send|share|show|see|sample|example|report|feed|interested|tell me more|more info)/.test(lower)) {
    return lower.includes("later") ? "Follow-up" : "Interested";
  }
  if (/(later|next week|next month|circle back|follow up)/.test(lower)) {
    return "Follow-up";
  }
  return undefined;
}

async function classifyWithOpenAI(subject: string, body: string): Promise<ReplyIntent> {
  const ruleIntent = classifyByRules(`${subject}\n${body}`);
  if (ruleIntent) return ruleIntent;

  const key = optionalEnv("OPENAI_API_KEY");
  if (!key) return "Needs Info";

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content:
            "Classify a B2B sales reply into one label only: Interested, Needs Info, Follow-up, Not Interested, Unsubscribe, Bad Fit."
        },
        {
          role: "user",
          content: `Subject: ${subject}\n\nReply:\n${body.slice(0, 3000)}`
        }
      ],
      max_output_tokens: 10
    })
  });

  if (!response.ok) return "Needs Info";
  const data = (await response.json()) as { output_text?: string };
  const label = String(data.output_text || "").trim();
  if (
    ["Interested", "Needs Info", "Follow-up", "Not Interested", "Unsubscribe", "Bad Fit"].includes(label)
  ) {
    return label as ReplyIntent;
  }
  return "Needs Info";
}

function linkWithContext(url: string, intent: ReplyIntent, email: string) {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}utm_source=gmail&utm_medium=reply&utm_campaign=${encodeURIComponent(
    intent.toLowerCase().replace(/\s+/g, "-")
  )}&contact=${encodeURIComponent(email)}`;
}

function inferQuestionAsked(subject: string, body: string) {
  const text = `${subject}\n${body}`.replace(/\s+/g, " ").trim();
  const question = text.match(/[^.!?]*\?/)?.[0]?.trim();
  if (question) return question.slice(0, 260);

  const lower = text.toLowerCase();
  if (lower.includes("price") || lower.includes("cost") || lower.includes("how much")) {
    return "Pricing / cost clarity";
  }
  if (lower.includes("include") || lower.includes("what do") || lower.includes("details")) {
    return "Product inclusion clarity";
  }
  if (lower.includes("sample") || lower.includes("example") || lower.includes("preview")) {
    return "Sample / proof request";
  }
  return "General information request";
}

function inferObjectionCategory(subject: string, body: string) {
  const lower = `${subject}\n${body}`.toLowerCase();
  if (/(price|cost|expensive|budget|too much)/.test(lower)) return "price";
  if (/(trust|proof|real|source|accurate|verify|verified)/.test(lower)) return "trust/data";
  if (/(fit|vertical|industry|territory|region|service)/.test(lower)) return "fit";
  if (/(how|what|include|details|sample|example|preview)/.test(lower)) return "clarity";
  return "unknown";
}

function buildNeedsInfoReply(context: { from: string }) {
  const sampleUrl = linkWithContext(SAMPLE_URL, "Needs Info", context.from);
  const checkoutUrl = linkWithContext(CHECKOUT_URL, "Needs Info", context.from);

  return [
    "Good question.",
    "",
    "FreightTrigger is a weekly shipper-timing feed for logistics sales teams. It is built to answer: who has a current business event worth contacting, why the timing matters, what freight angle fits, and what first touch should say.",
    "",
    "Preview:",
    sampleUrl,
    "",
    "The preview shows the structure. The paid beta feed includes current account records, source context, freight read, contact route, scoring notes, and sales positioning.",
    "",
    "Current beta:",
    "$497/month. Checkout delivers the current feed immediately, then Monday updates continue each week:",
    checkoutUrl,
    "",
    "If you want a direct answer before checkout, reply with the specific lane, region, or customer type your team sells into and I will tell you whether the beta feed fits.",
    "",
    "FreightTrigger provides sales intelligence only. We do not broker freight, arrange transportation, select carriers, handle loads, manage shipments, process contracts, store shipping documents, manage invoices, or move payments between shippers and carriers."
  ].join("\n");
}

function buildInterestedReply(context: { from: string }) {
  const sampleUrl = linkWithContext(SAMPLE_URL, "Interested", context.from);
  const checkoutUrl = linkWithContext(CHECKOUT_URL, "Interested", context.from);

  return [
    "Here is the clean path.",
    "",
    "Preview:",
    sampleUrl,
    "",
    "Beta feed:",
    checkoutUrl,
    "",
    "After checkout, the current FreightTrigger feed is delivered right away. Monday updates continue each week after that.",
    "",
    "The feed includes current shipper opportunities with evidence, freight read, buyer/contact route, urgency/confidence notes, and outreach positioning.",
    "",
    "If you want to sanity-check fit first, reply with your target region and whether you sell reefer, FTL/LTL, brokerage, 3PL, warehousing, or final mile."
  ].join("\n");
}

function buildWarmReply(intent: ReplyIntent, context: { from: string; subject: string; body: string }) {
  if (intent === "Interested") return buildInterestedReply({ from: context.from });
  return buildNeedsInfoReply({ from: context.from });
}

function conversionTrackingBlock(input: {
  gmailId: string;
  from: string;
  intent: ReplyIntent;
  subject: string;
  body: string;
  answerSent: string;
}) {
  const question = inferQuestionAsked(input.subject, input.body);
  const objectionCategory = inferObjectionCategory(input.subject, input.body);
  const now = new Date().toISOString();
  return [
    `${CONVERSION_TAG}${input.intent.toLowerCase().replace(/\s+/g, "-")}:${input.gmailId}]`,
    `tracked_at: ${now}`,
    `contact: ${input.from}`,
    `question_asked: ${question}`,
    `answer_sent: ${input.answerSent}`,
    `sample_url: ${linkWithContext(SAMPLE_URL, input.intent, input.from)}`,
    `stripe_url: ${linkWithContext(CHECKOUT_URL, input.intent, input.from)}`,
    "sample_click: pending_tracking",
    "stripe_click: pending_tracking",
    "purchase_status: pending_stripe_match",
    `objection_category: ${objectionCategory}`
  ].join("\n");
}

function linkedProspect(prospects: AirtableRecord[], email: string) {
  return prospects.find((record) => normalizeEmail(record.fields["Contact Email"]) === email);
}

function emailFromReplySummary(summary: string) {
  const match = summary.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return normalizeEmail(match?.[0]);
}

function hasProcessedMessage(existingReplies: AirtableRecord[], gmailId: string) {
  return existingReplies.some((record) => String(record.fields["Reply Summary"] || "").includes(`[gmail:${gmailId}]`));
}

async function updateProspectFromIntent(prospect: AirtableRecord | undefined, intent: ReplyIntent, summary: string) {
  if (!prospect) return;
  const status =
    intent === "Interested" || intent === "Needs Info"
      ? "Qualified"
      : intent === "Unsubscribe"
        ? "Suppressed"
        : intent === "Follow-up"
          ? "Contacted"
          : "Unresponsive";

  await patchRecords("Broker Prospects", [
    {
      id: prospect.id,
      fields: {
        Status: status,
        "Research Notes": [
          String(prospect.fields["Research Notes"] || "").trim(),
          `${new Date().toISOString()} reply feedback: ${summary}`
        ]
          .filter(Boolean)
          .join("\n")
      }
    }
  ]);
}

function replyProspectId(record: AirtableRecord) {
  return (record.fields.Prospect as string[] | undefined)?.[0] || "";
}

function prospectEmailById(prospects: AirtableRecord[]) {
  return new Map(
    prospects
      .map((record) => [record.id, normalizeEmail(record.fields["Contact Email"])] as const)
      .filter(([, email]) => Boolean(email))
  );
}

function replyDestination(reply: AirtableRecord, prospects: AirtableRecord[]) {
  const prospectId = replyProspectId(reply);
  const byId = prospectEmailById(prospects);
  return (prospectId ? byId.get(prospectId) : "") || emailFromReplySummary(String(reply.fields["Reply Summary"] || ""));
}

async function processWarmReplyFollowups(
  prospects: AirtableRecord[],
  existingReplies: AirtableRecord[],
  suppressed: Set<string>,
  { force = false } = {}
) {
  let sent = 0;
  const patches: Array<{ id: string; fields: Record<string, unknown> }> = [];

  for (const reply of existingReplies) {
    const intent = String(reply.fields.Intent || "") as ReplyIntent;
    if (intent !== "Interested" && intent !== "Needs Info") continue;

    const existingSummary = String(reply.fields["Reply Summary"] || "");
    if (existingSummary.includes(CONVERSION_TAG)) continue;

    const to = replyDestination(reply, prospects);
    if (!to || suppressed.has(to)) continue;
    if (!force && !inBusinessWindow()) continue;
    if (sent >= MAX_WARM_FOLLOWUPS) break;

    const subject = "Re: FreightTrigger sample signal feed";
    const body = buildWarmReply(intent, {
      from: to,
      subject: String(reply.fields["Reply Summary"] || ""),
      body: String(reply.fields["Reply Summary"] || "")
    });

    await sendGmailMessage(to, subject, body);
    sent += 1;

    patches.push({
      id: reply.id,
      fields: {
        "Reply Summary": [
          existingSummary,
          conversionTrackingBlock({
            gmailId: reply.id,
            from: to,
            intent,
            subject: String(reply.fields["Reply Summary"] || ""),
            body: String(reply.fields["Reply Summary"] || ""),
            answerSent: intent === "Interested" ? "interested-direct-path-v1" : "needs-info-clarity-v1"
          })
        ]
          .filter(Boolean)
          .join("\n"),
        "Next Action": "Warm reply answered; monitor sample/checkout behavior and next objection."
      }
    });
  }

  await patchRecords("Replies", patches);
  return sent;
}

export async function classifyRecentReplies({ force = false } = {}) {
  const [prospects, existingReplies, suppression] = await Promise.all([
    listRecords("Broker Prospects", 100),
    listRecords("Replies", 100),
    listRecords("Suppression List", 100)
  ]);

  const suppressed = new Set(suppression.map((record) => normalizeEmail(record.fields.Email)).filter(Boolean));
  const messages = await listGmailMessages(`newer_than:14d -from:${FROM_EMAIL}`, 10);
  const createdReplies: Record<string, unknown>[] = [];
  const suppressedRecords: Record<string, unknown>[] = [];
  let autoSent = 0;
  let skippedNoise = 0;
  let skippedUnlinked = 0;

  for (const ref of messages) {
    if (hasProcessedMessage(existingReplies, ref.id)) continue;

    const message = await getGmailMessage(ref.id);
    const from = emailFromHeader(headerValue(message, "From"));
    if (!from || from === FROM_EMAIL || suppressed.has(from)) continue;

    const subject = headerValue(message, "Subject");
    const body = messageBody(message).slice(0, 4000);
    if (isVendorNoise(from, subject, body)) {
      skippedNoise += 1;
      continue;
    }
    const prospect = linkedProspect(prospects, from);
    if (!prospect) {
      skippedUnlinked += 1;
      continue;
    }
    const intent = await classifyWithOpenAI(subject, body);
    const summary = `[gmail:${message.id}] ${from} replied with ${intent}. Subject: ${subject || "No subject"}. Snippet: ${
      message.snippet || body.slice(0, 180)
    }`;
    const warmIntent = intent === "Interested" || intent === "Needs Info";
    const canAutoReply = warmIntent && autoSent < MAX_AUTO_REPLIES && (force || inBusinessWindow());
    const answerSent = intent === "Interested" ? "interested-direct-path-v1" : "needs-info-clarity-v1";

    createdReplies.push({
      "Reply Summary": canAutoReply
        ? [
            summary,
            conversionTrackingBlock({
              gmailId: message.id,
              from,
              intent,
              subject,
              body,
              answerSent
            })
          ].join("\n")
        : summary,
      "Prospect": prospect ? [prospect.id] : undefined,
      "Intent": intent,
      "Next Action":
        canAutoReply
          ? "Warm reply answered; monitor sample/checkout behavior and next objection."
          : warmIntent
            ? "Send preview and beta checkout path."
          : intent === "Unsubscribe"
            ? "Suppress immediately."
            : intent === "Follow-up"
              ? "Queue later follow-up."
              : "No active send."
    });

    if (intent === "Unsubscribe") {
      suppressedRecords.push({
        Email: from,
        Reason: "Gmail reply opt-out",
        "Date Added": new Date().toISOString().slice(0, 10)
      });
    }

    await updateProspectFromIntent(prospect, intent, summary);

    if (
      canAutoReply
    ) {
      await sendGmailMessage(
        from,
        "FreightTrigger sample signal feed",
        buildWarmReply(intent, { from, subject, body })
      );
      autoSent += 1;
    }
  }

  const [replyCreates, suppressCreates] = await Promise.all([
    createRecords("Replies", createdReplies),
    createRecords("Suppression List", suppressedRecords)
  ]);

  const warmFollowupsSent = await processWarmReplyFollowups(prospects, existingReplies, suppressed, { force });

  return {
    scanned: messages.length,
    classified: replyCreates.length,
    suppressed: suppressCreates.length,
    skippedNoise,
    skippedUnlinked,
    sampleRepliesSent: autoSent,
    warmFollowupsSent
  };
}
