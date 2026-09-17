# Supabase setup

The tenant and connection foundation was applied to the development project on 17 September 2026 through the connected Supabase migration API.

It creates profiles, organizations, memberships, stores, tenant-scoped connection metadata, Row Level Security, automatic workspace creation, encrypted Vault secrets, and authenticated connection RPCs.

Use **Connections → Meta Ads**. The server validates the token against Meta before saving it, and the token is never returned to the browser.

The remote migration is named `create_tenant_and_connection_foundation`; a second migration, `add_tenant_foreign_key_indexes`, covers the foreign-key indexes. Add pgTAP RLS tests before production deployment.
