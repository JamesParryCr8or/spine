import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  activeOrganizationCookie,
  activeStoreCookie,
  requireWorkspace,
} from "@/lib/workspace/server";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
};

export async function GET() {
  const result = await requireWorkspace();
  if (!result.ok) return result.response;

  const organizationIds = result.memberships.map((membership) => membership.organizationId);
  const { data: organizations, error } = await result.supabase
    .from("organizations")
    .select("id,name")
    .in("id", organizationIds)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const roles = new Map(
    result.memberships.map((membership) => [membership.organizationId, membership.role]),
  );
  return NextResponse.json({
    activeOrganizationId: result.membership.organizationId,
    activeStoreId: result.store?.id ?? null,
    organizations: (organizations ?? []).map((organization) => ({
      id: organization.id,
      name: organization.name,
      role: roles.get(organization.id),
    })),
    stores: result.stores.map((store) => ({
      id: store.id,
      organizationId: store.organization_id,
      name: store.name,
      currency: store.currency,
      reportingCurrency: store.reporting_currency,
      timezone: store.timezone,
    })),
  });
}

export async function POST(request: Request) {
  const input = await request.json().catch(() => null) as {
    organizationId?: string;
    storeId?: string;
  } | null;
  const organizationId = input?.organizationId?.trim() ?? "";
  const storeId = input?.storeId?.trim() ?? "";
  if (!uuidPattern.test(organizationId) || !uuidPattern.test(storeId)) {
    return NextResponse.json(
      { error: "Valid organization and store ids are required" },
      { status: 400 },
    );
  }

  const result = await requireWorkspace({ organizationId, storeId, strict: true });
  if (!result.ok) return result.response;
  if (!result.store) {
    return NextResponse.json({ error: "No store is configured" }, { status: 404 });
  }

  const cookieStore = await cookies();
  cookieStore.set(activeOrganizationCookie, organizationId, cookieOptions);
  cookieStore.set(activeStoreCookie, storeId, cookieOptions);
  return NextResponse.json({
    activeOrganizationId: organizationId,
    activeStoreId: storeId,
  });
}


export async function PUT(request: Request) {
  const result = await requireWorkspace();
  if (!result.ok) return result.response;
  if (result.membership.role !== "owner" && result.membership.role !== "admin") {
    return NextResponse.json({ error: "Owner or admin access is required" }, { status: 403 });
  }
  const input = await request.json().catch(() => null) as { name?: string } | null;
  const name = input?.name?.trim() ?? "";
  if (name.length < 2 || name.length > 80) {
    return NextResponse.json({ error: "Brand name must be between 2 and 80 characters" }, { status: 400 });
  }
  const templateStore = result.store;
  const { data: store, error } = await result.supabase.from("stores").insert({
    organization_id: result.membership.organizationId,
    name,
    currency: templateStore?.currency ?? "GBP",
    reporting_currency: templateStore?.reporting_currency ?? templateStore?.currency ?? "GBP",
    timezone: templateStore?.timezone ?? "Europe/London",
  }).select("id,organization_id,name,currency,reporting_currency,timezone").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const cookieStore = await cookies();
  cookieStore.set(activeOrganizationCookie, store.organization_id, cookieOptions);
  cookieStore.set(activeStoreCookie, store.id, cookieOptions);
  return NextResponse.json({
    store: {
      id: store.id,
      organizationId: store.organization_id,
      name: store.name,
      currency: store.currency,
      reportingCurrency: store.reporting_currency,
      timezone: store.timezone,
    },
  }, { status: 201 });
}
