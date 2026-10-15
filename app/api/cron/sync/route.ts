import { NextResponse } from "next/server";

/** Legacy endpoint: activity and report delivery now own automatic refreshes. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ started: false, reason: "Sync runs only during app activity or before configured reports" });
}
