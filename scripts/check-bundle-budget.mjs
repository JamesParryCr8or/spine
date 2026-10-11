import { readFileSync } from "node:fs";

import { evaluateBudgets, formatReport } from "./bundle-budget.mjs";

const statsPath = ".next/diagnostics/route-bundle-stats.json";
let stats;
try {
  stats = JSON.parse(readFileSync(statsPath, "utf8"));
} catch {
  console.error(`Could not read ${statsPath}. Run "npm run build" first (Next writes this file during the build).`);
  process.exit(1);
}
const budgets = JSON.parse(readFileSync(new URL("./bundle-budgets.json", import.meta.url), "utf8"));

const result = evaluateBudgets(stats, budgets);
console.log(formatReport(result));
process.exit(result.failures.length ? 1 : 0);
