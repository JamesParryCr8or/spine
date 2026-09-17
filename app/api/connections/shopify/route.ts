import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

const SHOPIFY_API_VERSION = "2026-07";

type GraphPayload<T> = { data?: T; errors?: { message: string }[] };

function normalizeShopDomain(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
}

async function shopifyGraph<T>(shop: string, token: string, query: string, variables: Record<string, unknown> = {}) {
  const response = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({})) as GraphPayload<T>;
  if (!response.ok || payload.errors?.length) throw new Error(payload.errors?.map((item) => item.message).join(", ") || `Shopify returned ${response.status}`);
  if (!payload.data) throw new Error("Shopify returned no data");
  return payload.data;
}

export async function GET() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const { data, error } = await supabase.from("data_connections").select("provider,status,external_account_id,external_account_name,last_verified_at,last_error").eq("provider", "shopify").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ connection: data });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const body = await request.json().catch(() => null) as { shopDomain?: string; accessToken?: string } | null;
  const shopDomain = normalizeShopDomain(body?.shopDomain ?? "");
  const accessToken = body?.accessToken?.trim();
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shopDomain)) return NextResponse.json({ error: "Use your-store.myshopify.com" }, { status: 400 });
  if (!accessToken) return NextResponse.json({ error: "Admin API access token is required" }, { status: 400 });

  try {
    const shopData = await shopifyGraph<{ shop: { id: string; name: string; myshopifyDomain: string; currencyCode: string; ianaTimezone: string } }>(shopDomain, accessToken, `query ShopIdentity { shop { id name myshopifyDomain currencyCode ianaTimezone } }`);
    const [{ data: membership }, { data: store }] = await Promise.all([
      supabase.from("organization_members").select("organization_id").eq("user_id", userId).limit(1).single(),
      supabase.from("stores").select("id,organization_id").limit(1).single(),
    ]);
    if (!membership || !store) throw new Error("No workspace store is configured");

    await supabase.from("stores").update({ name: shopData.shop.name, shopify_domain: shopData.shop.myshopifyDomain, currency: shopData.shop.currencyCode, reporting_currency: shopData.shop.currencyCode, timezone: shopData.shop.ianaTimezone }).eq("id", store.id);
    const { error: connectionError } = await supabase.rpc("save_data_connection", { connection_provider: "shopify", access_token: accessToken, account_id: shopData.shop.id, account_name: shopData.shop.name });
    if (connectionError) throw new Error(connectionError.message);

    const { data: run, error: runError } = await supabase.from("sync_runs").insert({ organization_id: membership.organization_id, store_id: store.id, source: "shopify", resource: "catalog", status: "running", created_by: userId }).select("id").single();
    if (runError || !run) throw new Error(runError?.message ?? "Could not create sync run");

    let productCursor: string | null = null;
    let productsProcessed = 0;
    do {
      const result: { products: { nodes: Array<{ id:string; legacyResourceId:string; title:string; handle:string; status:string; vendor:string; productType:string; createdAt:string; updatedAt:string; featuredMedia?:{preview?:{image?:{url?:string}}} }>; pageInfo:{hasNextPage:boolean;endCursor:string|null} } } = await shopifyGraph(shopDomain, accessToken, `query Products($cursor:String){ products(first:100,after:$cursor,sortKey:ID){ nodes{id legacyResourceId title handle status vendor productType createdAt updatedAt featuredMedia{preview{image{url}}}} pageInfo{hasNextPage endCursor} } }`, { cursor: productCursor });
      const rows = result.products.nodes.map((product) => ({ organization_id: membership.organization_id, store_id: store.id, shopify_gid: product.id, legacy_resource_id: product.legacyResourceId, title: product.title, handle: product.handle, status: product.status, vendor: product.vendor || null, product_type: product.productType || null, featured_image_url: product.featuredMedia?.preview?.image?.url ?? null, created_at_shopify: product.createdAt, updated_at_shopify: product.updatedAt, synced_at: new Date().toISOString() }));
      if (rows.length) { const { error } = await supabase.from("shopify_products").upsert(rows, { onConflict: "store_id,shopify_gid" }); if (error) throw new Error(error.message); }
      productsProcessed += rows.length;
      productCursor = result.products.pageInfo.hasNextPage ? result.products.pageInfo.endCursor : null;
    } while (productCursor);

    const { data: productIds } = await supabase.from("shopify_products").select("id,shopify_gid").eq("store_id", store.id);
    const productMap = new Map((productIds ?? []).map((product) => [product.shopify_gid, product.id]));
    let variantCursor: string | null = null;
    let variantsProcessed = 0;
    do {
      const result: { productVariants: { nodes:Array<{id:string;legacyResourceId:string;title:string;sku:string|null;barcode:string|null;price:string;compareAtPrice:string|null;inventoryQuantity:number|null;createdAt:string;updatedAt:string;product:{id:string};inventoryItem:{id:string;unitCost?:{amount:string;currencyCode:string}|null}}>; pageInfo:{hasNextPage:boolean;endCursor:string|null} } } = await shopifyGraph(shopDomain, accessToken, `query Variants($cursor:String){ productVariants(first:100,after:$cursor,sortKey:ID){ nodes{id legacyResourceId title sku barcode price compareAtPrice inventoryQuantity createdAt updatedAt product{id} inventoryItem{id unitCost{amount currencyCode}}} pageInfo{hasNextPage endCursor} } }`, { cursor: variantCursor });
      const rows = result.productVariants.nodes.flatMap((variant) => { const productId = productMap.get(variant.product.id); return productId ? [{ organization_id: membership.organization_id, store_id: store.id, product_id: productId, shopify_gid: variant.id, legacy_resource_id: variant.legacyResourceId, title: variant.title, sku: variant.sku, barcode: variant.barcode, price: variant.price, compare_at_price: variant.compareAtPrice, inventory_quantity: variant.inventoryQuantity, inventory_item_gid: variant.inventoryItem.id, shopify_unit_cost: variant.inventoryItem.unitCost?.amount ?? null, currency: variant.inventoryItem.unitCost?.currencyCode ?? shopData.shop.currencyCode, created_at_shopify: variant.createdAt, updated_at_shopify: variant.updatedAt, synced_at: new Date().toISOString() }] : []; });
      if (rows.length) { const { error } = await supabase.from("shopify_variants").upsert(rows, { onConflict: "store_id,shopify_gid" }); if (error) throw new Error(error.message); }
      variantsProcessed += rows.length;
      variantCursor = result.productVariants.pageInfo.hasNextPage ? result.productVariants.pageInfo.endCursor : null;
    } while (variantCursor);

    await supabase.from("sync_runs").update({ status: "completed", records_processed: productsProcessed + variantsProcessed, completed_at: new Date().toISOString() }).eq("id", run.id);
    return NextResponse.json({ connection: { provider: "shopify", status: "connected", external_account_id: shopData.shop.id, external_account_name: shopData.shop.name }, sync: { products: productsProcessed, variants: variantsProcessed } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Shopify connection failed" }, { status: 400 });
  }
}

export async function DELETE() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const { error } = await supabase.rpc("delete_data_connection", { connection_provider: "shopify" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
