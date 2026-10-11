/**
 * Bundle budget check. Next 16 does not print route sizes, but `next build`
 * writes .next/diagnostics/route-bundle-stats.json with each route's
 * uncompressed first-load JavaScript. This compares those figures with
 * scripts/bundle-budgets.json and reports routes over budget.
 */

const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;

/** Budget for a route: its own entry, else the default. */
export function budgetFor(route, budgets) {
  return budgets.routes?.[route] ?? budgets.default;
}

export function evaluateBudgets(stats, budgets) {
  const rows = stats.map((entry) => {
    const budget = budgetFor(entry.route, budgets);
    return { route: entry.route, bytes: entry.firstLoadUncompressedJsBytes, budget, over: entry.firstLoadUncompressedJsBytes > budget };
  }).sort((left, right) => right.bytes - left.bytes);
  return { rows, failures: rows.filter((row) => row.over) };
}

export function formatReport({ rows, failures }) {
  const lines = ["Route first-load JavaScript (uncompressed)", ""];
  for (const row of rows) lines.push(`${row.over ? "FAIL" : "ok  "}  ${row.route.padEnd(28)} ${kb(row.bytes).padStart(8)} / ${kb(row.budget)} budget`);
  lines.push("");
  lines.push(failures.length
    ? `${failures.length} route${failures.length === 1 ? "" : "s"} over budget. Trim the bundle, or raise the budget in scripts/bundle-budgets.json if the growth is intended.`
    : "All routes are within budget.");
  return lines.join("\n");
}
