import { NextResponse } from "next/server";

import { createReportingClient } from "@/lib/analytics/reporting-refresh";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const reporting = createReportingClient();
  const { count, error } = await reporting.from("stores").select("*", { count: "exact", head: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, stores: count ?? 0 });
}
