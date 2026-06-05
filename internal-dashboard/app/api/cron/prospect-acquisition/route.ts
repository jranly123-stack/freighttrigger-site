import { NextResponse } from "next/server";
import { acquireBuyerProspects } from "@/lib/prospects";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function HEAD() {
  return new NextResponse(null, { status: 405 });
}

export async function GET() {
  try {
    const result = await acquireBuyerProspects({
      maxQueries: 1,
      maxResultsPerQuery: 4,
      maxProspects: 4,
      deadlineMs: 48_000
    });
    return NextResponse.json({
      ranAt: new Date().toISOString(),
      ...result
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
