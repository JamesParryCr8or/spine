export type WorkspaceRole = "owner" | "admin" | "analyst" | "connector" | "viewer";

export type WorkspaceMembership = {
  organizationId: string;
  role: WorkspaceRole;
  /** null means the user can access every store in the organization. */
  storeId?: string | null;
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
  const requestedOrganizationMemberships = memberships.filter(
    (candidate) => candidate.organizationId === requestedOrganizationId,
  );
  const requestedStoreMembership = memberships.find(
    (candidate) => candidate.storeId === requestedStoreId,
  );
  const activeOrganizationId = requestedOrganizationMemberships.length
    ? requestedOrganizationId
    : requestedStoreMembership?.organizationId ?? memberships[0]?.organizationId;
  const organizationMemberships = memberships.filter(
    (candidate) => candidate.organizationId === activeOrganizationId,
  );
  const fullOrganizationMembership = organizationMemberships.find((candidate) => !candidate.storeId);
  const scopedMembership = organizationMemberships.find(
    (candidate) => candidate.storeId === requestedStoreId,
  ) ?? organizationMemberships.find((candidate) => candidate.storeId);
  const membership = fullOrganizationMembership ?? scopedMembership ?? null;

  if (!membership) return { membership: null, store: null };

  const organizationStores = stores.filter(
    (candidate) => candidate.organizationId === membership.organizationId,
  );
  const accessibleStores = membership.storeId
    ? organizationStores.filter((candidate) => candidate.id === membership.storeId)
    : organizationStores;
  const store =
    accessibleStores.find((candidate) => candidate.id === requestedStoreId) ??
    accessibleStores[0] ??
    null;

  return { membership, store };
}
