import { NextResponse } from "next/server";
import { runDoctrineAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function HEAD() {
  return new NextResponse(null, { status: 405 });
}

export async function GET() {
  try {
    const result = await runDoctrineAudit();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
