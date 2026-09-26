# Workspace roles and invitations

Membership is scoped to an **organization**. A member can access all brands in that organization; joining another organization creates a separate membership. Role and permission definitions live in `public.organization_roles`; assignments live in `public.organization_members`.

| Role | Reports | Customer names | Edit costs and data | Add/remove connections and tokens | Manage team |
| --- | --- | --- | --- | --- | --- |
| Owner | Yes | Yes | Yes | Yes | Yes |
| Admin | Yes | Yes | Yes | Yes | Yes |
| Analyst | Yes | Yes | No | No | No |
| Connections manager | Yes | No | No | Yes | No |
| Viewer | Yes | No | No | No | No |

Owners are created at workspace setup and cannot be granted by invitation. An owner or admin can invite an admin, analyst, connections manager or viewer, change a non-owner's role, remove a non-owner, or revoke a pending invitation. Nobody can change or remove their own membership through the Team screen. Admins cannot promote someone to owner or modify an owner.

Invitations are email-bound, single-use and expire after seven days. The server returns a one-time URL to the inviter to copy and send; it stores only a SHA-256 hash of the random token in `organization_invitations`. The recipient signs in or signs up with the same **confirmed** email. Acceptance is one database transaction that creates the membership and consumes the invitation. A revoked, expired, reused or wrong-email link is rejected. The recipient's active workspace cookie then selects the invited organization.

Email sending is intentionally deferred until Supabase mail delivery is configured. The Team screen already creates usable links, including for existing Supabase users. A later mailer can send that same URL without changing the acceptance contract. Send it only to the intended email recipient; the app checks the email again when the link is used.

Database RLS controls read access to workspaces and writes to costs. Credential RPCs grant the connections manager role only to connection operations. API routes also check the role before OAuth, credential and import actions. Shopify and Meta connector imports run server-side with a scoped workspace check. Financial CSV and Google Sheets imports remain owner/admin operations.
