import { createRecords, listRecords, type AirtableRecord } from "./airtable";
import { daysBetween } from "./time";

const MAX_FOLLOWUPS_PER_RUN = 6;

function linkedProspectId(record: AirtableRecord) {
  return (record.fields.Prospect as string[] | undefined)?.[0] || "";
}

function sentDate(record: AirtableRecord) {
  const raw = String(record.fields["Sent Date"] || "");
  const date = raw ? new Date(raw) : undefined;
  return date && Number.isFinite(date.getTime()) ? date : undefined;
}

function isFollowUp(record: AirtableRecord) {
  return String(record.fields["Email Subject"] || "").toLowerCase().includes("quick follow-up");
}

export async function queueFollowUps() {
  const [outreach, replies] = await Promise.all([listRecords("Outreach", 100), listRecords("Replies", 100)]);
  const repliedProspects = new Set(replies.map(linkedProspectId).filter(Boolean));
  const existingFollowUps = new Set(outreach.filter(isFollowUp).map(linkedProspectId).filter(Boolean));
  const now = new Date();

  const drafts: Record<string, unknown>[] = [];

  for (const record of outreach) {
    const prospectId = linkedProspectId(record);
    if (!prospectId || repliedProspects.has(prospectId) || existingFollowUps.has(prospectId)) continue;
    if (record.fields.Status !== "Sent") continue;

    const date = sentDate(record);
    if (!date || daysBetween(date, now) < 3) continue;

    drafts.push({
      "Email Subject": "Quick follow-up: food/bev shipper timing signals",
      "Prospect": [prospectId],
      "Message": [
        "Quick follow-up.",
        "",
        "FreightTrigger is a weekly signal feed for logistics sales teams. It highlights food/bev shipper accounts showing freight-relevant business movement, then packages the why, likely freight read, buyer path, and outreach angle.",
        "",
        "Sample signal feed:",
        "https://getfreighttrigger.com/sample-feed.html",
        "",
        "If this is not relevant, reply remove and I will suppress the address."
      ].join("\n"),
      "Status": "Queued"
    });

    if (drafts.length >= MAX_FOLLOWUPS_PER_RUN) break;
  }

  const created = await createRecords("Outreach", drafts);
  return { queuedFollowUps: created.length };
}
