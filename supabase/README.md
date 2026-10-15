# Supabase setup

The tenant and connection foundation was applied to the development project on 17 September 2026 through the connected Supabase migration API.

It creates profiles, organizations, memberships, stores, tenant-scoped connection metadata, Row Level Security, automatic workspace creation, encrypted Vault secrets, and authenticated connection RPCs.

Use **Connections → Meta Ads**. The server validates the token against Meta before saving it, and the token is never returned to the browser.

### Meta app sign-in

The primary connection option is **Connect with Meta**. It exchanges the authorization code on the server, then asks the user to select an ad account before saving the connection to Vault and importing spend. Manual system-user tokens remain an optional alternative.

Set server environment variables `META_APP_ID`, `META_APP_SECRET`, and `META_OAUTH_REDIRECT_URI`. The redirect URI must match the Meta app's allowed callback exactly. Spine's production callback is `https://spine-nine-orpin.vercel.app/api/connections/meta/callback`, using app `1137765288603817`. Keep the secret in Vercel Secret settings; never commit it. `META_LOGIN_CONFIG_ID` optionally selects a Facebook Login for Business configuration belonging to this app.

Sign-in requests `ads_read`. State and temporary credentials use authenticated encryption in HttpOnly cookies, expire after ten minutes, and are bound to the signed-in user, organization, and store. Changing brands during sign-in requires reconnecting. Environment changes require a new deployment before they take effect.

### Shopify billing CSVs

**Expenses → Shopify bills** accepts the detailed Shopify charges export, preserves every source column, and previews categories before import. Confirm the full export date range, including days without charges. Upload complete, unfiltered exports so identical charges can be reconciled consistently. Re-imports skip matching lines, and billed lines replace their unbilled versions without changing inclusion choices.

Current-month estimates use up to twelve fully imported prior months, prorated over elapsed days. Fixed app/subscription categories default on; variable categories default off. The store master switch and per-item overrides control estimates. Imported coverage and billed subscription periods suppress estimates; actual and estimated totals appear separately within P&L operating expenses. Missing exchange rates are reported instead of guessed.

The billing migrations add charges, import coverage, estimate preferences, and the atomic import RPC. `tests/shopify_billing.sql` exercises import reconciliation and tenant isolation inside a transaction that is rolled back.

The remote migration is named `create_tenant_and_connection_foundation`; a second migration, `add_tenant_foreign_key_indexes`, covers the foreign-key indexes. Add pgTAP RLS tests before production deployment.

## Database tests

- `tests/rls_coverage.sql` checks that every public table has RLS, every public update policy has both read and write predicates, and no policy grants direct access to `anon` or `public`.
- `tests/tenant_isolation.sql` creates transactional users and workspaces to verify owner isolation plus viewer, analyst, and admin permissions. The script rolls back every fixture.

Run both files after applying `setup.sql` and all migrations. The tenant-isolation test requires a development or disposable database because it inserts temporary Auth users inside a transaction.

