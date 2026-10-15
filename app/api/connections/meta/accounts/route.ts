import { cookies } from "next/headers";
import { metaPendingCookie, openMetaSession } from "@/lib/connections/meta-oauth";

import { NextResponse } from "next/server";

import { discoverMetaAccounts } from "@/lib/connections/meta";
import { requireWorkspace } from "@/lib/workspace/server";
import { canManageConnections } from "@/lib/workspace/permissions";

export async function POST(request: Request) {
  const workspace = await requireWorkspace();
  if (!workspace.ok) return workspace.response;
  if (!canManageConnections(workspace.membership.role)) return NextResponse.json({ error: "Connection management access is required" }, { status: 403 });

  const body = await request.json().catch(() => null) as { accessToken?: string } | null;
  const accessToken = body?.accessToken?.trim();
  if (!accessToken) {
    return NextResponse.json({ error: "Enter a Meta access token first" }, { status: 400 });
  }

  try {
    const accounts = await discoverMetaAccounts(accessToken, true);
    return NextResponse.json({
      accounts: accounts.map(({ id, name, currency, account_status }) => ({
        id,
        name: name ?? id,
        currency: currency ?? null,
        accountStatus: account_status ?? null,
      })),
    });
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "Meta could not load ad accounts" },
      { status: 400 },
    );
  }
}

export async function GET() {
  const workspace = await requireWorkspace();
  if (!workspace.ok) return workspace.response;
  if (!workspace.store || !canManageConnections(workspace.membership.role)) return NextResponse.json({ error: "Connection management access is required" }, { status: 403 });
  const session = openMetaSession((await cookies()).get(metaPendingCookie)?.value, process.env.META_APP_SECRET ?? "", "pending", { userId: workspace.userId, storeId: workspace.store.id, organizationId: workspace.membership.organizationId });
  if (!session?.accessToken) return NextResponse.json({ error: "Sign-in expired or the selected brand changed. Connect with Meta again." }, { status: 400 });
  try {
    const accounts = await discoverMetaAccounts(session.accessToken, true);
    return NextResponse.json({ lookbackMonths: session.lookbackMonths, accounts: accounts.map(({ id, name, currency, account_status }) => ({ id, name: name ?? id, currency: currency ?? null, accountStatus: account_status ?? null })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Could not load Meta ad accounts" }, { status: 400 });
  }
}
