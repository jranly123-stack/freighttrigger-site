import crypto from "node:crypto";
import { optionalEnv } from "./local-env";
import { sendOnboardingEmail, upsertClient } from "./clients";
import { deliverCurrentReportToClient } from "./reports";

type StripeEvent = {
  id: string;
  type: string;
  data: {
    object: Record<string, unknown>;
  };
};

function parseStripeSignature(header: string) {
  const parts = new Map<string, string>();
  for (const item of header.split(",")) {
    const [key, value] = item.split("=");
    if (key && value) parts.set(key, value);
  }
  return {
    timestamp: parts.get("t") || "",
    signature: parts.get("v1") || ""
  };
}

function timingSafeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function verifyStripeEvent(rawBody: string, signatureHeader: string) {
  const secret = optionalEnv("STRIPE_WEBHOOK_SECRET", "STRIPEWEBHOOKSECRET");
  if (!secret) throw new Error("Missing required environment variable: STRIPE_WEBHOOK_SECRET or STRIPEWEBHOOKSECRET");
  const { timestamp, signature } = parseStripeSignature(signatureHeader);
  if (!timestamp || !signature) throw new Error("Missing Stripe webhook signature");

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");

  if (!timingSafeEqual(expected, signature)) {
    throw new Error("Invalid Stripe webhook signature");
  }

  return JSON.parse(rawBody) as StripeEvent;
}

async function stripeFetch<T>(path: string) {
  const key = optionalEnv("STRIPE_SECRET_KEY", "STRIPESECRETKEY");
  if (!key) return undefined;

  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: {
      Authorization: `Bearer ${key}`
    },
    cache: "no-store"
  });

  if (!response.ok) return undefined;
  return response.json() as Promise<T>;
}

function value(object: Record<string, unknown>, key: string) {
  return object[key] as string | undefined;
}

async function resolveCustomerEmail(object: Record<string, unknown>) {
  const details = object.customer_details as Record<string, unknown> | undefined;
  const email = value(object, "customer_email") || value(details ?? {}, "email");
  const name = value(details ?? {}, "name") || value(object, "customer_name");
  if (email) return { email, name };

  const customerId = value(object, "customer");
  if (!customerId) return {};

  const customer = await stripeFetch<{ email?: string; name?: string }>(
    `customers/${encodeURIComponent(customerId)}`
  );
  return { email: customer?.email, name: customer?.name };
}

function statusFromEvent(type: string, object: Record<string, unknown>) {
  if (type === "customer.subscription.deleted") return "Canceled";
  if (type === "checkout.session.completed" || type === "invoice.payment_succeeded") return "Active";
  return String(object.status || "Active").replace(/^active$/i, "Active");
}

export async function handleStripeEvent(event: StripeEvent) {
  const object = event.data.object;
  const supported = new Set([
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.payment_succeeded"
  ]);

  if (!supported.has(event.type)) {
    return { handled: false, event: event.type };
  }

  const { email, name } = await resolveCustomerEmail(object);
  if (!email) return { handled: false, event: event.type, skipped: "no customer email" };

  const client = await upsertClient({
    email,
    name,
    stripeStatus: statusFromEvent(event.type, object),
    sourceNote: `Stripe event ${event.type} (${event.id})`
  });

  let onboarding;
  let immediateDelivery;
  if (event.type === "checkout.session.completed") {
    onboarding = await sendOnboardingEmail(client);
    immediateDelivery = await deliverCurrentReportToClient(client, "checkout");
  }

  return {
    handled: true,
    event: event.type,
    clientId: client.id,
    onboarding,
    immediateDelivery
  };
}
