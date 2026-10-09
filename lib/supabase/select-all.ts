type SupabasePage<T> = { data: T[] | null; error: { message: string } | null };

/**
 * Fetches every row matching a query instead of trusting a single response.
 * Supabase's Data API caps a response at its project "Max rows" setting
 * (1,000 by default) and returns that many rows with no error when a query
 * matches more — silently truncating financial reads unless every call site
 * pages past it. Pass a function that applies `.range(from, to)` to your
 * query and returns the result; this pages until a short page confirms
 * there is nothing left.
 */
export async function selectAllPages<T>(
  loadPage: (range: { from: number; to: number }) => PromiseLike<SupabasePage<T>>,
  pageSize = 1000,
): Promise<{ rows: T[]; error: string | null }> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await loadPage({ from, to: from + pageSize - 1 });
    if (error) return { rows, error: error.message };
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return { rows, error: null };
  }
}
