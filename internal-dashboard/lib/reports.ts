import { activeClients } from "./clients";
import { createRecords, getSignalRows, patchRecords } from "./airtable";
import { sendGmailMessage } from "./gmail";

const SAMPLE_URL = "https://getfreighttrigger.com/sample-feed.html";

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function reportPeriod() {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - 7);
  return `${start.toISOString().slice(0, 10)} to ${now.toISOString().slice(0, 10)}`;
}

export async function buildWeeklyReportBody() {
  const rows = (await getSignalRows())
    .sort((a, b) => b.urgency + b.confidence - (a.urgency + a.confidence))
    .slice(0, 12);

  const lines = [
    "FreightTrigger Weekly Signal Feed",
    `Period: ${reportPeriod()}`,
    "",
    "Coverage: food/bev, reefer, and cold-chain-adjacent shipper opportunities.",
    "",
    "This feed separates observed evidence from inferred freight need. It is sales intelligence only, not verified buyer intent.",
    ""
  ];

  rows.forEach((row, index) => {
    lines.push(
      `#${index + 1} ${row.company}`,
      `Trigger: ${row.trigger}`,
      `Location: ${row.location || "Review required"}`,
      `Evidence: ${row.evidenceUrl}`,
      `Priority: ${row.urgency}/100 urgency, ${row.confidence}/100 confidence`,
      `Freight read: ${row.relevance}`,
      "Sales action: review the evidence, map the likely operations buyer, and lead with the business change rather than a generic capacity pitch.",
      ""
    );
  });

  lines.push(
    "Reference sample:",
    SAMPLE_URL,
    "",
    "FreightTrigger provides sales intelligence only. We do not broker freight, arrange transportation, select carriers, handle loads, manage shipments, process contracts, store shipping documents, manage invoices, or move payments between shippers and carriers."
  );

  return {
    subject: `FreightTrigger Weekly Signal Feed - ${new Date().toISOString().slice(0, 10)}`,
    body: lines.join("\n"),
    count: rows.length
  };
}

export async function deliverWeeklyReports() {
  const clients = await activeClients();
  if (!clients.length) {
    return { delivered: 0, skipped: "no active clients" };
  }

  const report = await buildWeeklyReportBody();
  const createdReports = await createRecords(
    "Reports",
    clients.map((client) => ({
      "Report Name": report.subject,
      "Client": [client.id],
      "Report Period": reportPeriod(),
      "Status": "Draft",
      "Delivery Link": SAMPLE_URL,
      "AI Executive Summary": `Generated ${report.count} signal rows for weekly email delivery.`
    }))
  );

  const delivered: string[] = [];
  for (const client of clients) {
    const email = normalizeEmail(client.fields.Email);
    if (!email) continue;
    await sendGmailMessage(email, report.subject, report.body);
    delivered.push(email);
  }

  await patchRecords(
    "Reports",
    createdReports.map((record) => ({
      id: record.id,
      fields: {
        Status: "Sent"
      }
    }))
  );

  return {
    delivered: delivered.length,
    to: delivered,
    signalRows: report.count
  };
}
