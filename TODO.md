# Ecommerce Analytics Web App Roadmap

## Current implementation status

- [x] Replaced the generic starter UI with a responsive Shopify-first analytics shell.
- [x] Added protected Supabase-authenticated application routes.
- [x] Added Overview, Profit & Loss, UTM, Costs, Reports, and Connections screens.
- [x] Added the first Meta Ads connection flow with Graph API Explorer guidance and token validation.
- [x] Added a server-only Meta connection API; connector tokens are never returned to the browser.
- [x] Import daily Meta Ads account spend on connection and deduct matching-currency spend from the P&L for the selected period.
- [x] Added a reviewed Supabase setup script for organizations, memberships, stores, RLS, and Vault-backed connector secrets.
- [x] Added a Shopify development-token connection flow using Admin GraphQL API `2026-07`.
- [x] Added cursor-paginated product and variant import with tenant RLS and sync-run history.
- [x] Confirmed lint and the Next.js production build complete successfully.
- [x] Apply `supabase/setup.sql` to the development Supabase project and verify the RLS/Vault functions.
- [x] Replace dashboard mock figures with the first normalized Shopify data slice (live sales, discounts, shipping, order count, AOV, and monthly trend after Shopify sync).
- [x] Added live Shopify sales orders, product profitability, and last-touch UTM source/medium/campaign reporting.
- [x] Added reconciled Shopify P&L metrics, effective-dated COGS, fixed operating costs, and CSV export.
- [x] Added owner/admin-managed recurring operating expenses with tenant-protected storage.
- [x] Added a production GitHub Actions verification workflow for linting, type checking, Shopify retry tests, and the Next.js build.

### Product direction: store costs, brands, and lead generation

- [x] Add store-level cost defaults for fulfilment and postage, each configurable as a cost per order or cost per unit.
- [x] Apply those defaults to P&L reporting when a product-level shipping override is absent; extend the same allocation into product-level reporting next.
- [ ] Discover Shopify shipping methods from imported orders and optionally map a cost to each method, with the static postage default as fallback.
- [x] Identify synced Shopify variants that have no active override and no Shopify unit cost.
- [x] Export the missing-COGS list as a CSV or Excel template that can be edited and imported again.
- [x] Keep imported COGS as effective-dated store data until an owner or admin changes it.
- [x] Add brand creation and selection so each brand owns its Shopify, Meta, Google Ads, Klaviyo, and future GoHighLevel connections.\n- [ ] Add brand rename and archive controls.
- [ ] Add an ecommerce / lead-generation operating mode per brand.
- [x] Add Google Ads OAuth authorization, encrypted per-brand refresh-token storage, MCC/client account discovery, and account selection.\n- [ ] Import Google Ads campaign, keyword, and daily-spend reporting after account selection.\n- [ ] Add a GoHighLevel connection and sync contacts, opportunities, pipelines, and pipeline stages.
- [ ] Add lead-generation reporting for cost per lead, cost per booked call, and stage conversion by channel and campaign.

### Latest continuation

- [x] Refresh the selected reporting window from ShopifyQL so P&L and Overview use current daily Shopify totals.
- [x] Import daily Meta and Google Ads spend and combine both sources in the selected P&L period.


- [x] Add regression tests for Shopify import recovery, retry limits, permanent failures, and sanitized errors; run them in GitHub Actions.
- [ ] Verify retry behavior against a live Shopify store; automated coverage currently uses simulated upstream responses.
- [x] Fix dashboard lint failures in `components/analytics-app.tsx`: avoid synchronous state updates in effects, update the stale-import clock outside rendering, complete effect dependencies, and remove the unused report deletion path.
- [x] Add server-validated date-range filtering and period-aware CSV metadata to product profitability reporting.
- [x] Add server-validated date-range filtering and period-aware CSV metadata to UTM reporting.
- [x] Add provisional contribution margin and percentage before merchant shipping, using COGS, variable costs, actual payment fees, and imported marketing spend.
- [x] Add owner/admin payment-fee rule management and use effective gateway rules when Shopify transactions omit actual fees.
- [x] Apply the payment-fee migration to the connected Supabase project and verify its columns, RLS policies, and database advisors.
- [x] Add effective-dated per-unit/per-order product shipping overrides with store-level fulfilment fallback and deploy the tenant-protected schema.
- [x] Group dashboard reporting dates by the Shopify store timezone while retaining UTC source timestamps.
- [x] Add a shared, versioned runtime schema for saved-report create/update payloads with regression tests.
- [x] Add database-backed saved-report definition versions and immutable revision history.
- [x] Clear all foreign-key index findings reported by the Supabase performance advisor.
- [x] Track saved-report executions against their exact definition version and record truthful success/failure outcomes.
- [x] Expose saved-report run history, sanitized failures, row counts, definition versions, and retry actions in the report library.
- [x] Prevent silent cross-currency aggregation across order-backed reports and surface excluded-currency coverage.
- [x] Add tenant-protected effective-dated exchange-rate management with a validated Settings workflow.
- [x] Convert Meta advertising spend into reporting currency by insight date and surface missing-rate coverage.
- [x] Standardize CSV export metadata across live report tables, including filters, reporting period, timezone, currency, and generation time.
- [x] Add Overview date-range selection with equal-length previous-period absolute and percentage KPI comparisons.
- [x] Add selectable daily, weekly, monthly, quarterly, and annual Overview revenue/cost/profit trends.
- [x] Replace the Overview trend with a combined finance chart: revenue above zero, stacked COGS/marketing/fees/shipping/operating costs below zero, and an overlaid profit line with hover values.
- [x] Add finance date presets across Overview, Profit & Loss, and Sales, including today/yesterday, rolling and complete-day windows, month presets, all imported data, and custom dates.
- [x] Add period-aware channel mix, top-product, customer-split, and known-cost Overview widgets.
- [x] Add period-preserving drilldowns from Overview KPI cards, chart points, and summary widgets into their detailed reports.
- [x] Add saved Overview widget visibility and ordering controls.
- [x] Add timezone-aware Sales breakdowns by date, channel, new/repeat customer, and product.
- [x] Import Shopify order country and discount codes, then expose both as Sales breakdown dimensions.
- [x] Complete the UTM KPI layer with selected-period gross profit and contribution margin from the reconciled P&L.
- [x] Add selectable monthly UTM sales, order, customer, and profit trends with previous-period overlays.
- [x] Add previous-period/year, landing-page, country, product, and customer-type UTM filters.
- [x] Add exact refunds and effective-dated COGS plus reconciled shared-cost allocations to every UTM group.
- [x] Import campaign-level Meta spend, map campaigns to normalized UTM groups with tenant-protected settings, and calculate mapped ROAS, MER, CAC, and profit.
- [x] Add a tested UTM naming normalizer and campaign URL builder that preserves existing landing-page parameters and fragments.
- [x] Save the current UTM date range, attribution model, comparison, and dimension filters as a reusable report definition.
- [x] Export the current UTM drilldown as a formatted XLSX workbook with numeric currency and percentage cells.
- [x] Audit connector credential creation, rotation, deletion, and Shopify scope updates without storing secret values.
- [x] Show the tenant-scoped connector credential audit history to workspace owners and admins in Settings.
- [x] Import tenant-protected daily custom marketing spend from CSV, deduplicate it deterministically, convert currencies by date, and allocate it to matching UTM groups.
- [x] Preview custom-spend imports, show batch history, and roll back imports while restoring overwritten rows.
- [x] Add a manual field-mapping screen for custom-spend CSV files with non-standard headers.
- [x] Add validated starter saved-report templates for income statements, channel spend, product profitability, and new-customer acquisition.
- [x] Add blended net profit per new customer to Customer analytics with explicit completeness requirements.
- [x] Audit the foundation checklist against the current auth, tenancy, and CI implementation and split remaining gaps precisely.
- [x] Add Google OAuth and email magic-link login paths with PKCE callback handling and local-only redirects.
- [x] Remove hardcoded Supabase browser fallbacks and validate public configuration across browser, server, proxy, tests, and deployment tooling.
- [x] Audit all 31 public Supabase tables for RLS and ownership-safe update policies; add a reusable structural database test.
- [x] Add a transactional tenant-isolation regression test for owner, viewer, analyst, and admin access to core workspace records.
- [x] Add an authenticated workspace API with validated, persistent organization and store selection; migrate freshness reporting to the selected store.
- [x] Scope Overview, P&L, Sales, Products, Customers, and UTM analytics routes to the validated active store.
- [x] Scope costs, saved reports, report runs, exchange rates, campaign mappings, custom spend, and connection audits to the active workspace and store.
- [x] Add store-scoped credential RPCs and bind Shopify, Meta, and Klaviyo connection routes to the active store.
- [x] Activate the application-shell store selector and reload every scoped report, cost, setting, and connection view after switching.
- [x] Remove legacy unscoped connection RPC overloads after the active-store release reached production.
- [ ] Enable Supabase leaked-password protection before external onboarding.

### Active build order

1. Apply and verify the Supabase tenant schema.
2. Verify Shopify connection and catalogue import against the first live store.
3. Import orders, lines, refunds, customers, and attribution data.
4. Add effective-dated product costs and CSV import.
5. Replace mock overview/P&L/UTM figures with reconciled Shopify metrics.
6. Add saved reports and CSV/Google Sheets export.

## Product direction

Build a Shopify-first ecommerce analytics web application. The web app is the primary place for analysis; Google Sheets is an export and collaboration destination, not the database or main interface.

The product should answer these questions quickly:

- How much revenue, gross profit, contribution margin, and net profit did the store produce?
- Which products, channels, campaigns, and customer groups are profitable?
- How do current results compare with the previous period or previous year?
- What costs are missing from Shopify, and how should they be allocated?
- Can a user save, schedule, export, and rerun a report without rebuilding it?
- Can an advanced user query trusted ecommerce data using SQL or plain English?

## Agreed architecture

- [x] Build a standalone responsive web app rather than extending the Apps Script sidebar.
- [x] Use Supabase Auth and Postgres for users, organizations, normalized ecommerce data, report definitions, and run history; scheduling remains a later phase.
- [x] Use a server-side application layer for API calls, secret access, sync orchestration, metric calculations, and exports.
- [x] Keep API credentials and connector tokens out of browser code and exposed database schemas.
- [x] Use lightweight persistence rather than pulling every API live for every page view.
- [ ] Store normalized operational data and daily analytics aggregates; do not build an unlimited raw event lake in v1.
- [x] Refresh recent dates on every sync so refunds, attribution, cancellations, and late adjustments are corrected.
- [x] Make implemented tenant-owned records belong to an `organization_id` and enforce access with Row Level Security.
- [ ] Keep the existing Apps Script project available as a connector reference until parity is reached.

### Proposed application stack

- [x] Web: Next.js, TypeScript, and a reusable component system.
- [x] Backend: server routes plus Supabase Postgres and Auth; background scheduling remains a later phase.
- [ ] Charts: choose a chart library after prototyping the income statement and product views.
- [ ] Validation: shared runtime schemas for API payloads, imports, report definitions, and server responses.
- [ ] Testing: unit tests for financial calculations, integration tests for connectors, and browser tests for onboarding and reports.
- [ ] Hosting: choose after the first vertical slice; keep long-running sync work separate from request/response page rendering.

## Non-negotiable financial rules

- [ ] Store monetary values in integer minor units or fixed-precision numeric columns; never use floating-point arithmetic for financial totals.
- [ ] Preserve source currency and normalized reporting currency separately.
- [x] Use effective-dated cost records so changing a product cost does not rewrite historical profit.
- [ ] Define whether every headline metric includes or excludes tax, shipping revenue, duties, tips, gift cards, and refunds.
- [x] Make metric definitions visible in the UI with tooltips or a metric dictionary.
- [ ] Reconcile dashboard totals back to Shopify for a selected period before releasing the MVP.
- [ ] Record calculation version on materialized analytics results so formula changes are auditable.

## Phase 0 — Security and repository foundation

### Immediate security

- [ ] Rotate the Chargebee credential currently embedded in `Config.gs`.
- [ ] Remove all live credentials from source files and local history before this code is shared or deployed.
- [x] Add `.env.example` with variable names only and ensure real environment files are ignored.
- [ ] Create separate development and production Supabase projects.
- [x] Use only a publishable Supabase key in the browser; keep secret/service-role credentials server-side.
- [x] Store third-party connector tokens in Supabase Vault behind ownership-checked server functions.
- [x] Add structured secret-access logging without logging secret values.

### New application workspace

- [ ] Create the web application in a new directory so the Apps Script prototype remains intact.
- [x] Add linting, type checking, unit testing, and production-build validation.
- [ ] Add an automatic formatter.
- [x] Add explicit Supabase public-environment validation and a deploy-time validation command.
- [x] Add local Supabase configuration and migration workflow.
- [x] Pin dependency versions and commit the lockfile.
- [x] Create CI checks for type checking, linting, tests, and the production build.
- [ ] Add migration verification to CI.
- [x] Add a short architecture decision record explaining Supabase, lightweight persistence, and Shopify-first scope.

## Phase 1 — Auth, organizations, and onboarding shell

### Authentication

- [x] Implement Google OAuth and email magic-link sign-in flows alongside password access.
- [ ] Enable the Google provider and production redirect URLs in Supabase, then verify both flows live.
- [x] Add sign-out, session refresh, account recovery, and protected routes.
- [x] Create user profile records without using editable user metadata for authorization.
- [x] Create an organization, owner membership, and initial store automatically during account onboarding.
- [x] Add owner, admin, analyst, and viewer roles through trusted organization membership records.

### Multi-tenant model

- [x] Create `organizations`.
- [x] Create `organization_members` with `owner`, `admin`, `analyst`, and `viewer` roles.
- [x] Create `stores` with Shopify domain, timezone, currency, reporting currency, and fiscal settings.
- [x] Support one organization owning multiple stores with validated active-store selection.
- [x] Add an active-store selector to the application shell.
- [x] Add RLS policies based on organization membership for every implemented exposed tenant table.
- [x] Explicitly revoke and grant Data API access for implemented browser-facing tables rather than relying on automatic exposure.
- [x] Keep connector secrets in Supabase Vault behind functions in the private, non-exposed schema.

### Application shell

- [x] Build the left navigation inspired by the supplied references, without cloning their branding.
- [ ] Add sections for Overview, Profit & Loss, Sales, Products, Customers, Marketing, Costs, Reports, Connections, and Settings.
- [ ] Add a global date range, comparison period, and daily/weekly/monthly granularity control.
- [ ] Persist active organization, store, date range, comparison, and timezone preferences.
- [ ] Add loading, empty, partial-data, stale-data, and connector-error states.
- [x] Display last successful Shopify sync and data freshness in the application shell.

## Phase 2 — Shopify connection and data ingestion

Shopify is the primary sales and catalog source. Other sources enrich Shopify rather than replacing its commercial totals.

### Connection flow

- [ ] Use Shopify OAuth for production installations.
- [x] Allow a development-only Admin API token path while OAuth is being built.
- [x] Validate the shop domain and required scopes before saving a connection.
- [x] Store encrypted access credentials server-side.
- [x] Show connection status, granted scopes, shop currency, timezone, last sync, and reconnect action.
- [x] Add disconnect behavior that removes the saved token and preserves imported data under a clear policy.

### Shopify source tables

- [x] Create `shopify_orders` with stable Shopify GraphQL IDs and order-level financial fields.
- [x] Create `shopify_order_lines` with product, variant, SKU, quantities, discounts, tax, and line revenue.
- [x] Create `shopify_refunds` and `shopify_refund_lines` rather than multiplying rows through nested joins.
- [x] Create `shopify_customers` with first-order date and aggregate customer fields.
- [x] Create `shopify_products` and `shopify_variants` with SKU, status, price, inventory references, and Shopify unit cost when available.
- [x] Create `shopify_transactions` for payment gateway and transaction-fee analysis.
- [x] Import compact daily ShopifyQL sales, COGS, gross-profit, and fee summaries using Shopify Admin’s reporting engine.
- [x] Create `shopify_order_attribution` for landing page, referrer, first/last visit, UTM source, medium, campaign, term, and content without duplicating order revenue.
- [ ] Create `shopify_fulfillments` only when required for shipping and operational reporting.
- [ ] Retain source JSON selectively for troubleshooting, with a retention limit and no unnecessary personal data.

### Sync engine

- [x] Add retry and backoff to the implemented cursor-based GraphQL pagination (bounded network/temporary-server retries, HTTP and GraphQL throttling, Retry-After, and query-cost recovery delays).
- [x] Implement an initial historical import with visible record/page progress and resumable order-page checkpoints.
- [x] Implement incremental sync using a fixed updated-at window and durable cursors so resumed runs see the same source result set.
- [x] Re-fetch a rolling seven-day recent window to capture refunds, edits, cancellations, and fulfillment changes.
- [ ] Add Shopify webhooks for important changes after scheduled sync is stable.
- [x] Make writes idempotent with source IDs and deterministic upserts.
- [x] Expand the implemented `sync_runs` tracking with resumable cursor, duration, warnings, and sanitized failed-run updates.
- [ ] Add dead-letter or retry handling for individual failed records.
- [x] Respect Shopify rate limits with bounded Retry-After/query-cost backoff and user-facing throttling errors.
- [ ] Add a manual “Sync now” action and configurable scheduled refresh.

### Shopify correctness

- [x] Separate gross sales, discounts, returns, shipping income, tax, duties, and net sales; tips and gift cards remain outside the current imported metric set.
- [x] Exclude test, cancelled, and unprocessed orders from financial reporting; include valid zero-value and refunded orders while recording refunds separately. Draft orders are not imported.
- [x] Use shop timezone for business-day grouping while retaining UTC source timestamps.
- [x] Determine new versus repeat customer from first valid order, not from campaign attribution.
- [ ] Handle guest checkouts and customer merges without double-counting customers.
- [ ] Support multi-currency orders and Shopify Markets without silently mixing currencies.
  - [x] Exclude non-reporting-currency orders from financial totals and show counts by source currency.
  - [x] Convert orders with explicit dated exchange rates before consolidated reporting.
    - [x] Add owner/admin-managed dated exchange rates from source currency into the store reporting currency.
    - [x] Apply matching historical rates consistently to orders, refunds, fees, and attribution metrics.
- [x] Add reconciliation tests against Shopify order totals for fixed sample periods.

## Phase 3 — Cost and expense engine

The cost engine must support direct entry, Shopify-provided values, and bulk imports. Every cost needs an allocation rule and an effective period.

### Product costs / COGS

- [x] Create `product_costs` keyed to store and variant, with optional SKU fallback.
- [x] Store source (`shopify`, `manual`, `csv`, or `google_sheets`), amount, currency, effective-from, effective-to, and notes.
- [x] Import Shopify unit cost when available, but allow a manual override.
- [x] Calculate order-line COGS using the cost effective on the order date.
- [x] Add a product cost table with product, variant, SKU, selling price, Shopify cost, active override cost, and active shipping override.
- [x] Add inline editing with validation and an audit history.
- [x] Highlight missing or stale product costs and quantify affected revenue/orders.

### Transaction costs

- [x] Create effective-dated payment fee rules by gateway with tenant RLS and owner/admin writes.
- [x] Support percentage plus fixed fee, tax on fees, currency, and minimum fee in the rule model and calculation service.
- [x] Map Shopify gateways to the latest effective matching-currency fee rule when imported actual fees are unavailable.
- [x] Support imported actual Shopify transaction fees, including fee tax, when Shopify supplies them in the reporting currency.

### Shipping and handling costs

- [ ] Create shipping cost rules by country/zone, service, order, weight, item, or flat amount.
- [x] Start the MVP with flat-per-order fulfilment fallback and effective-dated product/variant shipping overrides with per-order or per-unit allocation.
- [x] Add handling and pick/pack rules as separate effective-dated cost categories and deduct them from contribution margin and net profit.
- [x] Distinguish customer shipping revenue from merchant shipping expense.
- [x] Use store-level fulfilment costs as the fallback and report fallback, override, and uncovered order-line counts in the P&L.

### Custom costs and expenses

- [x] Create `custom_costs` with name, category, amount, currency, tax treatment, start date, end date, and notes.
- [x] Support one-off, daily, weekly, monthly, and annual recurring costs.
- [x] Support fixed costs and variable costs based on orders, units, and revenue percentage.
- [ ] Support allocation across all stores, selected stores, products, channels, or custom tags.
- [x] Add categories such as software, agency, payroll, warehouse, rent, creative, fulfilment, duties, and other.
- [ ] Keep personnel costs out of MVP unless required; model them as a custom-cost category first.

### Cost import workflow

- [x] Provide a downloadable CSV template and in-app column descriptions.
- [ ] Add drag-and-drop CSV upload with encoding, delimiter, date, currency, and decimal detection.
- [ ] Add a column-mapping step before import.
- [ ] Preview parsed rows, validation errors, duplicates, and projected allocations.
- [ ] Allow “reject invalid rows” or “import valid rows only”.
- [ ] Save import batches with original filename, uploader, counts, and error file.
- [ ] Make imports idempotent using an optional external ID plus organization/store scope.
- [ ] Add edit, archive, reverse, and re-import actions with audit history.
- [ ] Add Google Sheets cost import after CSV is stable: choose spreadsheet, tab, header row, and mapping.
- [ ] Support scheduled refresh from a connected cost sheet in a later phase.

## Phase 4 — Financial metric layer

Centralize formulas in tested SQL views/functions or a versioned metric service. Do not duplicate financial formulas in React components.

### Canonical metrics

- [x] Gross sales.
- [x] Discounts.
- [x] Returns and refunds.
- [x] Net product sales.
- [x] Shipping revenue.
- [x] Taxes and duties are shown separately and excluded from the current profit calculation.
- [x] Total sales, with a documented formula.
- [x] Product COGS using the effective product cost on the order date, with Shopify unit-cost fallback.
- [x] Gross profit and gross margin percentage, with missing-cost coverage warnings.
- [x] Marketing spend from imported Meta Ads daily account insights, scoped to the P&L date range and source currency.
- [x] Payment transaction fees from imported Shopify records when available, with effective-dated gateway rules as the fallback.
- [x] Shipping and fulfilment costs from effective-dated fulfilment expense rules.
- [x] Handling and pick/pack costs from effective-dated expense rules.
- [x] Contribution margin and contribution margin percentage, with a clearly labelled before-shipping fallback until fulfilment rules are configured.
- [x] Operating/custom expenses.
- [x] Net profit and net margin percentage when marketing, shipping, product-cost, and operating-cost coverage is complete.

### Acquisition and customer metrics

- [x] Orders and units sold from imported non-test, non-cancelled Shopify orders and their current line quantities.
- [x] Average order value.
- [x] New customers and repeat customers, classified from each customer’s first valid order.
- [x] New-customer sales and repeat-customer sales.
- [x] New-customer AOV and repeat-customer AOV.
- [x] Blended CAC using imported Meta spend divided by first-observed Shopify customers in the imported window.
- [x] Blended MER using Shopify net product sales divided by matching-currency imported Meta spend.
- [x] New-customer ROAS using first-observed Shopify order sales divided by blended Meta spend, explicitly labelled as a blended imported-window basis.
- [x] Blended period net profit per new customer, shown only when cost coverage is complete.
- [x] Repeat order and repeat revenue percentages.
- [ ] Customer lifetime value cohorts after the core P&L is reconciled.

### Analytics tables and views

- [ ] Create a daily store financial fact table or materialized view.
- [ ] Create daily channel and campaign spend facts.
- [ ] Create product/variant profitability facts.
- [ ] Create customer first-order and cohort facts.
- [ ] Create a calendar dimension for complete periods and comparison alignment.
- [ ] Refresh only affected periods after source or cost changes.
- [ ] Add indexes for organization, store, date, product, customer, channel, and campaign access patterns.
- [ ] Keep reporting views security-invoker and covered by tenant authorization.

## Phase 5 — Analytics web experience

### Overview dashboard

- [x] Add live KPI cards for sales, gross profit, marketing cost, contribution margin, net profit, orders, units, AOV, blended CAC, blended MER, and new-customer ROAS.
- [x] Show percentage and absolute change against the selected comparison period.
- [x] Add revenue, cost, and profit trend charts with selectable granularity.
- [x] Add channel mix, top products, customer split, and cost breakdown widgets.
- [x] Let users drill from a KPI or chart point into the underlying report, preserving the selected dashboard or chart period.
- [x] Add a configurable dashboard widget layout with saved visibility and ordering preferences.

### Income statement / P&L

- [x] Build the income statement layout inspired by the supplied reference, backed by imported Shopify sales and COGS data.
- [x] Add collapsible sections for sales, COGS, marketing, transaction costs, shipping/handling, custom expenses, contribution margin, and net profit.
- [x] Display reconciled periods as columns and financial lines as rows, capped to the latest 12 visible periods for readability.
- [x] Add monthly, weekly, daily, quarterly, and annual views.
- [x] Add previous-period and previous-year comparisons.
- [x] Add chart/table toggle and optional previous-period comparison overlay.
- [x] Show P&L formula explanations and source coverage for included and unavailable cost inputs.
- [x] Add reconciliation status and missing-cost warnings above the table.
- [x] Export exactly the visible P&L configuration.
- [x] Default P&L reporting to the latest 365 days and use ShopifyQL totals when available.

### Sales and orders

- [x] Add sales breakdown by date, country, channel, discount code, new/repeat status, and product.
- [x] Show the daily sales report from ShopifyQL with refunds, units, recorded COGS, gross profit, payment fees, and profit after fees.
- [x] Add a searchable order table with financial-status and refund filters.
- [x] Add an order detail drawer showing source totals, product costs, refunds, and gross profit.
- [ ] Add saved column layouts and filters later.

### UTM analysis

- [x] Build a dedicated UTM analytics screen using Shopify order and customer-journey attribution data.
- [x] Add KPI cards for attributed orders, net sales, new-customer sales, gross profit, contribution margin, AOV, and revenue per customer.
- [x] Add trend charts for sales, orders, customers, and profit with equal-length previous-period comparison.
- [x] Add a drilldown table for source → medium → campaign → content → term.
- [x] Let users switch between available first-touch and last-touch attribution views and explain the selected model.
- [x] Preserve imported raw UTM values while creating report-time normalized values for case, whitespace, common aliases, and missing parameters.
- [x] Group attribution clearly as Direct, Organic, Referral, Attributed, or Unknown using documented source, medium, and referrer rules.
- [x] Add filters for comparison period, landing page, country, product, and new/repeat customer.
- [x] Show revenue, refunds, COGS, marketing cost, contribution profit, AOV, and customer mix for every UTM grouping.
- [x] Prevent order revenue from being counted more than once by selecting one model-specific attribution record per order and aggregating from the valid-order set.
- [x] Add a mapping interface to connect imported Meta campaigns to UTM groups when names do not match exactly.
- [x] Feed custom spend rows directly into normalized UTM source, medium, and campaign groups.
- [ ] Extend campaign mapping to Google Ads after that connector is available.
- [x] Calculate ROAS, MER, CAC, and profit after Meta spend is mapped; label metrics unavailable without traffic, spend, or required cost data.
- [x] Add an unattributed-sales diagnostic showing orders missing attribution records, UTMs, landing pages, or referrers.
- [x] Allow users to save the current UTM filters as a report and reopen the same view; keep CSV export available for the current drilldown.
- [x] Add a formatted XLSX export for the current UTM drilldown.
- [ ] Add Google Sheets export destinations for saved and current UTM reports.
- [x] Add optional UTM naming rules and a campaign URL builder after the analysis workflow is stable.

### Product profitability

- [x] Add product/variant profitability with revenue, units, discounts, refunds, COGS, shipping, handling, proportional Meta-spend allocation, contribution profit, and margin percentage.
- [x] Add missing-cost and low-margin filters.
- [x] Add per-product monthly revenue/unit trends and equal-length previous-period contribution-profit comparison.
- [x] Allow direct navigation from a product to its cost history.

### Customer analytics

- [x] Add new versus repeat customer metrics and sales.
- [x] Add cohort retention and cumulative revenue tables for the latest twelve first-order cohorts with Month 0–6 coverage. Cumulative profit remains a follow-up.
- [x] Add current customer value, order frequency, time-to-second-order, and repeat purchase rate.
- [x] Mask or restrict personal customer data according to role.

## Phase 6 — Marketing data sources

Normalize every ad source into shared daily dimensions while retaining source-specific fields.

### Shared marketing model

- [ ] Create `ad_accounts`, `ad_campaigns`, `ad_groups`, `ads`, and `ad_metrics_daily` or equivalent normalized tables.
- [ ] Normalize source, account, campaign, ad group/ad set, ad, date, currency, spend, impressions, clicks, and platform conversions.
- [ ] Keep platform-reported conversions separate from Shopify revenue and orders.
- [x] Convert spend into reporting currency with explicit exchange-rate dates.
- [ ] Add account and campaign mapping tools for naming inconsistencies.
- [ ] Re-fetch recent days because advertising attribution is revised after the event.

### Meta Ads

- [x] Port account discovery and daily account-insights concepts from `Meta.gs` into a typed server connector.
- [ ] Use OAuth or a secure system-user connection flow appropriate to the deployment model.
- [ ] Import daily account, campaign, ad set, and ad metrics.
- [ ] Support selectable attribution windows later; record the window with imported metrics.
- [ ] Add spend, CTR, CPC, CPM, platform ROAS, Shopify revenue, blended ROAS, and contribution metrics.

### Google Ads

- [ ] Replace Apps Script OAuth with a production OAuth flow and securely stored refresh token.
- [ ] Refresh the Google Ads API version and GAQL fields before porting queries.
- [ ] Import daily campaign metrics first; add ad group and keyword detail after the core report works.
- [ ] Handle manager-account login customer IDs.
- [ ] Separate Google Ads conversion values from Shopify sales.

### Custom marketing cost import

- [x] Allow CSV import of daily spend for channels without an API connector.
- [x] Require date, source/channel, and spend; optionally accept account, campaign, ad group, currency, and external ID.
- [x] Add preview, server validation, import batches, and reversible rollback for custom-spend CSV imports.
- [x] Add a manual column-mapping step for non-standard custom-spend CSV headers.
- [x] Prevent duplicate spend with deterministic import keys.

## Phase 7 — Klaviyo analytics

- [ ] Add a Klaviyo private API key connection with minimum required read scopes.
- [ ] Validate the key and show the connected account/profile details available from the API.
- [ ] Import campaign metadata separately from reporting metrics.
- [ ] Use Klaviyo Reporting API values reports for campaign totals matching the Klaviyo UI.
- [ ] Add campaign performance: recipients, delivered, opens, clicks, conversions, attributed revenue, unsubscribes, spam complaints, and rates.
- [ ] Add email versus SMS breakdown where supported.
- [ ] Add A/B variation reporting.
- [ ] Add flow reporting after campaign reporting is stable.
- [ ] Import daily/weekly series where supported for trend charts.
- [ ] Store the Klaviyo conversion metric and reporting configuration used for each result.
- [ ] Add a Klaviyo report page with period comparison and drilldown.
- [ ] Show Klaviyo-attributed revenue separately from Shopify order revenue to avoid double-counting.

## Phase 8 — Saved reports and report builder

### Saved report specifications

- [x] Create `saved_reports` with owner, organization, store scope, report type, name, description, and access settings.
- [x] Store relative date presets separately from resolved run dates.
- [x] Support private and organization-shared reports.
- [x] Validate saved-report definitions and updates through a shared versioned runtime schema.
- [x] Add favourite actions; add duplicate, rename, and archive actions.
- [x] Record report version and last successful run.
  - [x] Record and display the report definition version with immutable revision history.
  - [x] Record the last successful execution only after the selected analytics request succeeds.
- [x] Create starter templates for P&L, daily channel spend, product profitability, and new customer acquisition.
- [ ] Add the Klaviyo campaigns starter template when the Klaviyo report page is available.

### Visual report builder

- [ ] Let users choose a trusted dataset rather than arbitrary physical tables.
- [ ] Let users select dimensions, metrics, filters, date range, comparison, sorting, and row limit.
- [ ] Validate incompatible dimensions and metrics before execution.
- [ ] Preview results before saving.
- [ ] Support table, line, bar, stacked bar, and KPI visualizations.
- [ ] Allow dashboard pinning after report execution is reliable.

### SQL and plain-English analysis

- [ ] Create read-only analytics views with friendly names and documented columns.
- [ ] Add a SQL editor for authorized advanced users.
- [ ] Execute queries with a read-only database role, statement timeout, row limit, and organization/store scope enforcement.
- [ ] Block writes, DDL, unsafe functions, multiple statements, and access to private schemas.
- [ ] Add query cost/complexity checks and cancellation.
- [ ] Save SQL reports and their visualization settings.
- [ ] Add plain-English-to-SQL only after the trusted analytics schema is stable.
- [ ] Provide the model with schema metadata, metric definitions, and verified example queries.
- [ ] Show generated SQL before execution and explain assumptions.
- [ ] Require confirmation for expensive queries and never give the model direct secret or service-role access.

## Phase 9 — Exports and Google Sheets

### File exports

- [x] Export any report table to CSV.
- [ ] Export the income statement and selected detailed reports to XLSX with formatted headers and currency/date cells.
- [x] Include report name, filters, date range, timezone, currency, and generated timestamp in export metadata.
- [ ] Stream or background large exports and provide a time-limited download.

### Google Sheets export

- [ ] Add Google OAuth with only the scopes needed to select and update spreadsheets.
- [ ] Export to a new spreadsheet or an existing spreadsheet/tab.
- [ ] Support replace-tab, replace-range, and append modes with clear warnings.
- [ ] Write values in batches and apply basic number/date/header formatting.
- [ ] Save export destinations as reusable report outputs.
- [ ] Schedule saved report exports daily, weekly, or monthly.
- [ ] Record export runs, row counts, destination links, and sanitized errors.
- [ ] Detect renamed/deleted spreadsheets and prompt for reconnection.
- [ ] Never treat an exported sheet as the canonical analytics dataset.

## Phase 10 — Scheduling, observability, and reliability

- [ ] Create `sync_schedules`, `report_schedules`, and `export_schedules`.
- [ ] Use short Supabase Cron jobs only to enqueue or invoke work; keep long connector syncs resumable and outside a single database transaction.
- [ ] Ensure no scheduled worker can run the same organization/store/source job concurrently.
- [ ] Add retries with exponential backoff and a maximum attempt count.
- [ ] Add structured logs with correlation IDs across sync, calculation, report, and export jobs.
- [ ] Add an admin job monitor showing queued, running, failed, retried, and completed work.
- [ ] Add user-facing notifications for expired credentials and repeated sync/export failure.
- [ ] Track freshness and completeness separately for Shopify, costs, Meta, Google Ads, and Klaviyo.
- [ ] Add database backups, restore checks, retention policy, and data deletion workflow.
- [ ] Run Supabase security and performance advisors before each production release.

## Phase 11 — Quality, security, and release readiness

### Financial test suite

- [x] Test gross/net sales inputs with discounts and partial refunds through product profitability fixtures.
- [x] Test order-level residual refund allocation alongside explicit line-level refunds without double counting.
- [x] Test cost changes across effective dates.
- [x] Test missing cost fallback behavior.
- [x] Test configurable payment-fee rules with percentage plus fixed charge, tax, and minimum fee; actual Shopify fee inclusion is also covered.
- [x] Test shipping rules and multi-item orders.
- [x] Test recurring monthly costs across short and partial periods.
- [x] Test new/repeat customer classification using first valid order, with guest orders kept separate.
- [x] Test store-local timezone boundaries across daylight-saving changes and use them in P&L date filtering.
- [x] Test explicit multi-currency conversion, target-currency rounding, and rejection of mixed-currency totals.
- [x] Maintain a manually reconciled golden-store fixture covering the complete P&L bridge.

### Security and privacy

- [x] Enable RLS on every public table and verify coverage against the connected project.
- [ ] Test cross-organization isolation for every role and route.
- [x] Use both `USING` and `WITH CHECK` for every ownership-sensitive update policy.
- [ ] Keep privileged functions out of exposed schemas and minimize `SECURITY DEFINER` use.
- [ ] Use security-invoker views where supported.
- [ ] Never expose Supabase secret/service-role credentials or connector tokens to the browser.
- [ ] Redact credentials, customer PII, request bodies, and authorization headers from logs.
- [ ] Add rate limits to login, imports, syncs, SQL execution, and exports.
- [ ] Add audit logs for connection, cost, membership, report, and export changes.
- [ ] Define GDPR data export and deletion processes before onboarding external customers.

### Performance and usability

- [ ] Set target load times for dashboard, P&L, and report queries.
- [ ] Add server-side pagination and virtualization to large tables.
- [ ] Cache stable aggregate queries and invalidate them after affected syncs/cost changes.
- [ ] Add accessible keyboard navigation, labels, focus states, contrast, and chart alternatives.
- [ ] Verify responsive behavior, prioritizing desktop analytics while keeping mobile summaries usable.
- [ ] Add product analytics for onboarding completion, connection success, report use, and export use.

## Existing Apps Script migration map

| Existing file | Reuse | Migration action |
| --- | --- | --- |
| `Shopify.gs` | Partial | Reuse field discovery and Shopify response knowledge; replace sheet writes, credentials, pagination, nested row multiplication, and scheduling. |
| `Products.gs` | Minimal | Consolidate duplicate product functions into the new Shopify catalog connector. |
| `Meta.gs` | Partial | Reuse report-field ideas; rebuild authentication, API versioning, pagination, normalization, and persistence. |
| `Google.gs` | Partial | Reuse GAQL report intent; rebuild OAuth and refresh the API version/fields. |
| `Chargebee.gs` | Optional | Defer until Shopify, costs, ads, and Klaviyo are stable unless Chargebee is required for the core business. |
| `Triggers.gs` | Concept only | Replace Apps Script triggers with durable scheduled jobs and database run history. |
| `Utils.gs` | Concept only | Port generic parsing/error ideas into typed, tested server utilities. |
| `Sidebar.html` | No direct port | Use it as a checklist of existing connector actions, not as the new product UI. |
| `SidebarShopify.html` | No direct port | Replace with web onboarding, connection status, sync progress, and settings pages. |

## Recommended delivery milestones

### Milestone 1 — Shopify profit MVP

- [ ] Authentication, organization, and one-store onboarding.
- [ ] Shopify OAuth/token connection and historical sync.
- [ ] Product cost entry plus CSV import.
- [ ] Reconciled daily sales, COGS, gross profit, and contribution margin.
- [ ] Overview dashboard, basic P&L, product profitability, and CSV export.
- [ ] Basic UTM source/medium/campaign sales and profit screen using Shopify attribution data.

### Milestone 2 — Complete operating P&L

- [ ] Transaction, shipping, handling, recurring, and custom costs.
- [ ] Cost audit trail, missing-cost workflow, and full income statement.
- [ ] Period comparison, new/repeat metrics, and customer reports.
- [ ] Google Sheets export with saved destinations.

### Milestone 3 — Acquisition reporting

- [ ] Meta Ads and Google Ads connectors.
- [ ] Daily channel/campaign reports and blended acquisition KPIs.
- [ ] Custom marketing cost import.
- [ ] Saved report specifications and scheduled exports.

### Milestone 4 — Retention and flexible analysis

- [ ] Klaviyo campaign and flow reporting.
- [ ] LTV/cohort reporting.
- [ ] Visual report builder.
- [ ] Guarded SQL editor and plain-English-to-SQL.

## MVP definition of done

- [ ] A new user can sign in, create an organization, and connect one Shopify store.
- [ ] The initial Shopify sync can resume after interruption and subsequent syncs are incremental.
- [ ] A user can enter or import effective-dated product and operating costs.
- [ ] Dashboard and P&L totals reconcile to an agreed Shopify period and documented cost inputs.
- [ ] A user can inspect product profitability and identify missing costs.
- [ ] A user can save a report configuration and export its current result to CSV and Google Sheets.
- [ ] Every tenant-owned table is protected by tested RLS policies.
- [ ] No third-party credential is present in client code, logs, or source control.
- [ ] Failed syncs and exports are visible, retryable, and do not corrupt prior successful data.

## Explicitly deferred from MVP

- [ ] Automated multi-touch attribution.
- [ ] Forecasting and inventory purchasing recommendations.
- [ ] Personnel/payroll as a dedicated subsystem.
- [ ] Real-time event streaming.
- [ ] Arbitrary custom API connector builder.
- [ ] Marketplace billing and self-service subscriptions.
- [ ] Agency-wide cross-client benchmarking.
- [ ] Mobile-native applications.

## Product decisions still required

- [ ] Is v1 an internal tool for one business, or a multi-customer SaaS from launch?
- [ ] Which country, tax basis, and reporting currency should define the first reconciled P&L?
- [ ] Should headline sales include shipping revenue and exclude tax by default?
- [ ] Should refunds reduce revenue on order date or refund date, and should users be able to switch views?
- [ ] How far back should the first Shopify import go?
- [ ] Which custom cost allocation methods are essential for the first release?
- [ ] Is Chargebee still required once Shopify is the primary sales source?
- [ ] Which Google Sheets export format should be the first template: P&L, raw orders, channel daily, or all three?
- [ ] Is Google login sufficient for v1, or is email magic link required at launch?

## First implementation slice

Build one thin end-to-end path before implementing every connector:

1. Sign in and create an organization/store.
2. Connect Shopify and import a small date range.
3. Save normalized orders, lines, refunds, products, variants, and customers.
4. Enter effective-dated product costs.
5. Calculate daily sales, COGS, gross profit, and contribution margin.
6. Render the overview KPI cards, one trend chart, and the P&L table.
7. Export that exact report to CSV.
8. Reconcile all totals and add fixtures before widening scope.


