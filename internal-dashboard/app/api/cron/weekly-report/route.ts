import { NextResponse } from "next/server";
import { deliverWeeklyReports } from "@/lib/reports";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const result = await deliverWeeklyReports();
    return NextResponse.json({
      ranAt: new Date().toISOString(),
      ...result
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
