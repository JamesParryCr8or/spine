# ADR 0001: Shopify-first analytics with Supabase persistence

## Status

Accepted.

## Decision

Spine is a Next.js application backed by Supabase Auth and Postgres. Shopify is the primary source of commercial truth for the first release.

The application imports normalized Shopify orders, lines, refunds, products, variants, customers, attribution, and transaction-fee data into tenant-scoped tables. Analytics routes calculate reports from those persisted records and effective-dated costs; they do not call Shopify on every page view.

Connector credentials remain server-side in Supabase Vault. Browser code receives report data and connection status, never connector tokens.

## Consequences

This keeps dashboards responsive, allows product costs and operating expenses to be applied consistently, and makes exports reproducible. Imports must be resumable and refreshed to capture later refunds or amendments. Marketing platforms enrich Shopify totals rather than replacing them.
