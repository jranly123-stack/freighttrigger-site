import { createRecords, listRecords, type AirtableRecord } from "./airtable";
import { daysBetween } from "./time";

const MAX_FOLLOWUPS_PER_RUN = 6;
const SAMPLE_URL = "https://getfreighttrigger.com/sample-feed.html";
const STRIPE_URL = "https://buy.stripe.com/14A8wO6R4df565JbjYfAc00";

function linkedProspectId(record: AirtableRecord) {
  return (record.fields.Prospect as string[] | undefined)?.[0] || "";
}

function sentDate(record: AirtableRecord) {
  const raw = String(record.fields["Sent Date"] || "");
  const date = raw ? new Date(raw) : undefined;
  return date && Number.isFinite(date.getTime()) ? date : undefined;
}

function subject(record: AirtableRecord) {
  return String(record.fields["Email Subject"] || "");
}

function followUpStage(record: AirtableRecord) {
  const value = subject(record).toLowerCase();
  if (value.includes("[ft-fu3]")) return 3;
  if (value.includes("[ft-fu2]")) return 2;
  if (value.includes("[ft-fu1]") || value.includes("quick follow-up")) return 1;
  return 0;
}

function buildFollowUp(stage: number) {
  if (stage === 1) {
    return {
      subject: "[FT-FU1] Quick follow-up: food/bev shipper timing signals",
      body: [
        "Quick follow-up on FreightTrigger.",
        "",
        "The short version: we send logistics sales teams a weekly food/bev signal feed built around timing, not generic shipper names.",
        "",
        "Partial preview:",
        SAMPLE_URL,
        "",
        "The beta feed includes the current records with source context, contact route, scoring notes, and sales positioning. Current feed is delivered after checkout; Monday updates continue after that:",
        STRIPE_URL,
        "",
        "If this is not relevant, reply remove and I will suppress the address."
      ].join("\n")
    };
  }

  if (stage === 2) {
    return {
      subject: "[FT-FU2] Worth sending the current sample?",
      body: [
        "Checking once more.",
        "",
        "Most broker prospecting starts too cold. FreightTrigger is meant to show which food/bev accounts have a timely business event worth using in the first touch.",
        "",
        "Partial preview:",
        SAMPLE_URL,
        "",
        "Beta feed:",
        STRIPE_URL,
        "",
        "If your team is not focused on food/bev, reefer, or distribution accounts right now, reply not a fit and I will close the loop."
      ].join("\n")
    };
  }

  return {
    subject: "[FT-FU3] Closing the loop",
    body: [
      "Closing the loop.",
      "",
      "FreightTrigger is still opening beta spots for logistics sales teams that want food/bev shipper timing intelligence instead of another static list.",
      "",
      "Preview:",
      SAMPLE_URL,
      "",
      "Subscribe:",
      STRIPE_URL,
      "",
      "If timing is off, no reply needed. If this should go to someone else on the sales or operations side, send me the right direction."
    ].join("\n")
  };
}

export async function queueFollowUps() {
  const [outreach, replies] = await Promise.all([listRecords("Outreach", 100), listRecords("Replies", 100)]);
  const repliedProspects = new Set(replies.map(linkedProspectId).filter(Boolean));
  const outreachByProspect = new Map<string, AirtableRecord[]>();

  for (const record of outreach) {
    const prospectId = linkedProspectId(record);
    if (!prospectId) continue;
    const records = outreachByProspect.get(prospectId) || [];
    records.push(record);
    outreachByProspect.set(prospectId, records);
  }

  const now = new Date();
  const drafts: Record<string, unknown>[] = [];

  for (const [prospectId, records] of outreachByProspect) {
    if (repliedProspects.has(prospectId)) continue;

    const sentRecords = records
      .filter((record) => record.fields.Status === "Sent")
      .sort((a, b) => (sentDate(a)?.getTime() || 0) - (sentDate(b)?.getTime() || 0));
    if (!sentRecords.length) continue;

    const firstSent = sentDate(sentRecords[0]);
    if (!firstSent) continue;

    const sentStages = new Set(sentRecords.map(followUpStage));
    const age = daysBetween(firstSent, now);
    const nextStage =
      !sentStages.has(1) && age >= 3
        ? 1
        : !sentStages.has(2) && age >= 6
          ? 2
          : !sentStages.has(3) && age >= 10
            ? 3
            : 0;
    if (!nextStage) continue;

    const followUp = buildFollowUp(nextStage);
    drafts.push({
      "Email Subject": followUp.subject,
      "Prospect": [prospectId],
      "Message": followUp.body,
      "Status": "Queued"
    });

    if (drafts.length >= MAX_FOLLOWUPS_PER_RUN) break;
  }

  const created = await createRecords("Outreach", drafts);
  return { queuedFollowUps: created.length };
}
