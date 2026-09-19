# Row Level Security audit

Last verified against Supabase project `smtrzopjvbjzzqacjkrw` on 18 September 2026.

## Verified guarantees

- Every public base table has Row Level Security enabled.
- Tenant tables expose policies only to the authenticated role.
- Every public `UPDATE` policy has both a `USING` predicate and a `WITH CHECK` predicate.
- Connector credential values remain in Supabase Vault and are not selected through public tables.
- `supabase/tests/rls_coverage.sql` repeats the structural checks and fails when a future migration weakens them.

This structural audit does not replace cross-organization behavior tests. Those remain required for each role and route.


## Behavioral coverage

`supabase/tests/tenant_isolation.sql` creates two temporary Auth users and workspaces inside a transaction. It verifies that an owner cannot read or update another organization, cannot read another profile, and cannot create a store for another organization. It also verifies that viewers and analysts can read a shared organization without changing it, while admins can update the organization and create stores. The transaction rolls back all fixtures.

Route-level checks and behavioral coverage for the remaining tenant tables are still required before the broader cross-organization checklist item can be completed.

## Security advisor review

The advisor currently reports three intentional `SECURITY DEFINER` RPCs:

- `save_data_connection(connection_provider, requested_store_id, ...)`
- `delete_data_connection(connection_provider, requested_store_id)`
- `record_shopify_connection_scopes(scopes, requested_store_id)`

They are exposed to authenticated users because the server routes need narrowly scoped Vault operations. Each function derives the caller from `auth.uid()`, requires an owner or admin membership, requires the requested store to belong to an organization where the caller is an owner or admin, fixes `search_path`, and does not return secrets. Legacy overloads that selected the first organization/store were removed after the scoped release reached production. Keep these checks when modifying the functions.

The advisor also reports that leaked-password protection is disabled. Enable that Auth setting before external customer onboarding.
