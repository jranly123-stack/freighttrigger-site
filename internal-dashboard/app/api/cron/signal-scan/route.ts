import { NextRequest, NextResponse } from "next/server";
import { createReviewCandidates } from "@/lib/airtable";
import { runEngine } from "@/lib/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_request: NextRequest) {
  try {
    const result = await runEngine();
    const airtable = await createReviewCandidates(result.candidates);
    return NextResponse.json({
      ranAt: result.ranAt,
      scannedCandidates: result.count,
      airtable,
      logs: result.logs
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
