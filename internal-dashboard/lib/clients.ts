import { createRecords, listRecords, patchRecords, type AirtableRecord } from "./airtable";
import { sendGmailMessage } from "./gmail";

const SUPPORT_EMAIL = "signals@getfreighttrigger.com";

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export async function upsertClient(input: {
  email: string;
  name?: string;
  plan?: string;
  stripeStatus?: string;
  sourceNote?: string;
}) {
  const email = normalizeEmail(input.email);
  if (!email) throw new Error("Client email is required");

  const clients = await listRecords("Clients", 100);
  const existing = clients.find((record) => normalizeEmail(record.fields.Email) === email);
  const fields = {
    "Client Name": input.name || existing?.fields["Client Name"] || email,
    Email: email,
    Plan: input.plan || "Beta FreightTrigger Signal Feed",
    "Stripe Status": input.stripeStatus || "Active",
    "Start Date": existing?.fields["Start Date"] || today(),
    "Client Experience Notes": [
      String(existing?.fields["Client Experience Notes"] || "").trim(),
      input.sourceNote ? `${new Date().toISOString()} - ${input.sourceNote}` : ""
    ]
      .filter(Boolean)
      .join("\n")
  };

  if (existing) {
    const [updated] = await patchRecords("Clients", [{ id: existing.id, fields }]);
    return updated;
  }

  const [created] = await createRecords("Clients", [fields]);
  return created;
}

export async function activeClients() {
  const clients = await listRecords("Clients", 100);
  return clients.filter((client) => {
    const status = String(client.fields["Stripe Status"] || "").toLowerCase();
    return status === "active" || status === "trialing";
  });
}

export async function sendOnboardingEmail(client: AirtableRecord) {
  const email = normalizeEmail(client.fields.Email);
  if (!email) return { sent: false, skipped: "missing email" };

  const body = [
    "You're in for the Beta FreightTrigger Signal Feed.",
    "",
    "What happens next:",
    "",
    "1. FreightTrigger prepares your first food/bev and reefer-focused shipper signal feed.",
    "2. You receive evidence-backed opportunities with freight context, buyer path, scoring, and outreach positioning.",
    "3. The weekly feed is delivered by email every Monday morning Eastern.",
    "",
    "To calibrate the feed, reply with any target geography, service focus, exclusions, or industries you do not want included.",
    "",
    "FreightTrigger provides sales intelligence only. We do not broker freight, arrange transportation, select carriers, handle loads, manage shipments, process contracts, store shipping documents, manage invoices, or move payments between shippers and carriers.",
    "",
    `Support: ${SUPPORT_EMAIL}`
  ].join("\n");

  await sendGmailMessage(email, "FreightTrigger beta onboarding", body);
  return { sent: true, to: email };
}
