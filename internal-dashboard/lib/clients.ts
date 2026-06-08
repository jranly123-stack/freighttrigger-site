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
    "What you bought:",
    "",
    "A weekly food/bev and reefer-focused shipper timing feed for logistics sales teams. Each record is built to answer: who should your team look at, why now, what changed, what freight need may be implied, how to route contact, and what angle to use.",
    "",
    "Delivery:",
    "",
    "1. Your current signal package is sent immediately after checkout in a separate email.",
    "2. Future signal feeds arrive every Monday morning Eastern.",
    "3. The feed includes evidence links, freight read, buyer/contact path, urgency/confidence scoring, and suggested outreach positioning.",
    "4. If a record is not useful, reply with the reason so future feeds tighten around your market.",
    "",
    "Fast calibration:",
    "",
    "Reply with any target geography, service focus, exclusions, or industries you do not want included. Examples:",
    "",
    "- Southeast reefer only",
    "- FTL, no parcel",
    "- exclude enterprise retailers",
    "- more produce and cold storage",
    "- send more mid-market distributors",
    "",
    "Useful feedback tags:",
    "",
    "- booked",
    "- replied",
    "- bad fit",
    "- no contact path",
    "- already customer",
    "- exclude this vertical",
    "- send more like this",
    "",
    "FreightTrigger provides sales intelligence only. We do not broker freight, arrange transportation, select carriers, handle loads, manage shipments, process contracts, store shipping documents, manage invoices, or move payments between shippers and carriers.",
    "",
    `Support: ${SUPPORT_EMAIL}`
  ].join("\n");

  await sendGmailMessage(email, "FreightTrigger beta access confirmed", body);
  return { sent: true, to: email };
}
