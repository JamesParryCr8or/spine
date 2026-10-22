import "server-only";
import { loadWarehouseActivity } from "@/lib/shopify/warehouse-activity";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadPnlInputs, type PnlStore, type PnlRange, type PnlInputs } from "./pnl-engine";
import { latestCost } from "./effective-cost";
import { resolveDatedExchangeRate } from "./exchange-rate";
import { runStoreShopifyQl } from "@/lib/shopify/shopifyql";

/** Call only after workspace authorization (or from the authenticated report job). */
export async function loadReportingPnlInputs(supabase: SupabaseClient, store: PnlStore & { shopify_domain?: string | null }, range: PnlRange) {
  const loaded = await loadPnlInputs(supabase, store, range);
  if (!loaded.ok) return loaded;
  const inputs = loaded.inputs;
  const dates = [...inputs.shopifyDaily.map((row) => row.sales_date), ...inputs.orders.flatMap((row) => row.processed_at ? [row.processed_at.slice(0, 10)] : [])].sort();
  const from = range.from ?? dates[0];
  const to = range.to ?? dates.at(-1);
  if (!from || !to) return loaded;
  if (inputs.storeCostDefault?.warehouse_costs?.length) {
    if (inputs.storeCostDefault.currency !== store.currency) return { ok: false as const, error: "Re-save warehouse rates in the store reporting currency" };
    try { inputs.warehouseActivity = await loadWarehouseActivity(store, from, to); }
    catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : "Could not load warehouse fulfilments" }; }
  }
  if (inputs.storeCostDefault?.cogs_method !== "latest") return loaded;
  inputs.latestCogs = [];
  const byGid = new Map(inputs.variants.map((variant) => [variant.shopify_gid, variant]));
  const skuVariants = new Map<string, typeof inputs.variants>();
  for (const variant of inputs.variants) {
    const sku = variant.sku?.trim().toLowerCase();
    if (sku) skuVariants.set(sku, [...(skuVariants.get(sku) ?? []), variant]);
  }
  const number = (value: unknown) => {
    const parsed = Number(value);
    if (value === null || value === undefined || !Number.isFinite(parsed)) throw new Error("Shopify returned an invalid quantity or amount for historical COGS");
    return parsed;
  };
  let previousPage = "";
  try {
    for (let offset = 0; offset < 1000000; offset += 1000) {
      const query = `FROM sales SHOW net_items_sold, net_sales GROUP BY day, product_variant_id, product_variant_sku SINCE ${from} UNTIL ${to} ORDER BY day ASC, product_variant_id ASC, product_variant_sku ASC LIMIT 1000 OFFSET ${offset}`;
      const result = await runStoreShopifyQl({ id: store.id, shopify_domain: store.shopify_domain ?? null }, { cogs: query });
      if (!result.ok) return { ok: false as const, error: `Could not load quantities for latest Spine COGS: ${result.error}` };
      const rows = result.results.cogs;
      const fingerprint = JSON.stringify(rows);
      if (rows.length && fingerprint === previousPage) throw new Error("Shopify repeated a COGS page; please retry");
      previousPage = fingerprint;
      for (const row of rows) {
        const date = String(row.day).slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < from || date > to) throw new Error("Shopify returned an invalid COGS date");
        const units = number(row.net_items_sold);
        const sales = number(row.net_sales);
        const sku = String(row.product_variant_sku ?? "").trim().toLowerCase();
        const id = String(row.product_variant_id ?? "");
        const gid = id.startsWith("gid://") ? id : `gid://shopify/ProductVariant/${id}`;
        const matches = skuVariants.get(sku) ?? [];
        const variant = byGid.get(gid) ?? (matches.length === 1 ? matches[0] : undefined);
        const variantCosts = variant ? inputs.productCosts.filter((cost) => cost.variant_id === variant.id) : [];
        const cost = latestCost(variantCosts.length ? variantCosts : inputs.productCosts.filter((cost) => !cost.variant_id && sku && cost.sku?.trim().toLowerCase() === sku));
        let source: NonNullable<PnlInputs["latestCogs"]>[number]["source"] = "missing";
        let amount = 0;
        const unitCost = cost ? number(cost.amount) : variant?.shopify_unit_cost != null ? number(variant.shopify_unit_cost) : null;
        if (unitCost !== null) {
          const fx = resolveDatedExchangeRate(inputs.exchangeRates, cost?.currency ?? variant?.currency ?? store.currency, store.currency, date);
          if (fx !== null) { amount = units * unitCost * fx; source = cost ? "spine" : "shopify"; }
        } else if (inputs.storeCostDefault?.currency === store.currency && Number(inputs.storeCostDefault.default_cogs_percent) > 0) {
          amount = sales * Number(inputs.storeCostDefault.default_cogs_percent) / 100;
          source = "estimate";
        } else if (units === 0) source = "spine";
        inputs.latestCogs.push({ date, amount, source });
      }
      if (rows.length < 1000) {
        if (!inputs.latestCogs.length && inputs.shopifyDaily.some((day) => Number(day.net_items_sold) !== 0)) {
          throw new Error("Shopify returned no product quantities for reported sales; please retry");
        }
        return loaded;
      }
    }
    throw new Error("Historical COGS report is too large; choose a shorter period");
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Could not calculate latest Spine COGS" };
  }
}
