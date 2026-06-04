import { NextResponse } from "next/server";
import { runEngine } from "@/lib/engine";

export async function POST() {
  try {
    const result = await runEngine();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
