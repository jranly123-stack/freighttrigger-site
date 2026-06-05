import { NextRequest, NextResponse } from "next/server";
import { handleStripeEvent, verifyStripeEvent } from "@/lib/stripe";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get("stripe-signature") || "";
    const event = verifyStripeEvent(rawBody, signature);
    const result = await handleStripeEvent(event);
    return NextResponse.json({
      received: true,
      ...result
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 400 });
  }
}
