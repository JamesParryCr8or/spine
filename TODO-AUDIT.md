# Spine: audit findings and improvement to-do

Prioritised from a code audit on 9 Oct 2026 (branch `codex/payment-fees-live` @ `0f2834a`, plus your uncommitted P&L period-paging changes). Each task names its files, so you can paste it straight into a fresh Claude Code session as the prompt. [TODO.md](TODO.md) stays the long-form roadmap; this file is the execution list.

## Picking the model

| Tag | Model | Price per 1M tokens (in / out) | Use it for | Suggested effort |
|---|---|---|---|---|
| `[Haiku]` | Claude Haiku 5.5 | $0.10 / $0.50 for prompts up to 100K tokens ($0.50 / $2.50 above) | Fully specified, mechanical work: CSS fixes, deletions, config, repeating a pattern another task already set | low |
| `[Sonnet]` | Claude Sonnet 5.5 | $2 / $10 | The default: screens, contained refactors, API integrations, tests | medium |
| `[Opus]` | Claude Opus 5.5 | $4 / $20 | Architecture, and anything where a subtle bug silently corrupts numbers or leaks one tenant's data to another | high |
| `[Fable]` | Claude Fable 5.1 | $10 / $50 | Only task 4.1: moving the P&L engine into Postgres with exact parity | high |

Prices as of Oct 2026. Main list: 9 Haiku, 31 Sonnet, 7 Opus, 1 Fable.

### Token rules

1. **One task per session.** Start fresh (`/clear`) and paste the task as the prompt. It already says where to look, so the model doesn't spend tokens exploring.
2. **Until task 2.1 is done, never let a model read `components/analytics-app.tsx` in full.** It is 370 KB, roughly 100K tokens per read. Tasks give symbol names and approximate line numbers to grep for instead. The same applies to `app/globals.css` (80 KB of one-line rules) and the old `TODO.md` (51 KB).
3. **Plan with the expensive model, build with the cheaper one.** Run `[Opus]` and `[Fable]` tasks in plan mode, approve the plan, then hand the implementation slices to Sonnet.
4. **Keep Haiku sessions small.** Its price rises 5x once a prompt passes 100K tokens. Batch two or three related Haiku chores per session, then clear.
5. **Move code with a script, not by retyping it.** For big moves (2.1), ask the model to write a script that cuts the file by line ranges, then fix imports from the `tsc` errors. That avoids paying for ~100K output tokens of copied code.
6. **Definition of done for every task:** `npm run typecheck && npm run lint && npm test` pass, plus `npm run build` for routing or config changes.

## What the audit found

Already solid: 98/98 tests pass, and CI runs typecheck, lint, test and build. Every public table has RLS (`supabase/tests/rls_coverage.sql`) and connector secrets are kept in Vault. Costs are effective-dated, FX is handled, and there is a golden-store P&L fixture. The problems are speed, trust in what's on screen, and a codebase shape that makes every change expensive.

| # | Finding | Evidence | Task |
|---|---|---|---|
| 1 | Hard-coded demo figures appear whenever live data is loading or missing | `demoMetrics` (L146), `utms` (L153), `demoRows` (L818) in `components/analytics-app.tsx`, used as fallbacks at L456 (Overview), L849 (P&L), L1180 (UTM) | 0.1 |
| 2 | Page loads wait on 4–5 third-party APIs | `GET /api/analytics/pnl` and `/overview` call `refreshReportingData` (several ShopifyQL queries plus Meta, Google Ads and Microsoft Ads) before responding. Microsoft polls for up to ~40 s. Overview starts four of these at once | 1.1, 1.2 |
| 3 | Too many heavy requests per screen | One P&L view makes ~16 requests (full period, 2 comparisons, 12 columns, customer KPIs). The Overview trend makes up to 60, or one per day on daily granularity. Each recomputes the whole P&L in Node, and the client cache is bypassed with `force: true` | 1.3, 3.1, Phase 4 |
| 4 | The whole app is one 370 KB client component on one route (`/protected`) | 2,618 lines (some ~10,000 characters long), ~240 `useState`, 85 `fetch` calls. No code splitting, no URL per screen, and ~100K tokens for any AI edit | 2.1, 2.2 |
| 5 | Some financial reads may be silently capped at 1,000 rows | `.in("order_id", <500 ids>)` for lines, refunds and transactions, plus unpaged per-store reads of variants and costs (`app/api/analytics/pnl/route.ts:128-136`; same pattern in products, utm, customers, orders). Supabase returns at most "Max rows" (default 1,000) and raises no error | 0.5 |
| 6 | Each request does more database work than it needs to | No index matches the main orders query (store + `processed_at`, excluding test and cancelled orders), paging uses OFFSET, and RLS checks every order/line/transaction row through per-row security-definer calls under two overlapping policies | 1.4, 1.5 |
| 7 | Shopify orders only sync when someone clicks sync | The only cron job is the weekly report, so order-level COGS, fees, UTMs and customers drift away from the ShopifyQL daily totals | 1.1 |
| 8 | GoHighLevel reports call the GHL API on every view and keep no history | `app/api/analytics/leads/pipeline/route.ts` (pipelines plus paginated opportunity search); the 7 lead report pages use the same route | 7.1 |
| 9 | The CSS works against consistent UI | 80 KB, 447 distinct hex colours, 6 CSS variables, 119 font sizes at 8–10px vs 68 at 12px+. `.primary` only sets colours and each container redefines the button's shape, so a primary button anywhere new renders like highlighted text (your "Save estimate settings") | 0.2, 5.1, 5.2 |
| 10 | The top-bar date picker does nothing on ecommerce screens | It holds lead-gen state (`leadFrom`/`leadTo`) that only lead-gen views receive. Overview and P&L each keep their own period under separate localStorage keys | 0.3, 2.2 |
| 11 | The weekly report mixes tenants and mislabels profit | `app/api/cron/weekly-overview-report/route.ts` posts every store in every organisation to one webhook. Its "Net profit" is gross profit − ad spend (L124), and spend in other currencies is dropped | 8.2 |

---

## Phase 0: Trust and quick wins

> Commit your in-progress P&L paging work first (`analytics-app.tsx`, `globals.css`, `reporting-periods.ts`, `pnl-period-navigation.css`, `tests/shopify-graphql.test.mjs`). That keeps these edits in separate commits, and the split in Phase 2 would conflict with it otherwise.

- [x] **0.1 [Sonnet] Replace fake numbers with loading, error and empty states.**
  In `components/analytics-app.tsx`, delete `months`, `revenue`, `profit` and `spend` (L141–144; check they're unused), `demoMetrics` (L146) and `utms` (L153). Remove the fallbacks at L456 (Overview), L818/L849 (`demoRows`, P&L) and L1180 (UTM).
  - Add `components/ui/skeleton.tsx` with a shimmer that respects `prefers-reduced-motion`.
  - Each panel goes from skeleton to data. On failure it shows an error with Retry; with no data, an empty state with the next action (Connect Shopify or Run sync).
  - In `Expenses()` (L1535), don't show the `2` / `0.23` defaults until the saved settings have loaded.
  - Use grep and line ranges; don't read the whole file.

  *Done when:* `grep -rE "demoMetrics|demoRows|utms" components` finds nothing, and with the APIs returning 500 no £ figure appears anywhere.

  *Done (9 Oct 2026):* removed all five fabricated fallbacks (`demoMetrics`, `demoRows`, `utms`, plus two more found during the fix — `summary`'s and `coreMetrics`'s fallback arrays in `ProfitLoss()` and `UTMAnalysis()`) and the now-dead `months`/`revenue`/`profit`/`spend` arrays. Added `components/ui/skeleton.tsx` (`Skeleton`, `StatCardSkeleton`, `TableRowSkeleton`) with a shimmer that falls back to a static fill under `prefers-reduced-motion`. Overview, ProfitLoss and UTMAnalysis each got a `loadError`/`retryToken` pair: a failed or non-OK fetch sets `loadError`, rendered as a `.panel-error` block with a Retry button that re-runs the fetch; while loading, KPI grids and the P&L table render skeletons instead of blank or fabricated content. `Expenses()` now gates the payment-estimate form and the operating-costs table behind `initialLoading` so the `2%` / `£0.23` defaults never render before the real settings response (or confirmed absence of one) arrives.
  - Found in the process, not previously tracked: `npm run lint` already fails on `main`/this branch independent of this session (9 pre-existing `react-hooks/set-state-in-effect` errors from a recent `eslint-config-next@16.3.5` rule addition — confirmed via `git stash` back to the session's starting commit). This session's new effects add 3 more instances of the same pattern. Tracked as new task **0.1b** below rather than fixed inline, since untangling each effect is its own piece of work.

- [ ] **0.1b [Sonnet] Fix the `react-hooks/set-state-in-effect` lint errors.**
  `npm run lint` currently reports 12 errors from this rule (`components/analytics-app.tsx:343,465,698,721,785,1103,1718,2556,2570`, plus `components/shopify-customer-report.tsx:47`), all pre-existing or added alongside 0.1's loading-state effects. CI's lint step (`.github/workflows/ci.yml`) will fail until these are resolved. Move each flagged `setState` call out of the effect body: compute the initial value in `useState`'s initializer where possible, or move the call into the event handler that triggers the effect's dependency change instead of the effect itself.

- [ ] **0.2 [Sonnet] Fix the Expenses screen.**
  This covers `Expenses()` in `components/analytics-app.tsx` (~L1530–1633) and these selectors in `app/globals.css`:
  - `.report-panel{padding:0}` leaves `.cost-form-grid` and `.feature-actions` flush against the panel edge. Add a padded panel body.
  - "Save estimate settings" gets no button shape. Give it the standard primary style and right-align it. Disable it until something changes, and confirm with a "Saved" toast.
  - `.panel-head p` is unstyled, so it inherits 16px and outweighs the heading. Use ~13px muted text with a ~70ch max width.
  - Labels are 10px, inputs 11px, and `.report-note` is 9px right-aligned in a 250px box. Make labels 12–13px and inputs 14px.
  - Show detected gateways as chips, each with a "Set rate" button that opens the processor-rate modal pre-filled.
  - The plan copy contradicts itself ("detected: Grow" vs "Automatic (Basic until detected)"). Once a plan is detected, label the option "Automatic (<plan>, detected)".
  - Add a live example under the form: "A £50.00 payment through <gateway> ≈ £x.xx in fees", computed from the rate, fixed fee and plan surcharge.

- [x] **0.3 [Haiku] Hide the top-bar date picker where it does nothing.**
  In `AnalyticsApp()` (`components/analytics-app.tsx` ~L2610, search for `global-date-picker`), render it only when `businessModel === "lead_generation"`. Task 2.2 replaces it with one global period control.

- [x] **0.4 [Haiku] Tidy the sidebar sub-items.**
  Long labels ("Repurchase rates", "Time between orders", "New versus repeat sales") wrap onto two centred lines. `<button>` centres text by default, and `.nav-item` has a fixed `height:42px`.
  - In `app/globals.css`, make `.nav-item` and `.nav-sub-item` left-aligned and single-line with ellipsis, using `min-height` and a fixed icon column.
  - Shorten the labels ("Repurchase", "Order gaps", "New vs repeat", "Top customers", "Countries") and keep the full name in `title`.

- [x] **0.5 [Sonnet] Check whether the 1,000-row cap is truncating financial data, and fix it if so.**
  - Check the API "Max rows" setting in the Supabase dashboard.
  - For the busiest month, write a script that compares rows returned against `count: "exact"` for:
    - the chunked `.in("order_id", ids)` reads (`app/api/analytics/pnl/route.ts:128-130`, `products/route.ts:76-78`, `utm/route.ts:75-76`, `orders/route.ts:80-83`, `customers/route.ts:169`);
    - the unpaged per-store `shopify_variants` and `product_costs` reads (`pnl/route.ts:131-132`).
  - If anything is capped, add a `selectAll()` helper that pages with `.range()` and use it in those places. This is a stop-gap until 4.1.

  *Done (9 Oct 2026):* no Supabase service-role credentials were available in this environment to check the live "Max rows" setting or compare against `count: "exact"`, so this was fixed defensively instead: added `lib/supabase/select-all.ts` (`selectAllPages`) and applied it to every unpaged per-store read and every order-id-chunked read across `pnl`, `products`, `utm`, `orders` and `customers` routes, each with a deterministic `.order("id")` so repeated `.range()` calls can't skip or duplicate rows. Confirm the dashboard setting when you have access, but the fix holds regardless of its value.

- [x] **0.6 [Haiku] Remove demo mode.**
  `/api/demo` sets a `cr8or-demo` cookie that skips the login redirect (`app/api/demo/route.ts`, `lib/supabase/proxy.ts:50`, `app/protected/layout.tsx:9`). The data APIs still require a real session, so demo visitors only ever saw the fake numbers removed in 0.1. Delete the route and both checks. If you want a real demo later, seed a read-only demo workspace instead.

- [x] **0.7 [Haiku] Repo hygiene.**
  - Add `.codex-email-build/`, `.email-verify-2/` and `.npm-cache/` to `.gitignore`.
  - Delete the unused starter files after confirming nothing imports them: `components/tutorial/`, `hero.tsx`, `deploy-button.tsx`, `next-logo.tsx`, `supabase-logo.tsx`, `env-var-warning.tsx`, `theme-switcher.tsx`, `auth-button.tsx`.
  - The app CSS is light-only, so set `forcedTheme="light"` on `ThemeProvider` in `app/layout.tsx` until 5.1 adds dark tokens.
  - Refresh `README.md`, which still says "Cr8or Data" and describes an old next step.

## Phase 1: Take third-party APIs out of page loads

- [ ] **1.1 [Opus] Design and scaffold the background sync engine.**
  - Add a `CRON_SECRET`-protected `app/api/cron/sync/route.ts`, scheduled in `vercel.json`.
  - It walks the stores and refreshes a rolling window (e.g. the last 3 days plus today) for:
    - ShopifyQL daily reports and payment gateways;
    - Meta, Google Ads and Microsoft Ads;
    - the incremental Shopify orders sync (currently manual-only, in `app/api/connections/shopify/route.ts`);
    - the existing GoHighLevel daily sync.
  - Take a per-store, per-source lock (an advisory lock or a lock row) so overlapping runs, and the Microsoft token rotation, can't race.
  - Record each run in `sync_runs`.
  - Replace `needsRefresh` (`lib/analytics/reporting-refresh.ts:36`) with per-source date coverage. Today one fresh row marks the whole range as fresh.
  - Check your Vercel plan's cron frequency limit. Supabase Cron calling the same route is the alternative.

- [ ] **1.2 [Sonnet] Make the analytics GET routes read-only and add "Sync now".**
  After 1.1:
  - Remove the refresh calls from `app/api/analytics/pnl/route.ts` (L60–69, ~L88–90, ~L298–300) and `overview/route.ts` (L57–66).
  - Add `POST /api/sync`, which starts the job with `after()` from `next/server` and returns 202.
  - The shell's freshness block shows per-source status (Shopify, Meta, Google, Microsoft, GHL) and a Sync now button that polls until the job finishes.

  *Done when:* a test with stubbed `fetch` proves those GET routes make no outbound HTTP calls.

- [ ] **1.3 [Opus] One request per P&L screen: a series endpoint.**
  Today a P&L view makes one full-period request, then 2 comparisons, then 12 column requests, then customer KPIs (`analytics-app.tsx` ~L726–800). The Overview trend makes up to 60 calls in batches of 12 (~L397–420).
  - Split `pnl/route.ts` into `loadPnlInputs(store, range)` and `computePnl(inputs, period)`.
  - Add `GET /api/analytics/pnl/series?from&to&granularity&compare=previous_period,previous_year`, which loads the inputs once and returns `{ total, periods[], comparisons }`.
  - Switch both screens to it.

  *Done when:* the golden fixture still passes, and series totals match the old per-period calls on the live store.

- [ ] **1.4 [Sonnet] Index and keyset-paginate the orders query.**
  Every analytics route runs `shopify_orders where store_id=? and cancelled_at is null and test=false and processed_at in [a,b) order by processed_at` with OFFSET paging. The existing indexes, `(organization_id, store_id, created_at_shopify)` and `(store_id, country_code, processed_at)`, don't serve it.
  - Add a migration with a partial index on `(store_id, processed_at)` for valid orders.
  - Switch the loops to keyset paging on `(processed_at, id)`.
  - Record `EXPLAIN (ANALYZE, BUFFERS)` before and after, then rerun the Supabase performance advisor.

- [ ] **1.5 [Opus] Rewrite RLS as set-based store checks.**
  `supabase/migrations/20261002120333_store_scoped_team_memberships.sql` (~L108–157) adds `store_scope_read` policies alongside the older workspace policies. Both are per-row security-definer calls, which Postgres can't hoist out of the scan.
  - Add `private.readable_store_ids(roles text[]) returns setof uuid`.
  - Rewrite each policy as `store_id in (select private.readable_store_ids(...))` so it runs once per statement, and keep one permissive SELECT policy per table.
  - Keep `supabase/tests/tenant_isolation.sql` and `rls_coverage.sql` green, and add store-scoped-member cases.

- [ ] **1.6 [Sonnet] Make the per-request workspace lookup cheaper.**
  `requireWorkspace()` in `lib/workspace/server.ts` makes 2–3 sequential round trips on every API call.
  - Replace them with a single `get_workspace_context()` RPC that returns memberships and stores, and keep the `lib/workspace/selection.ts` tests passing.
  - Enable asymmetric JWT signing keys in Supabase if they're off, so `getClaims()` verifies locally instead of calling the Auth server.

## Phase 2: Split the 370 KB component (faster loads, cheaper AI edits)

- [ ] **2.1 [Sonnet] Mechanical split, no behaviour change.**
  - Move each screen function into `components/screens/<name>.tsx`: `Overview`, `ProfitLoss`, `UTMAnalysis`, `Costs`, `Expenses`, `Leads`, `Connections`, `Sales`, `Products`, `Customers`, `Reports`, `SettingsView`.
  - Move shared types into `lib/types/analytics.ts`.
  - Move shared helpers into `components/analytics/`: `financeDateRange`, `FinanceDateControls`, `FinanceTrendChart`, `Trend`, `downloadCsv`, `useReportRun`.
  - Do it with a line-range script plus `tsc`-driven import fixes (token rule 5).

  *Done when:* typecheck, lint, test and build all pass, the UI is unchanged, and `analytics-app.tsx` contains only the shell.

- [ ] **2.2 [Opus] One route per screen, with the period in the URL.**
  - Add `app/(app)/overview/page.tsx`, `/pnl`, `/sales` and so on, with a shared layout for the sidebar and top bar. Each screen then gets its own JS chunk.
  - URL search params (`from`, `to`, `granularity`, `compare`) become the single source of truth for the period, set by one control in the top bar.
  - That replaces the dead picker and three localStorage keys: `spine:overview-filters:*`, `spine:pnl-period:*` and `spine:lead-period:*`.
  - Sidebar items become `<Link>`s.
  - `cacheComponents` is on, so read `node_modules/next/dist/docs/01-app/02-guides/authentication-with-cache-components.md` first.

  *Done when:* a refresh or a shared link reopens the same screen and period, and `next build` shows a separate chunk per route.

- [ ] **2.3 [Haiku] Add Prettier.**
  Add Prettier, with format-on-commit if you want it. Format only the files created in 2.1 and 2.2, so in-flight branches aren't hit by a whole-repo reformat.

## Phase 3: Cache responses and show skeletons instead of fake data

- [ ] **3.1 [Sonnet] TanStack Query with a persisted cache.**
  Replace `lib/analytics/client-response-cache.ts` and the raw `fetch` calls with query hooks in `lib/queries/`. The current cache is in-memory with a 2-minute TTL, vanishes on reload and is bypassed by `force: true`.
  - Key each query `[userId, storeId, endpoint, params]`.
  - Use `staleTime` ~5 min, `gcTime` 24 h and `placeholderData: keepPreviousData`, so changing the period dims the old numbers instead of blanking them.
  - Persist to IndexedDB so a reload paints the last real numbers immediately, with an "Updating…" chip while fresh data loads.
  - Mutations under `/api/costs/*` and `/api/settings/*` invalidate the affected keys.
  - Clear the cache on sign-out and on store switch.

  *Done when:* a second visit to Overview or P&L renders from cache in under 100 ms, then refreshes.

- [ ] **3.2 [Sonnet] Shared loading, error and empty components.**
  Build `<Skeleton>`, `<PanelState status="loading | error | empty">`, and KPI-card and table-row skeletons. Apply them to Overview, P&L and Expenses as the reference pattern, replacing the 18 plain "Loading…" strings.

- [ ] **3.3 [Haiku] Roll the 3.2 pattern out to the remaining screens.**
  Do two or three screens per session, copying the 3.2 examples exactly: Sales, Products, Customers (with its sub-reports), UTM, Costs, Connections, Reports, Settings, Team and the lead-gen pages.

- [ ] **3.4 [Haiku] Prefetch on hover and when idle.**
  Hovering a sidebar link calls `queryClient.prefetchQuery` for that screen's default query. Once Overview settles, prefetch P&L while the browser is idle.

- [ ] **3.5 [Opus] (Optional, after Phase 4) Server cache.**
  Only if aggregate reads still take over 300 ms:
  - Wrap them in `'use cache: remote'` with ``cacheTag(`store:${storeId}:reporting`)``, and call `revalidateTag(tag, "max")` from the sync job and cost mutations.
  - Resolve the workspace outside the cached function and pass `storeId` in. Keep the cached function unexported, and never cache anything that isn't keyed by store.
  - Reference: `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-cache-remote.md`.

## Phase 4: Reporting fact layer in Postgres (the real speed fix)

- [ ] **4.1 [Fable] Build `daily_store_financials` and port the P&L to SQL with exact parity.**
  One row per store per day, holding every P&L input the Node route computes today:
  - gross sales, discounts, refunds, shipping revenue and tax;
  - COGS (effective-dated, with fallbacks);
  - payment fees (actual plus estimated, by gateway);
  - merchant shipping and handling;
  - marketing spend by channel (FX converted by day);
  - operating costs pro-rated by cadence and allocation basis;
  - orders, units and new/repeat customers;
  - coverage counters: missing-cost lines, fallback lines, excluded currencies.

  Store money as `numeric` and add a `calculation_version` column.
  - `refresh_daily_store_financials(store_id, from, to)` fills the table. The sync job calls it for the dates it touched, and cost or settings changes call it for their effective range.
  - Prove parity against `tests/fixtures/golden-store-pnl.json` and against every month of the live store. Keep it behind a flag until the diff is zero.

  Cheaper alternative: Opus at high effort in plan mode, then Sonnet in slices.

- [ ] **4.2 [Sonnet] Point the P&L, series, Overview and weekly report at the fact table.**
  Any period becomes `sum(...) group by date_trunc(granularity)`. Delete the per-request order, line and transaction loops in those routes.

  *Done when:* "All imported data" returns in under 300 ms of server time.

- [ ] **4.3 [Sonnet] Variant and campaign facts.**
  Following the 4.1 pattern:
  - Add `daily_variant_financials`.
  - Add `daily_campaign_spend`, covering Meta, Google and Microsoft at campaign level.
  - Move Products and UTM off the chunked `.in()` scans.

- [ ] **4.4 [Sonnet] Customer facts.**
  Add `customer_first_orders` (first order date, channel/UTM, first product, discount code, country) and `customer_monthly_value`. These feed Customers, the cohorts and 6.1.

## Phase 5: UI and design system

- [ ] **5.1 [Sonnet] Design tokens and type scale.**
  - Define CSS variables for surface, ink, muted, line, accent, positive, negative and warning, plus radius, spacing and shadow, and map them in `tailwind.config.ts`.
  - Replace hard-coded hex values screen by screen as each one is migrated.
  - Text sizes: 14px body, 12–13px secondary, 12px labels, never below 11px.
  - Keep text contrast at 4.5:1 or higher. For example, `#9aa1ae` on white is about 2.6:1.

- [ ] **5.2 [Sonnet] Shared primitives on the existing shadcn/ui and Tailwind.**
  Build these, then rebuild Expenses with them as the reference screen:
  - `Button`: one base style, which fixes the context-scoped `.primary` problem;
  - `Panel`: eyebrow, title, description, actions and a padded body;
  - `FormField`;
  - `StatCard`: value, delta, sparkline, info tooltip and skeleton;
  - `DataTable`: sticky header, right-aligned `tabular-nums`, sorting and CSV export;
  - `EmptyState` and `Toast`.

- [ ] **5.3 [Haiku] Migrate the settings-type screens to the primitives.**
  Costs, Connections, Settings, Team and Reports, one or two per session. Follow the 5.2 Expenses pattern and delete each screen's old CSS from `globals.css`.

- [ ] **5.4 [Sonnet] Redesign Overview.**
  - A hero row of 4 KPIs (net sales, contribution margin, net profit, MER), each with a sparkline and delta.
  - A profit-bridge waterfall: net sales → COGS → fees → shipping → ads → opex → net profit.
  - The existing customisable widgets underneath, plus a freshness chip for each source.
  - Replace the hand-rolled SVG/CSS charts with one chart library (e.g. Recharts), loaded with `next/dynamic`.

- [ ] **5.5 [Sonnet] P&L table usability.**
  - Sticky first column and header.
  - A "% of net sales" toggle and comparison columns.
  - Click a cell to see the orders or costs behind it.
  - Period paging, building on your in-progress `pagedReportingPeriods`.

- [ ] **5.6 [Sonnet] Accessibility pass.**
  - Visible focus states.
  - Keyboard navigation for the sidebar, menus and modals, with focus trapping and Esc to close.
  - Labels on icon-only buttons.
  - A table alternative for every chart.
  - Respect `prefers-reduced-motion`.

## Phase 6: Ecommerce insights (Triple Whale / Lifetimely parity, then beyond)

- [ ] **6.1 [Opus] LTV and payback.**
  - Cohorts by first-order month with cumulative *contribution profit*, not just revenue, from M0 out to M12/M24.
  - LTV:CAC and the CAC payback month, broken down by acquisition channel, first product, first discount code and country.
  - Needs 4.4.

- [ ] **6.2 [Sonnet] Break-even targets.**
  For the store and for each product, show beside actual MER/ROAS with a status colour:
  - break-even ROAS = 1 ÷ contribution margin % before ads;
  - the highest CAC that breaks even on the first order;
  - the highest CAC that breaks even on 90-day LTV.

- [ ] **6.3 [Sonnet] Ad-level import and creative report.**
  - Import Meta ad sets and ads: spend, impressions, clicks, purchases and thumbnails.
  - Import Google and Microsoft at campaign level (both are account-level today).
  - Build a creative table with spend, CTR, CPC, CPM and platform ROAS next to Shopify UTM-attributed revenue and contribution.

- [ ] **6.4 [Sonnet] Goals and pacing.**
  - Monthly targets per store for revenue, contribution margin, ad spend and MER.
  - Actual vs target pacing.
  - A projected month-end based on the current run rate.

- [ ] **6.5 [Sonnet] Alerts and a daily digest.**
  - A daily job compares contribution margin %, MER, CAC, refund rate, AOV and fee % with their trailing 28-day baseline.
  - It also flags failed syncs, expired tokens, new variants without COGS, and ad spend with no sales.
  - Deliver by email, Slack or GHL webhook, opt-in per store, through the per-store destinations from 8.2.

- [ ] **6.6 [Sonnet] Leakage reports.**
  The data for all four is already imported:
  - shipping P&L by country (shipping revenue minus merchant shipping and fulfilment);
  - fee % by gateway over time;
  - contribution margin by discount code;
  - refund rate by product.

- [ ] **6.7 [Sonnet] Klaviyo reporting.**
  Show campaign and flow revenue separately from Shopify revenue so nothing is counted twice. The connection already exists; the reporting is roadmap Phase 7.

## Phase 7: Lead-gen (GoHighLevel) view

- [ ] **7.1 [Opus] Store GoHighLevel data instead of fetching it live.**
  - Add `ghl_opportunities`, `ghl_opportunity_events` (stage and status changes) and `ghl_contacts` (with attribution fields).
  - Keep them current with the 1.1 sync plus GHL webhooks for opportunity and appointment changes.
  - Point `app/api/analytics/leads/pipeline/route.ts` and the 7 lead report pages at the database.

- [ ] **7.2 [Sonnet] Ad → lead → sale attribution.**
  - Map each GHL contact's UTM and click-ID attribution to Meta, Google and Microsoft campaigns, reusing the campaign-mapping UI.
  - Per campaign, show cost per lead, cost per booked call, cost per sale, and ROAS on collected revenue from the Stripe/Sheets/CSV ledger.

- [ ] **7.3 [Sonnet] Funnel timing from stage history.**
  Needs 7.1. Show speed-to-lead, show rate, close rate, sales-cycle length, true stage ageing, pipeline velocity, and forecast vs actual.

- [ ] **7.4 [Sonnet] Lead-gen P&L.**
  Monthly collected revenue − refunds − ad spend − delivery costs − opex gives contribution and net profit. Add CAC and payback, and reuse the P&L table component.

## Phase 8: Security and correctness

- [ ] **8.1 [Sonnet] One server-only service-role client.**
  There are three today: `lib/supabase/admin.ts`, `createReportingClient` in `lib/analytics/reporting-refresh.ts:16`, and an inline one in `app/api/analytics/leads/pipeline/route.ts`.
  - Keep one, with `import "server-only"`.
  - Audit every use; for example, `overview/route.ts:91` reads tenant data with the service role.
  - Move plain reads to the user's client so RLS applies.

- [ ] **8.2 [Sonnet] Fix the weekly report.**
  - Before any outside business is onboarded, give each store its own opt-in destination (a settings table plus UI). Today one global webhook receives every store in every organisation.
  - Relabel the L124 figure "Profit after ads", or compute true net profit from 4.1.
  - Convert spend in other currencies instead of dropping it.

- [ ] **8.3 [Sonnet] Tenant-isolation tests for store-scoped members.**
  Cover every `/api/analytics/*` and `/api/costs/*` route. A member of store A must never see store B, even within the same organisation.

- [ ] **8.4 [Sonnet] Rate-limit expensive endpoints.**
  For sync, imports and exports, allow one in-flight job per store and source (reusing the 1.1 lock). Reject extras with 429 and `Retry-After`.

## Phase 9: Release safety

- [ ] **9.1 [Sonnet] Playwright smoke tests on Vercel preview deployments.**
  Cover login, Overview showing real numbers within N seconds, P&L loading, an Expenses save round-trip, and accepting an invite. 39 of the 525 commits start with "Fix", including four "Fix team invite authentication" commits; these tests would catch that kind of thing before production.

- [ ] **9.2 [Haiku] Performance budget in CI.**
  Fail CI when a route's first-load JS exceeds its budget (parse the `next build` output), and log server timings for the analytics routes.

## Later: bigger bets

- [ ] **[Opus] "Ask Spine".** Claude answers questions over documented, read-only analytics views once Phase 4 exists. It shows the generated SQL before running it, and queries run under a read-only role with a statement timeout, a row limit and store scoping (spec already in TODO.md Phase 8). Use `claude-opus-5-5` at runtime first; try cheaper models only once an eval shows they hold quality.
- [ ] **[Fable] First-party attribution pixel.** Shopify Web Pixels plus server-side events, the feature Triple Whale is best known for.
- [ ] **[Opus] Inventory and forecasting.** Days of cover and stock-out risk from sales velocity, plus a revenue and profit forecast.

## For you (no model needed)

- [ ] Commit your in-progress P&L paging work before starting Phase 0.
- [ ] In the Supabase dashboard:
  - check the API "Max rows" setting (for 0.5);
  - turn on leaked-password protection;
  - enable asymmetric JWT signing keys if they're off.
- [ ] Check which cron frequencies your Vercel plan allows (for 1.1).
- [ ] Decide whether you'll onboard outside businesses soon. That sets how urgent 8.2 and 8.3 are.
- [ ] Decide on dark mode. The default is light-only (0.7) until 5.1.
