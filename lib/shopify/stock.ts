import { shopifyGraph } from "./graphql";
import type { StockItem } from "@/lib/stock/planning";

type Page<T> = { nodes: T[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
type Level = { location: { id: string; name: string; isActive: boolean }; quantities: { name: string; quantity: number }[] };
type Variant = { id: string; title: string; media: { nodes: { preview: { image: { url: string } | null } | null }[] }; product: { title: string; vendor: string; status: string; tags: string[]; featuredMedia: { preview: { image: { url: string } | null } | null } | null } };
type Item = { id: string; sku: string | null; tracked: boolean; unitCost: { amount: string; currencyCode: string } | null; variants: Page<Variant> | null; inventoryLevels: Page<Level> };
export const stockQuery = `query Stock($cursor: String) {
  inventoryItems(first: 10, after: $cursor) {
    nodes { id sku tracked unitCost { amount currencyCode }
      variants(first: 1) { nodes { id title media(first: 1) { nodes { preview { image { url } } } } product { title vendor status tags featuredMedia { preview { image { url } } } } } pageInfo { hasNextPage endCursor } }
      inventoryLevels(first: 20) { nodes { location { id name isActive } quantities(names: ["available", "on_hand", "committed", "incoming"]) { name quantity } } pageInfo { hasNextPage endCursor } }
    } pageInfo { hasNextPage endCursor }
  }
}`;
export const stockLevelsQuery = `query StockLevels($id: ID!, $cursor: String) {
  inventoryItem(id: $id) { inventoryLevels(first: 100, after: $cursor) {
    nodes { location { id name isActive } quantities(names: ["available", "on_hand", "committed", "incoming"]) { name quantity } }
    pageInfo { hasNextPage endCursor }
  } }
}`;
export const stockVariantsQuery = `query StockVariants($id: ID!, $cursor: String) {
  inventoryItem(id: $id) { variants(first: 50, after: $cursor) {
    nodes { id title media(first: 1) { nodes { preview { image { url } } } } product { title vendor status tags featuredMedia { preview { image { url } } } } }
    pageInfo { hasNextPage endCursor }
  } }
}`;
export async function loadStockPage(shop: string, token: string, cursor: string | null) {
  const result = await shopifyGraph<{ inventoryItems: Page<Item> }>(shop, token, stockQuery, { cursor });
  const items: StockItem[] = [];
  for (const item of result.inventoryItems.nodes) {
    if (!item.variants?.nodes.length) continue;
    const variants = [...item.variants.nodes];
    let variantPage = item.variants.pageInfo;
    while (variantPage.hasNextPage) {
      if (!variantPage.endCursor) throw new Error("Incomplete variant page. Refresh stock to retry.");
      const more = await shopifyGraph<{ inventoryItem: { variants: Page<Variant> | null } | null }>(shop, token, stockVariantsQuery, { id: item.id, cursor: variantPage.endCursor });
      if (!more.inventoryItem?.variants) throw new Error("Inventory changed while loading. Refresh stock to retry.");
      variants.push(...more.inventoryItem.variants.nodes);
      variantPage = more.inventoryItem.variants.pageInfo;
    }
    const variant = variants.find((v) => v.product.status === "ACTIVE") ?? variants[0];
    const levels = [...item.inventoryLevels.nodes];
    let page = item.inventoryLevels.pageInfo;
    while (page.hasNextPage) {
      if (!page.endCursor) throw new Error("Shopify returned an incomplete warehouse page. Refresh stock to retry.");
      const more = await shopifyGraph<{ inventoryItem: { inventoryLevels: Page<Level> } | null }>(shop, token, stockLevelsQuery, { id: item.id, cursor: page.endCursor });
      if (!more.inventoryItem) throw new Error("An inventory item changed while loading. Refresh stock to retry.");
      levels.push(...more.inventoryItem.inventoryLevels.nodes);
      page = more.inventoryItem.inventoryLevels.pageInfo;
    }
    const product = variant.product;
    items.push({ id: item.id, variantId: variant.id, variantIds: variants.map((v) => v.id), sku: item.sku ?? "", title: product.title, variant: variants.length > 1 ? `${variant.title} · shared inventory (${variants.length} variants)` : variant.title,
      vendor: product.vendor, status: product.status, tags: [...new Set(variants.flatMap((v) => v.product.tags))], tracked: item.tracked,
      image: variant.media.nodes[0]?.preview?.image?.url ?? product.featuredMedia?.preview?.image?.url ?? null,
      unitCost: item.unitCost ? Number(item.unitCost.amount) : null, currency: item.unitCost?.currencyCode ?? null,
      levels: levels.map((level) => { const q = Object.fromEntries(level.quantities.map((value) => [value.name, value.quantity])); return { id: level.location.id, name: level.location.name, active: level.location.isActive, available: q.available ?? 0, onHand: q.on_hand ?? 0, committed: q.committed ?? 0, incoming: q.incoming ?? 0 }; }),
    });
  }
  return { items, nextCursor: result.inventoryItems.pageInfo.hasNextPage ? result.inventoryItems.pageInfo.endCursor : null };
}
