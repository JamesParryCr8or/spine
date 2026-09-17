# Ecommerce Analytics Web App Roadmap

## Current implementation status

- [x] Replaced the generic starter UI with a responsive Shopify-first analytics shell.
- [x] Added protected Supabase-authenticated application routes.
- [x] Added Overview, Profit & Loss, UTM, Costs, Reports, and Connections screens.
- [x] Added the first Meta Ads connection flow with Graph API Explorer guidance and token validation.
- [x] Added a server-only Meta connection API; connector tokens are never returned to the browser.
- [x] Added a reviewed Supabase setup script for organizations, memberships, stores, RLS, and Vault-backed connector secrets.
- [x] Added a Shopify development-token connection flow using Admin GraphQL API `2026-07`.
- [x] Added cursor-paginated product and variant import with tenant RLS and sync-run history.
- [x] Confirmed lint and the Next.js production build complete successfully.
- [x] Apply `supabase/setup.sql` to the development Supabase project and verify the RLS/Vault functions.
- [ ] Replace dashboard mock figures with the first normalized Shopify data slice.

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

- [ ] Build a standalone responsive web app rather than extending the Apps Script sidebar.
- [ ] Use Supabase Auth and Postgres for users, organizations, normalized ecommerce data, report definitions, schedules, and run history.
- [ ] Use a server-side application layer for API calls, secret access, sync orchestration, metric calculations, and exports.
- [ ] Keep API credentials and OAuth refresh tokens out of browser code and exposed database schemas.
- [ ] Use lightweight persistence rather than pulling every API live for every page view.
- [ ] Store normalized operational data and daily analytics aggregates; do not build an unlimited raw event lake in v1.
- [ ] Refresh recent dates on every sync so refunds, attribution, cancellations, and late adjustments are corrected.
- [ ] Make every tenant-owned record belong to an `organization_id` and enforce access with Row Level Security.
- [ ] Keep the existing Apps Script project available as a connector reference until parity is reached.

### Proposed application stack

- [ ] Web: Next.js, TypeScript, and a reusable component system.
- [ ] Backend: server routes/jobs plus Supabase Postgres, Auth, Storage, and Cron where appropriate.
- [ ] Charts: choose a chart library after prototyping the income statement and product views.
- [ ] Validation: shared runtime schemas for API payloads, imports, report definitions, and server responses.
- [ ] Testing: unit tests for financial calculations, integration tests for connectors, and browser tests for onboarding and reports.
- [ ] Hosting: choose after the first vertical slice; keep long-running sync work separate from request/response page rendering.

## Non-negotiable financial rules

- [ ] Store monetary values in integer minor units or fixed-precision numeric columns; never use floating-point arithmetic for financial totals.
- [ ] Preserve source currency and normalized reporting currency separately.
- [ ] Use effective-dated cost records so changing a product cost does not rewrite historical profit.
- [ ] Define whether every headline metric includes or excludes tax, shipping revenue, duties, tips, gift cards, and refunds.
- [ ] Make metric definitions visible in the UI with tooltips or a metric dictionary.
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
- [ ] Add structured secret-access logging without logging secret values.

### New application workspace

- [ ] Create the web application in a new directory so the Apps Script prototype remains intact.
- [ ] Add formatting, linting, type checking, unit testing, and environment validation.
- [x] Add local Supabase configuration and migration workflow.
- [x] Pin dependency versions and commit the lockfile.
- [ ] Create CI checks for type checking, tests, migrations, and production build.
- [ ] Add a short architecture decision record explaining Supabase, lightweight persistence, and Shopify-first scope.

## Phase 1 — Auth, organizations, and onboarding shell

### Authentication

- [ ] Add Supabase Auth with Google and email magic-link sign-in for v1.
- [ ] Add sign-out, session refresh, account recovery, and protected routes.
- [ ] Create user profile records without using editable user metadata for authorization.
- [ ] Add organization creation during onboarding.
- [ ] Add owner and member roles using trusted application metadata or membership records.

### Multi-tenant model

- [ ] Create `organizations`.
- [ ] Create `organization_members` with `owner`, `admin`, `analyst`, and `viewer` roles.
- [ ] Create `stores` with Shopify domain, timezone, currency, reporting currency, and fiscal settings.
- [ ] Support one organization owning multiple stores, even if the MVP UI exposes one store initially.
- [ ] Add an active-store selector to the application shell.
- [ ] Add RLS policies based on organization membership for every exposed tenant table.
- [ ] Explicitly expose and grant Data API access only to tables/views required by the browser; do not assume new tables are exposed automatically.
- [ ] Keep connector secrets and internal job tables in a private, non-exposed schema.

### Application shell

- [ ] Build the left navigation inspired by the supplied references, without cloning their branding.
- [ ] Add sections for Overview, Profit & Loss, Sales, Products, Customers, Marketing, Costs, Reports, Connections, and Settings.
- [ ] Add a global date range, comparison period, and daily/weekly/monthly granularity control.
- [ ] Persist active organization, store, date range, comparison, and timezone preferences.
- [ ] Add loading, empty, partial-data, stale-data, and connector-error states.
- [ ] Display last successful sync and data freshness on every report.

## Phase 2 — Shopify connection and data ingestion

Shopify is the primary sales and catalog source. Other sources enrich Shopify rather than replacing its commercial totals.

### Connection flow

- [ ] Use Shopify OAuth for production installations.
- [x] Allow a development-only Admin API token path while OAuth is being built.
- [x] Validate the shop domain and required scopes before saving a connection.
- [x] Store encrypted access credentials server-side.
- [ ] Show connection status, granted scopes, shop currency, timezone, last sync, and reconnect action.
- [ ] Add disconnect behavior that revokes access where possible and preserves or deletes imported data according to a clear policy.

### Shopify source tables

- [x] Create `shopify_orders` with stable Shopify GraphQL IDs and order-level financial fields.
- [x] Create `shopify_order_lines` with product, variant, SKU, quantities, discounts, tax, and line revenue.
- [x] Create `shopify_refunds` and `shopify_refund_lines` rather than multiplying rows through nested joins.
- [x] Create `shopify_customers` with first-order date and aggregate customer fields.
- [x] Create `shopify_products` and `shopify_variants` with SKU, status, price, inventory references, and Shopify unit cost when available.
- [ ] Create `shopify_transactions` for payment gateway and transaction-fee analysis.
- [x] Create `shopify_order_attribution` for landing page, referrer, first/last visit, UTM source, medium, campaign, term, and content without duplicating order revenue.
- [ ] Create `shopify_fulfillments` only when required for shipping and operational reporting.
- [ ] Retain source JSON selectively for troubleshooting, with a retention limit and no unnecessary personal data.

### Sync engine

- [ ] Add retry and backoff to the implemented cursor-based GraphQL pagination.
- [ ] Implement an initial historical import with visible progress and resumable checkpoints.
- [ ] Implement incremental sync using updated timestamps and durable cursors.
- [ ] Re-fetch a rolling recent window to capture refunds, edits, cancellations, and fulfillment changes.
- [ ] Add Shopify webhooks for important changes after scheduled sync is stable.
- [x] Make writes idempotent with source IDs and deterministic upserts.
- [x] Expand the implemented `sync_runs` tracking with resumable cursor, duration, warnings, and sanitized failed-run updates.
- [ ] Add dead-letter or retry handling for individual failed records.
- [ ] Respect Shopify rate limits and report throttling clearly.
- [ ] Add a manual “Sync now” action and configurable scheduled refresh.

### Shopify correctness

- [ ] Separate gross sales, discounts, returns, shipping income, tax, duties, tips, and net sales.
- [ ] Decide how cancelled, test, draft, fully refunded, partially refunded, and zero-value orders are treated.
- [ ] Use shop timezone for business-day grouping while retaining UTC source timestamps.
- [ ] Determine new versus repeat customer from first valid order, not from campaign attribution.
- [ ] Handle guest checkouts and customer merges without double-counting customers.
- [ ] Support multi-currency orders and Shopify Markets without silently mixing currencies.
- [ ] Add reconciliation tests against Shopify order totals for fixed sample periods.

## Phase 3 — Cost and expense engine

The cost engine must support direct entry, Shopify-provided values, and bulk imports. Every cost needs an allocation rule and an effective period.

### Product costs / COGS

- [x] Create `product_costs` keyed to store and variant, with optional SKU fallback.
- [x] Store source (`shopify`, `manual`, `csv`, or `google_sheets`), amount, currency, effective-from, effective-to, and notes.
- [x] Import Shopify unit cost when available, but allow a manual override.
- [ ] Calculate order-line COGS using the cost effective on the order date.
- [ ] Add a product cost table with product, variant, SKU, selling price, Shopify cost, override cost, and shipping cost.
- [ ] Add inline editing with validation and an audit history.
- [ ] Highlight missing or stale product costs and quantify affected revenue/orders.

### Transaction costs

- [ ] Create effective-dated payment fee rules by gateway.
- [ ] Support percentage plus fixed fee, tax on fees, currency, and minimum fee.
- [ ] Map Shopify gateways to user-defined fee rules.
- [ ] Support imported actual transaction fees when a payment provider later supplies them.

### Shipping and handling costs

- [ ] Create shipping cost rules by country/zone, service, order, weight, item, or flat amount.
- [ ] Start the MVP with flat-per-order and product/variant shipping overrides.
- [ ] Add handling and pick/pack rules as separate cost categories.
- [ ] Distinguish customer shipping revenue from merchant shipping expense.
- [ ] Add a fallback cost and report how often the fallback was used.

### Custom costs and expenses

- [ ] Create `custom_costs` with name, category, amount, currency, tax treatment, start date, end date, and notes.
- [ ] Support one-off, daily, weekly, monthly, and annual recurring costs.
- [ ] Support fixed costs and variable costs based on orders, units, revenue, or percentage of another metric.
- [ ] Support allocation across all stores, selected stores, products, channels, or custom tags.
- [ ] Add categories such as software, agency, payroll, warehouse, rent, creative, fulfilment, duties, and other.
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

- [ ] Gross sales.
- [ ] Discounts.
- [ ] Returns and refunds.
- [ ] Net product sales.
- [ ] Shipping revenue.
- [ ] Taxes and duties.
- [ ] Total sales, with a documented formula.
- [ ] Product COGS.
- [ ] Gross profit and gross margin percentage.
- [ ] Marketing spend.
- [ ] Payment transaction fees.
- [ ] Shipping and fulfilment costs.
- [ ] Handling costs.
- [ ] Contribution margin and contribution margin percentage.
- [ ] Operating/custom expenses.
- [ ] Net profit and net margin percentage.

### Acquisition and customer metrics

- [ ] Orders and units sold.
- [ ] Average order value.
- [ ] New customers and repeat customers.
- [ ] New-customer sales and repeat-customer sales.
- [ ] New-customer AOV and repeat-customer AOV.
- [ ] Blended CAC.
- [ ] Blended MER/ROAS.
- [ ] New-customer ROAS using an explicitly documented attribution basis.
- [ ] Profit per new customer.
- [ ] Repeat order and repeat revenue percentages.
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

- [ ] Add KPI cards for sales, gross profit, marketing cost, contribution margin, net profit, orders, AOV, blended CAC, and blended ROAS.
- [ ] Show percentage and absolute change against the selected comparison period.
- [ ] Add revenue, cost, and profit trend charts with selectable granularity.
- [ ] Add channel mix, top products, customer split, and cost breakdown widgets.
- [ ] Let users drill from a KPI or chart point into the underlying report.
- [ ] Add a configurable dashboard widget layout after the fixed MVP dashboard is proven.

### Income statement / P&L

- [ ] Build the income statement layout inspired by the supplied reference.
- [ ] Add collapsible sections for sales, COGS, marketing, transaction costs, shipping/handling, custom expenses, contribution margin, and net profit.
- [ ] Display periods as columns and financial lines as rows.
- [ ] Add monthly, weekly, daily, quarterly, and annual views.
- [ ] Add previous-period and previous-year comparisons.
- [ ] Add chart/table toggle and optional comparison overlay.
- [ ] Show formula explanations and source coverage for each row.
- [ ] Add reconciliation status and missing-cost warnings above the table.
- [ ] Export exactly the visible P&L configuration.

### Sales and orders

- [ ] Add sales breakdown by date, country, channel, discount code, new/repeat status, and product.
- [ ] Add a searchable order table with financial-status and refund filters.
- [ ] Add an order detail drawer showing source totals, allocated costs, and calculated profit.
- [ ] Add saved column layouts and filters later.

### UTM analysis

- [ ] Build a dedicated UTM analytics screen using Shopify order and customer-journey attribution data.
- [ ] Add KPI cards for attributed orders, net sales, new-customer sales, gross profit, contribution margin, AOV, and revenue per customer.
- [ ] Add trend charts for sales, orders, customers, and profit with period comparison.
- [ ] Add a hierarchical drilldown table for source → medium → campaign → content → term.
- [ ] Let users switch between available first-touch and last-touch attribution views and explain the selected model.
- [ ] Preserve raw UTM values while creating normalized values for case, whitespace, aliases, and missing parameters.
- [ ] Group missing attribution clearly as Direct, Organic/Referral, or Unknown according to documented rules.
- [ ] Add filters for date, comparison period, source, medium, campaign, landing page, country, product, and new/repeat customer.
- [ ] Show revenue, refunds, COGS, marketing cost, contribution profit, AOV, and customer mix for every UTM grouping.
- [ ] Prevent order revenue from being counted more than once when an order has multiple visits or attribution records.
- [ ] Add a mapping interface to connect UTM campaigns to Meta/Google/custom spend when names do not match exactly.
- [ ] Calculate ROAS, MER, CAC, and profit after spend is mapped; label metrics unavailable without traffic or spend data.
- [ ] Add an unattributed-sales diagnostic showing orders missing UTMs, landing pages, or referrers.
- [ ] Allow users to save the UTM view as a report and export the current drilldown to CSV, XLSX, or Google Sheets.
- [ ] Add optional UTM naming rules and a campaign URL builder after the analysis workflow is stable.

### Product profitability

- [ ] Add product and variant tables with revenue, units, discounts, refunds, COGS, ad allocation, contribution margin, and margin percentage.
- [ ] Add missing-cost and low-margin filters.
- [ ] Add product trend and period comparison views.
- [ ] Allow direct navigation from a product to its cost history.

### Customer analytics

- [ ] Add new versus repeat customer trends.
- [ ] Add cohort retention and cumulative revenue/profit tables.
- [ ] Add LTV, order frequency, time-to-second-order, and repeat purchase rate.
- [ ] Mask or restrict personal customer data according to role.

## Phase 6 — Marketing data sources

Normalize every ad source into shared daily dimensions while retaining source-specific fields.

### Shared marketing model

- [ ] Create `ad_accounts`, `ad_campaigns`, `ad_groups`, `ads`, and `ad_metrics_daily` or equivalent normalized tables.
- [ ] Normalize source, account, campaign, ad group/ad set, ad, date, currency, spend, impressions, clicks, and platform conversions.
- [ ] Keep platform-reported conversions separate from Shopify revenue and orders.
- [ ] Convert spend into reporting currency with explicit exchange-rate dates.
- [ ] Add account and campaign mapping tools for naming inconsistencies.
- [ ] Re-fetch recent days because advertising attribution is revised after the event.

### Meta Ads

- [ ] Port account discovery and insights concepts from `Meta.gs` into a typed server connector.
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

- [ ] Allow CSV import of daily spend for channels without an API connector.
- [ ] Require date, source/channel, and spend; optionally accept account, campaign, ad group, currency, and external ID.
- [ ] Reuse the cost import mapping, preview, validation, batch, and rollback framework.
- [ ] Prevent duplicate spend with deterministic import keys.

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

- [ ] Create `saved_reports` with owner, organization, store scope, report type, name, description, filters, dimensions, metrics, sort, visualization, and date settings.
- [ ] Store relative date presets separately from resolved run dates.
- [ ] Support private, organization-shared, and read-only template reports.
- [ ] Add duplicate, rename, archive, and favorite actions.
- [ ] Record report version and last successful run.
- [ ] Create starter templates for P&L, daily channel spend, product profitability, new customer acquisition, and Klaviyo campaigns.

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

- [ ] Export any report table to CSV.
- [ ] Export the income statement and selected detailed reports to XLSX with formatted headers and currency/date cells.
- [ ] Include report name, filters, date range, timezone, currency, and generated timestamp in export metadata.
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

- [ ] Test gross/net sales with discounts and partial refunds.
- [ ] Test order-level and line-level refund allocation.
- [ ] Test cost changes across effective dates.
- [ ] Test missing cost fallback behavior.
- [ ] Test payment fees with percentage plus fixed charge.
- [ ] Test shipping rules and multi-item orders.
- [ ] Test recurring monthly costs across short and partial periods.
- [ ] Test new/repeat customer classification.
- [ ] Test timezone boundaries and daylight-saving changes.
- [ ] Test multi-currency conversion and rounding.
- [ ] Maintain golden fixture stores whose expected P&L is manually verified.

### Security and privacy

- [ ] Enable RLS on every table in exposed schemas.
- [ ] Test cross-organization isolation for every role and route.
- [ ] Use both `USING` and `WITH CHECK` for ownership-sensitive update policies.
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
