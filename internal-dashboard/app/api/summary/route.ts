import { NextResponse } from "next/server";
import { getSignalRows, getSummary } from "@/lib/airtable";

export async function GET() {
  try {
    const [summary, signals] = await Promise.all([getSummary(), getSignalRows()]);
    return NextResponse.json({ summary, signals });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
