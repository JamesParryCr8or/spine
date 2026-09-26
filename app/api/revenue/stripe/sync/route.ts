import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/workspace/server";
import { readCredential } from "@/lib/revenue/server";
import { stripeEntries, type StripeRecord } from "@/lib/revenue/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const w = await requireWorkspace(); if (!w.ok) return w.response;
  if (!w.store || !["owner", "admin", "connector"].includes(w.membership.role)) return NextResponse.json({ error: "Owner or admin access required" }, { status: 403 });
  try {
    const body = await request.json();
    if (body.storeId !== w.store.id) throw new Error("The active store changed. Reload this page before importing.");
    const phase = body.phase === "refunds" ? "refunds" : "charges";
    if (body.cursor && !/^(ch|re)_[A-Za-z0-9]+$/.test(body.cursor)) throw new Error("Invalid cursor");
    const secret = await readCredential(w, "stripe");
    if (!secret.stripe_user_id || !secret.livemode) throw new Error("Reconnect a live Stripe account");
    const params = new URLSearchParams({ limit: "100" });
    if (body.cursor) params.set("starting_after", body.cursor);
    // Full history is paginated, so late refunds and corrections are captured on every sync.
    const response = await fetch(`https://api.stripe.com/v1/${phase}?${params}`, { headers: { Authorization: `Bearer ${secret.access_token}` }, cache: "no-store", signal: AbortSignal.timeout(25_000) });
    if (!response.ok) throw new Error(response.status === 401 ? "Stripe access expired. Reconnect your account." : "Stripe could not return this page. Retry the sync.");
    const page = await response.json() as { data: StripeRecord[]; has_more: boolean };
    const entries = stripeEntries(page.data, secret.stripe_user_id, phase === "charges" ? "sale" : "refund", w.store.timezone || "UTC");
    if (entries.length) {
      const importer = w.membership.role === "connector" ? createAdminClient() : w.supabase;
      const result = await importer.rpc("import_revenue_entries", { requested_store_id: w.store.id, source_name: "stripe", batch_name: `Stripe ${phase}`, entries });
      if (result.error) throw new Error("Could not save Stripe records. Retry the sync.");
    }
    const done = phase === "refunds" && !page.has_more;
    const nextPhase = page.has_more ? phase : "refunds";
    const cursor = page.has_more ? page.data.at(-1)?.id : null;
    const status = await w.supabase.from("revenue_connector_settings").upsert({ store_id: w.store.id, provider: "stripe", settings: { phase: nextPhase, cursor, done }, last_error: null, ...(done ? { last_synced_at: new Date().toISOString() } : {}) });
    if (status.error) throw new Error("Payments saved, but sync progress could not be saved. Retry safely.");
    return NextResponse.json({ imported: entries.length, done, phase: nextPhase, cursor });
  } catch (error) {
    const message = error instanceof Error && !error.message.includes("JSON") ? error.message : "Stripe sync failed. Reconnect or retry.";
    await w.supabase.from("revenue_connector_settings").upsert({ store_id: w.store.id, provider: "stripe", last_error: message });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
