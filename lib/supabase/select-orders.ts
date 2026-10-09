type OrderPage<T> = { data: T[] | null; error: { message: string } | null };
type Cursor = { processedAt: string; id: string };

/**
 * Pages a `shopify_orders` query by keyset (seek) pagination on
 * (processed_at, id) instead of OFFSET. OFFSET paging makes Postgres
 * re-scan and discard every row before the current page on each request,
 * which gets slower the further into a large order history a loop reads;
 * keyset paging reads each page in roughly constant time by resuming from
 * the last row's own position.
 *
 * `loadPage(cursor, pageSize)` must apply every filter the caller needs
 * (store, date range, test/cancelled, …), the `cursor` seek condition when
 * given, an `.order("processed_at", …).order("id", …)` matching the same
 * direction as the cursor comparisons, and `.limit(pageSize)` - this
 * function only drives the loop and derives the next cursor. See the
 * call sites in app/api/analytics/*.ts for the seek condition's exact
 * `.or(...)` shape.
 */
export async function selectOrdersByProcessedAt<T extends { id: string; processed_at: string | null }>(
  loadPage: (cursor: Cursor | null, pageSize: number) => PromiseLike<OrderPage<T>>,
  pageSize = 1000,
): Promise<{ rows: T[]; error: string | null }> {
  const rows: T[] = [];
  let cursor: Cursor | null = null;
  for (;;) {
    const { data, error } = await loadPage(cursor, pageSize);
    if (error) return { rows, error: error.message };
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return { rows, error: null };
    const last = page[page.length - 1];
    // processed_at is always filtered not-null at every call site; this only
    // guards against an infinite loop if that ever stops being true.
    if (!last.processed_at) return { rows, error: null };
    cursor = { processedAt: last.processed_at, id: last.id };
  }
}
