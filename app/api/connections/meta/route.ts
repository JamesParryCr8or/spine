import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

type MetaAccount = {
  id: string;
  name?: string;
  account_status?: number;
  currency?: string;
  timezone_name?: string;
};

async function requireUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims?.sub) {
    return { supabase, response: NextResponse.json({ error: "Authentication required" }, { status: 401 }) };
  }

  return { supabase, response: null };
}

export async function GET() {
  const { supabase, response } = await requireUser();
  if (response) return response;

  const { data, error } = await supabase
    .from("data_connections")
    .select("provider,status,external_account_id,external_account_name,last_verified_at,last_error")
    .eq("provider", "meta")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ connection: data });
}

export async function POST(request: Request) {
  const { supabase, response } = await requireUser();
  if (response) return response;

  const body = await request.json().catch(() => null) as { accessToken?: string; accountId?: string } | null;
  const accessToken = body?.accessToken?.trim();
  if (!accessToken) return NextResponse.json({ error: "Access token is required" }, { status: 400 });

  const accountsResponse = await fetch(
    "https://graph.facebook.com/me/adaccounts?fields=id,name,account_status,currency,timezone_name&limit=100",
    { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" },
  );
  const accountsPayload = await accountsResponse.json().catch(() => ({})) as {
    data?: MetaAccount[];
    error?: { message?: string };
  };

  if (!accountsResponse.ok) {
    return NextResponse.json(
      { error: accountsPayload.error?.message ?? "Meta rejected this access token" },
      { status: 400 },
    );
  }

  const requestedId = body?.accountId?.trim().replace(/^act_/, "");
  const account = requestedId
    ? accountsPayload.data?.find((item) => item.id.replace(/^act_/, "") === requestedId)
    : accountsPayload.data?.[0];

  if (!account) {
    return NextResponse.json(
      { error: requestedId ? "That ad account is not available to this token" : "No ad accounts were found for this token" },
      { status: 400 },
    );
  }

  const { data, error } = await supabase.rpc("save_data_connection", {
    connection_provider: "meta",
    access_token: accessToken,
    account_id: account.id,
    account_name: account.name ?? null,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const saved = Array.isArray(data) ? data[0] : data;

  return NextResponse.json({
    connection: {
      provider: saved?.provider ?? "meta",
      status: saved?.status ?? "connected",
      external_account_id: account.id,
      external_account_name: account.name ?? account.id,
      last_verified_at: saved?.last_verified_at ?? new Date().toISOString(),
    },
  });
}

export async function DELETE() {
  const { supabase, response } = await requireUser();
  if (response) return response;
  const { error } = await supabase.rpc("delete_data_connection", { connection_provider: "meta" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
