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

function buyerAccessibility(row: Awaited<ReturnType<typeof getSignalRows>>[number]) {
  const contact = `${row.contactPath || ""}`.toLowerCase();
  if (contact.includes("@") || contact.includes("email")) return "Medium-high";
  if (contact.includes("phone") || contact.match(/\(\d{3}\)/)) return "Medium";
  return "Needs enrichment";
}

export async function buildWeeklyReportBody() {
  const rows = (await getSignalRows())
    .sort((a, b) => b.urgency + b.confidence - (a.urgency + a.confidence))
    .slice(0, 12);

  const lines = [
    "FreightTrigger Monday Signal Feed",
    `Period: ${reportPeriod()}`,
    "",
    "Coverage: food/bev, reefer, and cold-chain-adjacent shipper opportunities for this sales week.",
    "",
    "FreightTrigger provides sales intelligence only. This feed does not claim verified buyer intent, freight volume, available loads, or guaranteed conversion.",
    "Each record separates observed evidence from FreightTrigger's freight hypothesis.",
    "",
    "Client action for this week:",
    "1. Work the highest-priority records first.",
    "2. Open the evidence URL before outreach.",
    "3. Use the contact path to choose email, phone, form, or LinkedIn route.",
    "4. Lead with the trigger and the operating window.",
    "5. Reply with booked, replied, bad fit, no contact path, already customer, exclude this vertical, or send more like this.",
    "",
    "Executive scan:"
  ];

  rows.slice(0, 5).forEach((row, index) => {
    lines.push(
      "",
      `${index + 1}. ${row.company}`,
      `   Region: ${row.location || "Review required"}`,
      `   Signal: ${row.trigger || "Review required"}`,
      `   Best-fit provider: ${row.likelyNeed || row.relevance || "Review required"}`,
      `   Priority: ${row.urgency}/100 urgency, ${row.confidence}/100 confidence`
    );
  });

  lines.push(
    ""
  );

  rows.forEach((row, index) => {
    lines.push(
      `Signal ${index + 1}: ${row.company}`,
      "",
      `Vertical: ${row.vertical || "Review required"}`,
      `Region: ${row.location || "Review required"}`,
      `Priority: ${row.urgency >= 85 ? "High" : row.urgency >= 70 ? "Medium" : "Watchlist"}`,
      `Urgency: ${row.urgency}/100`,
      `Confidence: ${row.confidence}/100`,
      `Buyer accessibility: ${buyerAccessibility(row)}`,
      "",
      `Evidence: ${row.evidenceUrl}`,
      "",
      "Observed trigger:",
      row.trigger || "Review required",
      "",
      "FreightTrigger freight read:",
      row.likelyNeed || row.relevance || "Review required",
      "",
      "Buyer/contact path:",
      `Primary roles: ${row.buyerPath || "logistics, transportation, operations, supply chain, or facility-level distribution leadership"}`,
      `Contact path: ${row.contactPath}`,
      "",
      "Recommended sales action:",
      "Lead with the observed business change and offer a coverage, routing, overflow, or backup-capacity review. Do not open with a generic capacity pitch.",
      "",
      "Suggested opener:",
      row.outreachAngle || "Saw a recent operating change that may affect distribution planning. During these windows, teams often review lane coverage, routing, and backup capacity before volume pressure shows up.",
      ""
    );
  });

  lines.push(
    "Client feedback capture:",
    "Reply with contacted, replied, bounced, no response, booked conversation, bad fit, already customer, better role found, better phone/email found, or closed opportunity.",
    "",
    "Reference public sample:",
    SAMPLE_URL,
    "",
    "FreightTrigger provides sales intelligence only. We do not broker freight, arrange transportation, select carriers, handle loads, manage shipments, process contracts, store shipping documents, manage invoices, or move payments between shippers and carriers."
  );

  return {
    subject: `FreightTrigger Monday Signal Feed - ${new Date().toISOString().slice(0, 10)}`,
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

export async function deliverCurrentReportToClient(client: { id: string; fields: Record<string, unknown> }, reason = "checkout") {
  const email = normalizeEmail(client.fields.Email);
  if (!email) return { sent: false, skipped: "missing email" };

  const report = await buildWeeklyReportBody();
  const subject = `FreightTrigger Current Signal Feed - ${new Date().toISOString().slice(0, 10)}`;
  const body = [
    "Here is your current FreightTrigger signal package.",
    "",
    "You do not need to wait until Monday. This is the current feed for immediate use; future weekly updates arrive every Monday morning Eastern.",
    "",
    "How to use this today:",
    "",
    "1. Start with the executive scan.",
    "2. Open the evidence URL before outreach.",
    "3. Route through the listed contact path.",
    "4. Lead with the business change, not a generic capacity pitch.",
    "5. Reply with feedback tags so the next feed improves.",
    "",
    "Useful feedback tags: booked, replied, bad fit, no contact path, already customer, exclude this vertical, send more like this.",
    "",
    report.body
  ].join("\n");

  const [createdReport] = await createRecords("Reports", [
    {
      "Report Name": subject,
      "Client": [client.id],
      "Report Period": reportPeriod(),
      "Status": "Draft",
      "Delivery Link": SAMPLE_URL,
      "AI Executive Summary": `Immediate ${reason} delivery with ${report.count} signal rows.`
    }
  ]);

  await sendGmailMessage(email, subject, body);

  await patchRecords("Reports", [
    {
      id: createdReport.id,
      fields: {
        Status: "Sent"
      }
    }
  ]);

  return {
    sent: true,
    to: email,
    signalRows: report.count
  };
}
