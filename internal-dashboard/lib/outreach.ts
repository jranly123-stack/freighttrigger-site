import { listRecords, patchRecords } from "./airtable";
import { sendGmailMessage } from "./gmail";
import { inBusinessWindow } from "./time";

const MAX_SENDS_PER_RUN = 3;

export async function sendQueuedOutreach({ force = false } = {}) {
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

  for (const record of queued) {
    const prospectId = (record.fields.Prospect as string[] | undefined)?.[0];
    const prospect = prospectId ? prospectsById.get(prospectId) : undefined;
    const email = String(prospect?.fields["Contact Email"] || "").trim().toLowerCase();
    if (!email || suppressed.has(email)) continue;

    await sendGmailMessage(
      email,
      String(record.fields["Email Subject"] || "Food/bev shipper timing signals"),
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

    if (sentTo.length >= MAX_SENDS_PER_RUN) break;
  }

  await patchRecords("Outreach", updates);

  return {
    sent: sentTo.length,
    sentTo
  };
}
