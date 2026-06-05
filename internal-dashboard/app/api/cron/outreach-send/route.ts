import { NextResponse } from "next/server";
import { sendQueuedOutreach } from "@/lib/outreach";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const result = await sendQueuedOutreach();
    return NextResponse.json({
      ranAt: new Date().toISOString(),
      ...result
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
