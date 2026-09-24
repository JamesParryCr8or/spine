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
      businessModel: store.business_model ?? "ecommerce",
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


export async function PATCH(request: Request) {
  const result = await requireWorkspace();
  if (!result.ok) return result.response;
  if (!result.store) return NextResponse.json({ error: "No store is configured" }, { status: 404 });
  if (!["owner", "admin"].includes(result.membership.role)) return NextResponse.json({ error: "Owner or admin access is required" }, { status: 403 });
  const input = await request.json().catch(() => null) as { name?: string; businessModel?: unknown } | null;
  const changes: { name?: string; business_model?: "ecommerce" | "lead_generation" } = {};
  if (typeof input?.name === "string") {
    const name = input.name.trim();
    if (name.length < 2 || name.length > 80) return NextResponse.json({ error: "Brand name must be between 2 and 80 characters" }, { status: 400 });
    changes.name = name;
  }
  if (input && "businessModel" in input) {
    if (input.businessModel !== "ecommerce" && input.businessModel !== "lead_generation") return NextResponse.json({ error: "Choose ecommerce or lead generation" }, { status: 400 });
    changes.business_model = input.businessModel;
  }
  if (!Object.keys(changes).length) return NextResponse.json({ error: "Choose a brand name or business model to save" }, { status: 400 });
  const { data, error } = await result.supabase.from("stores").update(changes).eq("id", result.store.id).select("id,name,business_model").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ store: data });
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
    business_model: "ecommerce",
  }).select("id,organization_id,name,currency,reporting_currency,timezone,business_model").single();
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
      businessModel: store.business_model ?? "ecommerce",
    },
  }, { status: 201 });
}

export async function DELETE() {
  const result = await requireWorkspace();
  if (!result.ok) return result.response;
  if (!result.store) return NextResponse.json({ error: "No store is configured" }, { status: 404 });
  if (!["owner", "admin"].includes(result.membership.role)) {
    return NextResponse.json({ error: "Owner or admin access is required" }, { status: 403 });
  }

  const { data: stores, error: storesError } = await result.supabase
    .from("stores")
    .select("id,organization_id")
    .eq("organization_id", result.membership.organizationId)
    .order("created_at", { ascending: true });
  if (storesError) return NextResponse.json({ error: storesError.message }, { status: 500 });

  const replacement = (stores ?? []).find((store) => store.id !== result.store!.id);
  if (!replacement) {
    return NextResponse.json({ error: "You cannot delete the only brand in this account" }, { status: 400 });
  }

  const { error } = await result.supabase.from("stores").delete().eq("id", result.store.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const cookieStore = await cookies();
  cookieStore.set(activeOrganizationCookie, replacement.organization_id, cookieOptions);
  cookieStore.set(activeStoreCookie, replacement.id, cookieOptions);
  return NextResponse.json({ activeStoreId: replacement.id });
}
