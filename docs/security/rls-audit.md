# Row Level Security audit

Last verified against Supabase project `smtrzopjvbjzzqacjkrw` on 18 September 2026.

## Verified guarantees

- Every public base table has Row Level Security enabled.
- Tenant tables expose policies only to the authenticated role.
- Every public `UPDATE` policy has both a `USING` predicate and a `WITH CHECK` predicate.
- Connector credential values remain in Supabase Vault and are not selected through public tables.
- `supabase/tests/rls_coverage.sql` repeats the structural checks and fails when a future migration weakens them.

This structural audit does not replace cross-organization behavior tests. Those remain required for each role and route.

## Security advisor review

The advisor currently reports three intentional `SECURITY DEFINER` RPCs:

- `save_data_connection`
- `delete_data_connection`
- `record_shopify_connection_scopes`

They are exposed to authenticated users because the server routes need narrowly scoped Vault operations. Each function derives the caller from `auth.uid()`, requires an owner or admin membership, scopes its work to that membership’s organization/store, fixes `search_path`, and does not return secrets. Keep these checks when modifying the functions.

The advisor also reports that leaked-password protection is disabled. Enable that Auth setting before external customer onboarding.
