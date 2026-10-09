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

type WorkspaceContextRpc = {
  memberships: { organization_id: string; role: WorkspaceRole; store_id: string | null }[];
  stores: Store[];
};

/** One round trip via get_workspace_context(); RLS decides what it returns. */
async function loadWorkspaceContext(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data, error } = await supabase.rpc("get_workspace_context");
  if (error || !data) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: error?.message ?? "Workspace lookup failed" }, { status: 500 }),
    };
  }
  const context = data as WorkspaceContextRpc;
  return {
    ok: true as const,
    memberships: context.memberships.map((membership) => ({
      organizationId: membership.organization_id,
      role: membership.role,
      storeId: membership.store_id,
    })) satisfies WorkspaceMembership[],
    stores: context.stores,
  };
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

  const context = await loadWorkspaceContext(supabase);
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
