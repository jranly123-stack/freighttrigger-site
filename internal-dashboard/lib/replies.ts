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

const SAMPLE_URL = "https://getfreighttrigger.com/sample-feed.html";
const CHECKOUT_URL = "https://buy.stripe.com/14A8wO6R4df565JbjYfAc00";
const FROM_EMAIL = "signals@getfreighttrigger.com";
const MAX_AUTO_REPLIES = 3;

type ReplyIntent = "Interested" | "Needs Info" | "Follow-up" | "Not Interested" | "Unsubscribe" | "Bad Fit";

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function classifyByRules(text: string): ReplyIntent | undefined {
  const lower = text.toLowerCase();
  if (/(unsubscribe|remove me|do not email|don't email|stop emailing|opt out)/.test(lower)) {
    return "Unsubscribe";
  }
  if (/(not interested|no thanks|no thank you|not a fit|wrong person)/.test(lower)) {
    return lower.includes("wrong person") ? "Bad Fit" : "Not Interested";
  }
  if (/(send|share|show|see|sample|example|report|feed|interested|tell me more|more info)/.test(lower)) {
    return lower.includes("later") ? "Follow-up" : "Interested";
  }
  if (/(how much|price|pricing|what.*include|details|territory|coverage)/.test(lower)) {
    return "Needs Info";
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

function buildSampleReply() {
  return [
    "Here is the public sample signal feed:",
    "",
    SAMPLE_URL,
    "",
    "The paid beta feed includes weekly shipper opportunity records with source evidence, freight context, buyer path, priority scoring, and outreach positioning.",
    "",
    "Beta subscription:",
    CHECKOUT_URL,
    "",
    "FreightTrigger provides sales intelligence only. We do not broker freight, arrange transportation, select carriers, handle loads, manage shipments, process contracts, store shipping documents, manage invoices, or move payments between shippers and carriers."
  ].join("\n");
}

function linkedProspect(prospects: AirtableRecord[], email: string) {
  return prospects.find((record) => normalizeEmail(record.fields["Contact Email"]) === email);
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

  for (const ref of messages) {
    if (hasProcessedMessage(existingReplies, ref.id)) continue;

    const message = await getGmailMessage(ref.id);
    const from = emailFromHeader(headerValue(message, "From"));
    if (!from || from === FROM_EMAIL || suppressed.has(from)) continue;

    const subject = headerValue(message, "Subject");
    const body = messageBody(message).slice(0, 4000);
    const intent = await classifyWithOpenAI(subject, body);
    const prospect = linkedProspect(prospects, from);
    const summary = `[gmail:${message.id}] ${from} replied with ${intent}. Subject: ${subject || "No subject"}. Snippet: ${
      message.snippet || body.slice(0, 180)
    }`;

    createdReplies.push({
      "Reply Summary": summary,
      "Prospect": prospect ? [prospect.id] : undefined,
      "Intent": intent,
      "Next Action":
        intent === "Interested" || intent === "Needs Info"
          ? "Send sample feed and beta checkout path."
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
      (intent === "Interested" || intent === "Needs Info") &&
      autoSent < MAX_AUTO_REPLIES &&
      (force || inBusinessWindow())
    ) {
      await sendGmailMessage(from, "FreightTrigger sample signal feed", buildSampleReply());
      autoSent += 1;
    }
  }

  const [replyCreates, suppressCreates] = await Promise.all([
    createRecords("Replies", createdReplies),
    createRecords("Suppression List", suppressedRecords)
  ]);

  return {
    scanned: messages.length,
    classified: replyCreates.length,
    suppressed: suppressCreates.length,
    sampleRepliesSent: autoSent
  };
}
