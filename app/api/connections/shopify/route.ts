import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300;

const SHOPIFY_API_VERSION = "2026-07";
const REQUIRED_SCOPES = ["read_products", "read_inventory", "read_orders", "read_customers"];

type GraphPayload<T> = { data?: T; errors?: { message: string }[] };
type Money = { amount: string; currencyCode: string };
type MoneyBag = { shopMoney: Money; presentmentMoney: Money };
type Visit = {
  id: string; occurredAt: string; landingPage: string | null; referrerUrl: string | null;
  source: string; sourceDescription: string | null; sourceType: string | null;
  utmParameters: { source: string | null; medium: string | null; campaign: string | null; content: string | null; term: string | null } | null;
};
type ShopifyOrder = {
  id: string; legacyResourceId: string; name: string; displayFinancialStatus: string | null;
  displayFulfillmentStatus: string; sourceName: string | null; test: boolean; cancelledAt: string | null;
  processedAt: string | null; createdAt: string; updatedAt: string; currencyCode: string;
  currentSubtotalPriceSet: MoneyBag; currentTotalDiscountsSet: MoneyBag; currentShippingPriceSet: MoneyBag;
  currentTotalTaxSet: MoneyBag; currentTotalDutiesSet: MoneyBag | null; currentTotalPriceSet: MoneyBag;
  customer: { id: string; legacyResourceId: string; displayName: string; defaultEmailAddress: { emailAddress: string } | null; numberOfOrders: string; amountSpent: Money; createdAt: string; updatedAt: string } | null;
  lineItems: { nodes: Array<{ id: string; title: string; variantTitle: string | null; sku: string | null; vendor: string | null; quantity: number; currentQuantity: number; product: { id: string } | null; variant: { id: string } | null; originalUnitPriceSet: MoneyBag; originalTotalSet: MoneyBag; totalDiscountSet: MoneyBag; discountedTotalSet: MoneyBag }>; pageInfo: { hasNextPage: boolean } };
  refunds: Array<{ id: string; legacyResourceId: string; note: string | null; createdAt: string | null; processedAt: string; updatedAt: string; totalRefundedSet: MoneyBag; refundLineItems: { nodes: Array<{ id: string; quantity: number; restockType: string; subtotalSet: MoneyBag; lineItem: { id: string } }>; pageInfo: { hasNextPage: boolean } } }>;
  transactions: { nodes: Array<{ id: string; kind: string; status: string; gateway: string | null; formattedGateway: string | null; amountSet: MoneyBag; fees: Array<{ amount: Money; taxAmount: Money }>; createdAt: string; processedAt: string | null }>; pageInfo: { hasNextPage: boolean } };
  customerJourneySummary: { ready: boolean; daysToConversion: number | null; customerOrderIndex: number | null; firstVisit: Visit | null; lastVisit: Visit | null } | null;
};

function normalizeShopDomain(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function money(value?: MoneyBag | null) {
  return value?.shopMoney.amount ?? "0";
}

function dedupeByShopifyId<T extends { shopify_gid: string }>(rows: T[]) {
  return [...new Map(rows.map((row) => [row.shopify_gid, row])).values()];
}

function visitRow(visit: Visit | null, model: "first_touch" | "last_touch", shared: Record<string, unknown>, journey: NonNullable<ShopifyOrder["customerJourneySummary"]>) {
  return {
    ...shared, attribution_model: model, visit_gid: visit?.id ?? null, occurred_at: visit?.occurredAt ?? null,
    landing_page: visit?.landingPage ?? null, referrer_url: visit?.referrerUrl ?? null,
    source: visit?.source ?? null, source_description: visit?.sourceDescription ?? null, source_type: visit?.sourceType ?? null,
    utm_source: visit?.utmParameters?.source ?? null, utm_medium: visit?.utmParameters?.medium ?? null,
    utm_campaign: visit?.utmParameters?.campaign ?? null, utm_content: visit?.utmParameters?.content ?? null,
    utm_term: visit?.utmParameters?.term ?? null, days_to_conversion: journey.daysToConversion,
    customer_order_index: journey.customerOrderIndex, ready: journey.ready, synced_at: new Date().toISOString(),
  };
}

async function shopifyGraph<T>(shop: string, token: string, query: string, variables: Record<string, unknown> = {}) {
  const response = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }), cache: "no-store",
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
  const [membershipResult, connectionResult] = await Promise.all([
    supabase.from("organization_members").select("organization_id").eq("user_id", claims.claims.sub).limit(1).maybeSingle(),
    supabase.from("data_connections").select("provider,status,external_account_id,external_account_name,last_verified_at,last_error").eq("provider", "shopify").maybeSingle(),
  ]);
  if (membershipResult.error) return NextResponse.json({ error: membershipResult.error.message }, { status: 500 });
  if (!membershipResult.data) return NextResponse.json({ error: "No workspace is configured" }, { status: 403 });
  const [storeResult, syncResult] = await Promise.all([
    supabase.from("stores").select("name,shopify_domain,currency,reporting_currency,timezone").eq("organization_id", membershipResult.data.organization_id).limit(1).maybeSingle(),
    supabase.from("sync_runs").select("status,records_processed,warnings,error_message,completed_at,updated_at").eq("source", "shopify").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const error = connectionResult.error ?? storeResult.error ?? syncResult.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ connection: connectionResult.data, store: storeResult.data, sync: syncResult.data });
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

  let runId: string | null = null;
  try {
    const shopData = await shopifyGraph<{ shop: { id: string; name: string; myshopifyDomain: string; currencyCode: string; ianaTimezone: string }; currentAppInstallation: { accessScopes: Array<{ handle: string }> } }>(shopDomain, accessToken, `query ShopIdentity { shop { id name myshopifyDomain currencyCode ianaTimezone } currentAppInstallation { accessScopes { handle } } }`);
    const grantedScopes = new Set(shopData.currentAppInstallation.accessScopes.map((scope) => scope.handle));
    const missingScopes = REQUIRED_SCOPES.filter((scope) => !grantedScopes.has(scope));
    if (missingScopes.length) throw new Error(`Add these Shopify Admin API scopes and reinstall the app: ${missingScopes.join(", ")}`);

    const [{ data: membership }, { data: store }] = await Promise.all([
      supabase.from("organization_members").select("organization_id").eq("user_id", userId).limit(1).single(),
      supabase.from("stores").select("id,organization_id").limit(1).single(),
    ]);
    if (!membership || !store || membership.organization_id !== store.organization_id) throw new Error("No workspace store is configured");

    const { error: storeError } = await supabase.from("stores").update({ name: shopData.shop.name, shopify_domain: shopData.shop.myshopifyDomain, currency: shopData.shop.currencyCode, reporting_currency: shopData.shop.currencyCode, timezone: shopData.shop.ianaTimezone, updated_at: new Date().toISOString() }).eq("id", store.id);
    if (storeError) throw new Error(storeError.message);
    const { error: connectionError } = await supabase.rpc("save_data_connection", { connection_provider: "shopify", access_token: accessToken, account_id: shopData.shop.id, account_name: shopData.shop.name });
    if (connectionError) throw new Error(connectionError.message);

    const staleBefore = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    const { data: existingRun, error: existingRunError } = await supabase
      .from("sync_runs")
      .select("id,cursor,records_processed,updated_at")
      .eq("store_id", store.id)
      .eq("source", "shopify")
      .eq("status", "running")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingRunError) throw new Error(existingRunError.message);
    if (existingRun && existingRun.updated_at >= staleBefore) {
      return NextResponse.json({ error: "A Shopify import is already running. Leave this page open and refresh the dashboard in a few minutes." }, { status: 409 });
    }
    const resumed = Boolean(existingRun?.cursor);
    const { data: run, error: runError } = existingRun
      ? { data: existingRun, error: null }
      : await supabase.from("sync_runs").insert({ organization_id: membership.organization_id, store_id: store.id, source: "shopify", resource: "catalog_orders", status: "running", created_by: userId }).select("id,cursor,records_processed,updated_at").single();
    if (runError || !run) throw new Error(runError?.message ?? "Could not create sync run");
    runId = run.id;
    const priorRecordsProcessed = run.records_processed ?? 0;

    let productCursor: string | null = null;
    let productsProcessed = 0;
    do {
      const result: { products: { nodes: Array<{ id: string; legacyResourceId: string; title: string; handle: string; status: string; vendor: string; productType: string; createdAt: string; updatedAt: string; featuredMedia?: { preview?: { image?: { url?: string } } } }>; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } = await shopifyGraph(shopDomain, accessToken, `query Products($cursor:String){ products(first:100,after:$cursor,sortKey:ID){ nodes{id legacyResourceId title handle status vendor productType createdAt updatedAt featuredMedia{preview{image{url}}}} pageInfo{hasNextPage endCursor} } }`, { cursor: productCursor });
      const rows = result.products.nodes.map((product) => ({ organization_id: membership.organization_id, store_id: store.id, shopify_gid: product.id, legacy_resource_id: product.legacyResourceId, title: product.title, handle: product.handle, status: product.status, vendor: product.vendor || null, product_type: product.productType || null, featured_image_url: product.featuredMedia?.preview?.image?.url ?? null, created_at_shopify: product.createdAt, updated_at_shopify: product.updatedAt, synced_at: new Date().toISOString() }));
      if (rows.length) { const { error } = await supabase.from("shopify_products").upsert(dedupeByShopifyId(rows), { onConflict: "store_id,shopify_gid" }); if (error) throw new Error(error.message); }
      productsProcessed += resumed ? 0 : rows.length;
      productCursor = result.products.pageInfo.hasNextPage ? result.products.pageInfo.endCursor : null;
    } while (productCursor);

    const { data: productIds, error: productIdsError } = await supabase.from("shopify_products").select("id,shopify_gid").eq("store_id", store.id);
    if (productIdsError) throw new Error(productIdsError.message);
    const productMap = new Map((productIds ?? []).map((product) => [product.shopify_gid, product.id]));
    let variantCursor: string | null = null;
    let variantsProcessed = 0;
    do {
      const result: { productVariants: { nodes: Array<{ id: string; legacyResourceId: string; title: string; sku: string | null; barcode: string | null; price: string; compareAtPrice: string | null; inventoryQuantity: number | null; createdAt: string; updatedAt: string; product: { id: string }; inventoryItem: { id: string; unitCost?: { amount: string; currencyCode: string } | null } }>; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } = await shopifyGraph(shopDomain, accessToken, `query Variants($cursor:String){ productVariants(first:100,after:$cursor,sortKey:ID){ nodes{id legacyResourceId title sku barcode price compareAtPrice inventoryQuantity createdAt updatedAt product{id} inventoryItem{id unitCost{amount currencyCode}}} pageInfo{hasNextPage endCursor} } }`, { cursor: variantCursor });
      const rows = result.productVariants.nodes.flatMap((variant) => { const productId = productMap.get(variant.product.id); return productId ? [{ organization_id: membership.organization_id, store_id: store.id, product_id: productId, shopify_gid: variant.id, legacy_resource_id: variant.legacyResourceId, title: variant.title, sku: variant.sku, barcode: variant.barcode, price: variant.price, compare_at_price: variant.compareAtPrice, inventory_quantity: variant.inventoryQuantity, inventory_item_gid: variant.inventoryItem.id, shopify_unit_cost: variant.inventoryItem.unitCost?.amount ?? null, currency: variant.inventoryItem.unitCost?.currencyCode ?? shopData.shop.currencyCode, created_at_shopify: variant.createdAt, updated_at_shopify: variant.updatedAt, synced_at: new Date().toISOString() }] : []; });
      if (rows.length) { const { error } = await supabase.from("shopify_variants").upsert(rows, { onConflict: "store_id,shopify_gid" }); if (error) throw new Error(error.message); }
      variantsProcessed += resumed ? 0 : rows.length;
      variantCursor = result.productVariants.pageInfo.hasNextPage ? result.productVariants.pageInfo.endCursor : null;
    } while (variantCursor);

    let orderCursor: string | null = run.cursor ?? null;
    let ordersProcessed = 0, orderLinesProcessed = 0, customersProcessed = 0, refundsProcessed = 0, refundLinesProcessed = 0, transactionsProcessed = 0, attributionProcessed = 0;
    const warnings: string[] = [];
    do {
      const result: { orders: { nodes: ShopifyOrder[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } = await shopifyGraph(shopDomain, accessToken, `query Orders($cursor:String){ orders(first:25,after:$cursor,sortKey:UPDATED_AT){ nodes{
        id legacyResourceId name displayFinancialStatus displayFulfillmentStatus sourceName test cancelledAt processedAt createdAt updatedAt currencyCode
        currentSubtotalPriceSet{shopMoney{amount currencyCode} presentmentMoney{amount currencyCode}} currentTotalDiscountsSet{shopMoney{amount currencyCode} presentmentMoney{amount currencyCode}} currentShippingPriceSet{shopMoney{amount currencyCode} presentmentMoney{amount currencyCode}} currentTotalTaxSet{shopMoney{amount currencyCode} presentmentMoney{amount currencyCode}} currentTotalDutiesSet{shopMoney{amount currencyCode} presentmentMoney{amount currencyCode}} currentTotalPriceSet{shopMoney{amount currencyCode} presentmentMoney{amount currencyCode}}
        customer{id legacyResourceId displayName defaultEmailAddress{emailAddress} numberOfOrders amountSpent{amount currencyCode} createdAt updatedAt}
        lineItems(first:100){nodes{id title variantTitle sku vendor quantity currentQuantity product{id} variant{id} originalUnitPriceSet{shopMoney{amount currencyCode} presentmentMoney{amount currencyCode}} originalTotalSet{shopMoney{amount currencyCode} presentmentMoney{amount currencyCode}} totalDiscountSet{shopMoney{amount currencyCode} presentmentMoney{amount currencyCode}} discountedTotalSet(withCodeDiscounts:true){shopMoney{amount currencyCode} presentmentMoney{amount currencyCode}}} pageInfo{hasNextPage}}
        refunds(first:50){id legacyResourceId note createdAt processedAt updatedAt totalRefundedSet{shopMoney{amount currencyCode} presentmentMoney{amount currencyCode}} refundLineItems(first:100){nodes{id quantity restockType subtotalSet{shopMoney{amount currencyCode} presentmentMoney{amount currencyCode}} lineItem{id}} pageInfo{hasNextPage}}}
        transactions(first:100){nodes{id kind status gateway formattedGateway amountSet{shopMoney{amount currencyCode} presentmentMoney{amount currencyCode}} fees{amount{amount currencyCode} taxAmount{amount currencyCode}} createdAt processedAt} pageInfo{hasNextPage}}
        customerJourneySummary{ready daysToConversion customerOrderIndex firstVisit{id occurredAt landingPage referrerUrl source sourceDescription sourceType utmParameters{source medium campaign content term}} lastVisit{id occurredAt landingPage referrerUrl source sourceDescription sourceType utmParameters{source medium campaign content term}}}
      } pageInfo{hasNextPage endCursor} } }`, { cursor: orderCursor });

      const customers = dedupeByShopifyId(result.orders.nodes.flatMap((order) => order.customer ? [{ organization_id: membership.organization_id, store_id: store.id, shopify_gid: order.customer.id, legacy_resource_id: order.customer.legacyResourceId, display_name: order.customer.displayName, email: order.customer.defaultEmailAddress?.emailAddress ?? null, number_of_orders: order.customer.numberOfOrders, amount_spent: order.customer.amountSpent.amount, currency: order.customer.amountSpent.currencyCode, created_at_shopify: order.customer.createdAt, updated_at_shopify: order.customer.updatedAt, synced_at: new Date().toISOString() }] : []));
      if (customers.length) { const { error } = await supabase.from("shopify_customers").upsert(dedupeByShopifyId(customers), { onConflict: "store_id,shopify_gid" }); if (error) throw new Error(error.message); }
      customersProcessed += customers.length;
      const customerGids = customers.map((customer) => customer.shopify_gid);
      const customerResult = customerGids.length ? await supabase.from("shopify_customers").select("id,shopify_gid").eq("store_id", store.id).in("shopify_gid", customerGids) : { data: [], error: null };
      if (customerResult.error) throw new Error(customerResult.error.message);
      const customerMap = new Map((customerResult.data ?? []).map((customer) => [customer.shopify_gid, customer.id]));

      const orderRows = result.orders.nodes.map((order) => ({ organization_id: membership.organization_id, store_id: store.id, customer_id: order.customer ? customerMap.get(order.customer.id) ?? null : null, shopify_gid: order.id, legacy_resource_id: order.legacyResourceId, order_name: order.name, financial_status: order.displayFinancialStatus, fulfillment_status: order.displayFulfillmentStatus, source_name: order.sourceName, test: order.test, cancelled_at: order.cancelledAt, processed_at: order.processedAt, created_at_shopify: order.createdAt, updated_at_shopify: order.updatedAt, currency: order.currencyCode, presentment_currency: order.currentTotalPriceSet.presentmentMoney.currencyCode, gross_sales: order.lineItems.nodes.reduce((sum, line) => sum + Number(money(line.originalTotalSet)), 0).toFixed(4), discounts: money(order.currentTotalDiscountsSet), net_product_sales: money(order.currentSubtotalPriceSet), shipping_revenue: money(order.currentShippingPriceSet), tax: money(order.currentTotalTaxSet), duties: money(order.currentTotalDutiesSet), total_sales: money(order.currentTotalPriceSet), synced_at: new Date().toISOString() }));
      if (orderRows.length) { const { error } = await supabase.from("shopify_orders").upsert(dedupeByShopifyId(orderRows), { onConflict: "store_id,shopify_gid" }); if (error) throw new Error(error.message); }
      ordersProcessed += orderRows.length;
      const orderGids = orderRows.map((order) => order.shopify_gid);
      const orderResult = orderGids.length ? await supabase.from("shopify_orders").select("id,shopify_gid").eq("store_id", store.id).in("shopify_gid", orderGids) : { data: [], error: null };
      if (orderResult.error) throw new Error(orderResult.error.message);
      const orderMap = new Map((orderResult.data ?? []).map((order) => [order.shopify_gid, order.id]));

      const transactionRows = result.orders.nodes.flatMap((order) => {
        const orderId = orderMap.get(order.id);
        if (!orderId) return [];
        if (order.transactions.pageInfo.hasNextPage) warnings.push(`${order.name} has more than 100 transactions; import is partial`);
        return order.transactions.nodes.map((transaction) => ({
          organization_id: membership.organization_id, store_id: store.id, order_id: orderId, shopify_gid: transaction.id,
          kind: transaction.kind, status: transaction.status, gateway: transaction.gateway, formatted_gateway: transaction.formattedGateway,
          amount: money(transaction.amountSet), currency: transaction.amountSet.shopMoney.currencyCode,
          fee_amount: transaction.fees.reduce((total, fee) => total + Number(fee.amount.amount), 0).toFixed(4),
          fee_tax: transaction.fees.reduce((total, fee) => total + Number(fee.taxAmount.amount), 0).toFixed(4),
          created_at_shopify: transaction.createdAt, processed_at_shopify: transaction.processedAt, synced_at: new Date().toISOString(),
        }));
      });
      if (transactionRows.length) { const { error } = await supabase.from("shopify_transactions").upsert(dedupeByShopifyId(transactionRows), { onConflict: "store_id,shopify_gid" }); if (error) throw new Error(error.message); }
      transactionsProcessed += transactionRows.length;

      const lineRows = result.orders.nodes.flatMap((order) => { const orderId = orderMap.get(order.id); if (!orderId) return []; if (order.lineItems.pageInfo.hasNextPage) warnings.push(`${order.name} has more than 100 line items; import is partial`); return order.lineItems.nodes.map((line) => ({ organization_id: membership.organization_id, store_id: store.id, order_id: orderId, shopify_gid: line.id, product_gid: line.product?.id ?? null, variant_gid: line.variant?.id ?? null, title: line.title, variant_title: line.variantTitle, sku: line.sku, vendor: line.vendor, quantity: line.quantity, current_quantity: line.currentQuantity, unit_price: money(line.originalUnitPriceSet), original_total: money(line.originalTotalSet), discounts: money(line.totalDiscountSet), net_sales: money(line.discountedTotalSet), currency: line.originalTotalSet.shopMoney.currencyCode, synced_at: new Date().toISOString() })); });
      if (lineRows.length) { const { error } = await supabase.from("shopify_order_lines").upsert(dedupeByShopifyId(lineRows), { onConflict: "store_id,shopify_gid" }); if (error) throw new Error(error.message); }
      orderLinesProcessed += lineRows.length;
      const lineGids = lineRows.map((line) => line.shopify_gid);
      const lineResult = lineGids.length ? await supabase.from("shopify_order_lines").select("id,shopify_gid").eq("store_id", store.id).in("shopify_gid", lineGids) : { data: [], error: null };
      if (lineResult.error) throw new Error(lineResult.error.message);
      const lineMap = new Map((lineResult.data ?? []).map((line) => [line.shopify_gid, line.id]));

      const refundRows = result.orders.nodes.flatMap((order) => { const orderId = orderMap.get(order.id); if (!orderId) return []; if (order.refunds.length === 50) warnings.push(`${order.name} has at least 50 refunds; import may be partial`); return order.refunds.map((refund) => ({ organization_id: membership.organization_id, store_id: store.id, order_id: orderId, shopify_gid: refund.id, legacy_resource_id: refund.legacyResourceId, note: refund.note, total_refunded: money(refund.totalRefundedSet), currency: refund.totalRefundedSet.shopMoney.currencyCode, created_at_shopify: refund.createdAt, processed_at_shopify: refund.processedAt, updated_at_shopify: refund.updatedAt, synced_at: new Date().toISOString() })); });
      if (refundRows.length) { const { error } = await supabase.from("shopify_refunds").upsert(dedupeByShopifyId(refundRows), { onConflict: "store_id,shopify_gid" }); if (error) throw new Error(error.message); }
      refundsProcessed += refundRows.length;
      const refundGids = refundRows.map((refund) => refund.shopify_gid);
      const refundResult = refundGids.length ? await supabase.from("shopify_refunds").select("id,shopify_gid").eq("store_id", store.id).in("shopify_gid", refundGids) : { data: [], error: null };
      if (refundResult.error) throw new Error(refundResult.error.message);
      const refundMap = new Map((refundResult.data ?? []).map((refund) => [refund.shopify_gid, refund.id]));

      const refundLineRows = result.orders.nodes.flatMap((order) => order.refunds.flatMap((refund) => { const refundId = refundMap.get(refund.id); if (!refundId) return []; if (refund.refundLineItems.pageInfo.hasNextPage) warnings.push(`${order.name} refund ${refund.legacyResourceId} has more than 100 lines; import is partial`); return refund.refundLineItems.nodes.map((line) => ({ organization_id: membership.organization_id, store_id: store.id, refund_id: refundId, order_line_id: lineMap.get(line.lineItem.id) ?? null, shopify_gid: line.id, line_item_gid: line.lineItem.id, quantity: line.quantity, subtotal: money(line.subtotalSet), currency: line.subtotalSet.shopMoney.currencyCode, restock_type: line.restockType, synced_at: new Date().toISOString() })); }));
      if (refundLineRows.length) { const { error } = await supabase.from("shopify_refund_lines").upsert(dedupeByShopifyId(refundLineRows), { onConflict: "store_id,shopify_gid" }); if (error) throw new Error(error.message); }
      refundLinesProcessed += refundLineRows.length;

      const attributionRows = result.orders.nodes.flatMap((order) => { const orderId = orderMap.get(order.id); const journey = order.customerJourneySummary; if (!orderId || !journey) return []; const shared = { organization_id: membership.organization_id, store_id: store.id, order_id: orderId }; return [visitRow(journey.firstVisit, "first_touch", shared, journey), visitRow(journey.lastVisit, "last_touch", shared, journey)]; });
      if (attributionRows.length) { const { error } = await supabase.from("shopify_order_attribution").upsert(attributionRows, { onConflict: "order_id,attribution_model" }); if (error) throw new Error(error.message); }
      attributionProcessed += attributionRows.length;

      orderCursor = result.orders.pageInfo.hasNextPage ? result.orders.pageInfo.endCursor : null;
      const recordsProcessed = priorRecordsProcessed + productsProcessed + variantsProcessed + ordersProcessed + orderLinesProcessed + customersProcessed + refundsProcessed + refundLinesProcessed + transactionsProcessed + attributionProcessed;
      const { error: progressError } = await supabase.from("sync_runs").update({ cursor: orderCursor, records_processed: recordsProcessed, warnings, updated_at: new Date().toISOString() }).eq("id", run.id);
      if (progressError) throw new Error(progressError.message);
    } while (orderCursor);

    const recordsProcessed = priorRecordsProcessed + productsProcessed + variantsProcessed + ordersProcessed + orderLinesProcessed + customersProcessed + refundsProcessed + refundLinesProcessed + transactionsProcessed + attributionProcessed;
    const { error: completeError } = await supabase.from("sync_runs").update({ status: "completed", cursor: null, records_processed: recordsProcessed, warnings, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", run.id);
    if (completeError) throw new Error(completeError.message);
    return NextResponse.json({ connection: { provider: "shopify", status: "connected", external_account_id: shopData.shop.id, external_account_name: shopData.shop.name }, resumed, sync: { products: productsProcessed, variants: variantsProcessed, orders: ordersProcessed, orderLines: orderLinesProcessed, customers: customersProcessed, refunds: refundsProcessed, refundLines: refundLinesProcessed, transactions: transactionsProcessed, attribution: attributionProcessed, warnings: warnings.length } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Shopify connection failed";
    if (runId) await supabase.from("sync_runs").update({ status: "failed", error_message: message.slice(0, 500), completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", runId);
    return NextResponse.json({ error: message }, { status: 400 });
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
