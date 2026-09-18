export type WorkspaceRole = "owner" | "admin" | "analyst" | "viewer";

export type WorkspaceMembership = {
  organizationId: string;
  role: WorkspaceRole;
};

export type WorkspaceStore = {
  id: string;
  organizationId: string;
};

type SelectionInput = {
  memberships: WorkspaceMembership[];
  stores: WorkspaceStore[];
  requestedOrganizationId?: string | null;
  requestedStoreId?: string | null;
};

export function selectActiveWorkspace({
  memberships,
  stores,
  requestedOrganizationId,
  requestedStoreId,
}: SelectionInput) {
  const membership =
    memberships.find((candidate) => candidate.organizationId === requestedOrganizationId) ??
    memberships[0] ??
    null;

  if (!membership) return { membership: null, store: null };

  const organizationStores = stores.filter(
    (candidate) => candidate.organizationId === membership.organizationId,
  );
  const store =
    organizationStores.find((candidate) => candidate.id === requestedStoreId) ??
    organizationStores[0] ??
    null;

  return { membership, store };
}
