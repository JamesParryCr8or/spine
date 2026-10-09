import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  selectActiveWorkspace,
  type WorkspaceMembership,
  type WorkspaceRole,
} from "@/lib/workspace/selection";

export const activeOrganizationCookie = "spine-active-organization";
export const activeStoreCookie = "spine-active-store";

type WorkspaceOptions = {
  organizationId?: string | null;
  storeId?: string | null;
  strict?: boolean;
};

type Store = {
  id: string;
  organization_id: string;
  name: string;
  currency: string;
  reporting_currency: string;
  timezone: string;
  shopify_domain: string | null;
  business_model: "ecommerce" | "lead_generation";
};

type WorkspaceContextResult =
  | { ok: true; memberships: WorkspaceMembership[]; stores: Store[] }
  | { ok: false; response: NextResponse };

type WorkspaceContextRpc = {
  memberships: { organization_id: string; role: WorkspaceRole; store_id: string | null }[];
  stores: Store[];
};

/**
 * One round trip via get_workspace_context(). Falls back to the original
 * three queries when the RPC is missing (migration not applied yet), so
 * deploying ahead of the migration does not take every API route down.
 * Remove the fallback once 20261009100000_get_workspace_context.sql is live.
 */
async function loadWorkspaceContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<WorkspaceContextResult> {
  const { data, error } = await supabase.rpc("get_workspace_context");
  if (!error && data) {
    const context = data as WorkspaceContextRpc;
    return {
      ok: true,
      memberships: context.memberships.map((membership) => ({
        organizationId: membership.organization_id,
        role: membership.role,
        storeId: membership.store_id,
      })),
      stores: context.stores,
    };
  }

  const [{ data: membershipRows, error: membershipError }, { data: storeMembershipRows, error: storeMembershipError }] = await Promise.all([
    supabase
      .from("organization_members")
      .select("organization_id,role,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true }),
    supabase
      .from("store_memberships")
      .select("store_id,role,created_at,stores!inner(organization_id)")
      .eq("user_id", userId)
      .order("created_at", { ascending: true }),
  ]);

  if (membershipError || storeMembershipError) {
    return {
      ok: false,
      response: NextResponse.json({ error: membershipError?.message ?? storeMembershipError?.message }, { status: 500 }),
    };
  }

  const memberships: WorkspaceMembership[] = [
    ...(membershipRows ?? []).map((membership) => ({
      organizationId: membership.organization_id,
      role: membership.role as WorkspaceRole,
      storeId: null,
    })),
    ...(storeMembershipRows ?? []).map((membership) => {
      const store = Array.isArray(membership.stores) ? membership.stores[0] : membership.stores;
      return {
        organizationId: store.organization_id,
        role: membership.role as WorkspaceRole,
        storeId: membership.store_id,
      };
    }),
  ];

  if (!memberships.length) {
    return { ok: true, memberships, stores: [] };
  }

  const organizationIds = [...new Set(memberships.map((membership) => membership.organizationId))];
  const { data: storeRows, error: storeError } = await supabase
    .from("stores")
    .select("id,organization_id,name,currency,reporting_currency,timezone,shopify_domain,business_model")
    .in("organization_id", organizationIds)
    .order("created_at", { ascending: true });

  if (storeError) {
    return { ok: false, response: NextResponse.json({ error: storeError.message }, { status: 500 }) };
  }

  return { ok: true, memberships, stores: (storeRows ?? []) as Store[] };
}

export async function requireWorkspace(options: WorkspaceOptions = {}) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Authentication required" }, { status: 401 }),
    };
  }

  const context = await loadWorkspaceContext(supabase, userId);
  if (!context.ok) {
    return { ok: false as const, response: context.response };
  }
  const { memberships, stores } = context;

  if (!memberships.length) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "No workspace is configured" }, { status: 403 }),
    };
  }

  const cookieStore = await cookies();
  const requestedOrganizationId =
    options.organizationId ?? cookieStore.get(activeOrganizationCookie)?.value ?? null;
  const requestedStoreId =
    options.storeId ?? cookieStore.get(activeStoreCookie)?.value ?? null;
  const selected = selectActiveWorkspace({
    memberships,
    stores: stores.map((store) => ({
      id: store.id,
      organizationId: store.organization_id,
    })),
    requestedOrganizationId,
    requestedStoreId,
  });

  if (!selected.membership) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "No workspace is configured" }, { status: 403 }),
    };
  }

  if (
    options.strict &&
    options.organizationId &&
    selected.membership?.organizationId !== options.organizationId
  ) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Workspace access is required" }, { status: 403 }),
    };
  }

  if (
    options.strict &&
    options.storeId &&
    selected.store?.id !== options.storeId
  ) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Store not found in this workspace" }, { status: 404 }),
    };
  }

  const store = stores.find((candidate) => candidate.id === selected.store?.id) ?? null;
  return {
    ok: true as const,
    supabase,
    userId,
    memberships,
    stores,
    membership: {
      ...selected.membership,
      organization_id: selected.membership.organizationId,
    },
    store,
  };
}
