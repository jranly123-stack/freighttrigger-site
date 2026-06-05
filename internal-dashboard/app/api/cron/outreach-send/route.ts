import { NextResponse } from "next/server";
import { queueFollowUps } from "@/lib/followups";
import { sendQueuedOutreach } from "@/lib/outreach";
import { classifyRecentReplies } from "@/lib/replies";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function HEAD() {
  return new NextResponse(null, { status: 405 });
}

export async function GET() {
  try {
    const replies = await classifyRecentReplies();
    const followUps = await queueFollowUps();
    const result = await sendQueuedOutreach();
    return NextResponse.json({
      ranAt: new Date().toISOString(),
      replies,
      followUps,
      ...result
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
