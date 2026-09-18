# Supabase setup

The tenant and connection foundation was applied to the development project on 17 September 2026 through the connected Supabase migration API.

It creates profiles, organizations, memberships, stores, tenant-scoped connection metadata, Row Level Security, automatic workspace creation, encrypted Vault secrets, and authenticated connection RPCs.

Use **Connections → Meta Ads**. The server validates the token against Meta before saving it, and the token is never returned to the browser.

The remote migration is named `create_tenant_and_connection_foundation`; a second migration, `add_tenant_foreign_key_indexes`, covers the foreign-key indexes. Add pgTAP RLS tests before production deployment.

## Database tests

- `tests/rls_coverage.sql` checks that every public table has RLS, every public update policy has both read and write predicates, and no policy grants direct access to `anon` or `public`.
- `tests/tenant_isolation.sql` creates transactional users and workspaces to verify owner isolation plus viewer, analyst, and admin permissions. The script rolls back every fixture.

Run both files after applying `setup.sql` and all migrations. The tenant-isolation test requires a development or disposable database because it inserts temporary Auth users inside a transaction.

