import { NextResponse } from "next/server";

import { shopifyGraph } from "@/lib/shopify/graphql";
import { requireWorkspace } from "@/lib/workspace/server";

type ShopifyRow = Record<string, string | number | null>;
type ShopifyQlPayload = {
  shopifyqlQuery: {
    tableData: { rows: ShopifyRow[] } | null;
    parseErrors: string[];
  };
};

const graphQuery = `query CustomerReports($shopifyQl: String!) {
  shopifyqlQuery(query: $shopifyQl) {
    tableData { rows }
    parseErrors
  }
}`;

function number(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? "0").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function date(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

async function run(shop: string, token: string, query: string) {
  const result = await shopifyGraph<ShopifyQlPayload>(shop, token, graphQuery, { shopifyQl: query });
  if (result.shopifyqlQuery.parseErrors?.length) {
    throw new Error(result.shopifyqlQuery.parseErrors.join("; "));
  }
  return result.shopifyqlQuery.tableData?.rows ?? [];
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const focus = params.get("focus");
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  if ((focus !== "sales" && focus !== "customers") || !date(from) || !date(to) || from > to) {
    return NextResponse.json({ error: "Select a valid reporting period" }, { status: 400 });
  }

  const workspace = await requireWorkspace();
  if (!workspace.ok) return workspace.response;
  const { supabase, store, membership } = workspace;
  if (!store?.shopify_domain) {
    return NextResponse.json({ error: "Connect Shopify to load this report" }, { status: 409 });
  }
  const { data: token, error: secretError } = await supabase.rpc("read_connection_secret_for_server", {
    requested_store_id: store.id,
    connection_provider: "shopify",
  });
  if (secretError || typeof token !== "string" || !token) {
    return NextResponse.json({ error: "Reconnect Shopify to load this report" }, { status: 409 });
  }

  const range = `SINCE ${from} UNTIL ${to}`;
  try {
    if (focus === "sales") {
      const rows = await run(store.shopify_domain, token, `FROM sales SHOW total_sales, orders GROUP BY new_or_returning_customer TIMESERIES month ${range} ORDER BY month ASC LIMIT 1000`);
      const months = new Map<string, { month: string; newOrders: number; newSales: number; repeatOrders: number; repeatSales: number }>();
      for (const row of rows) {
        const month = String(row.month ?? "").slice(0, 7);
        if (!/^\d{4}-\d{2}$/.test(month)) continue;
        const entry = months.get(month) ?? { month, newOrders: 0, newSales: 0, repeatOrders: 0, repeatSales: 0 };
        const group = String(row.new_or_returning_customer ?? "").toLowerCase();
        if (group === "new") {
          entry.newOrders += number(row.orders);
          entry.newSales += number(row.total_sales);
        } else if (group === "returning" || group === "repeat") {
          entry.repeatOrders += number(row.orders);
          entry.repeatSales += number(row.total_sales);
        }
        months.set(month, entry);
      }
      return NextResponse.json({ currency: store.reporting_currency || store.currency, from, to, months: [...months.values()].sort((a, b) => b.month.localeCompare(a.month)) });
    }

    const [customerRows, locationRows] = await Promise.all([
      run(store.shopify_domain, token, `FROM sales SHOW total_sales, orders GROUP BY customer_id, customer_name, shipping_country ${range} ORDER BY total_sales DESC LIMIT 1000`),
      run(store.shopify_domain, token, `FROM sales SHOW total_sales, orders, customers GROUP BY shipping_country ${range} ORDER BY total_sales DESC LIMIT 100`),
    ]);
    const customers = new Map<string, { id: string; name: string; country: string; orders: number; sales: number }>();
    for (const row of customerRows) {
      const id = String(row.customer_id ?? "").trim();
      if (!id) continue;
      const current = customers.get(id) ?? { id, name: String(row.customer_name ?? "Shopify customer"), country: String(row.shipping_country ?? ""), orders: 0, sales: 0 };
      current.orders += number(row.orders);
      current.sales += number(row.total_sales);
      customers.set(id, current);
    }
    const canSeeNames = membership.role === "owner" || membership.role === "admin" || membership.role === "analyst";
    return NextResponse.json({
      currency: store.reporting_currency || store.currency,
      from,
      to,
      customers: [...customers.values()].sort((a, b) => b.sales - a.sales).slice(0, 50).map((item, index) => ({
        ...item,
        name: canSeeNames ? item.name : `Customer ${index + 1}`,
      })),
      namesMasked: !canSeeNames,
      locations: locationRows.map((row) => ({
        country: String(row.shipping_country ?? "Unknown"),
        orders: number(row.orders),
        customers: number(row.customers),
        sales: number(row.total_sales),
      })),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Shopify report could not be loaded" }, { status: 502 });
  }
}
