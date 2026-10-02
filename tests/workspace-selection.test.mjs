import assert from "node:assert/strict";
import test from "node:test";

import { selectActiveWorkspace } from "../lib/workspace/selection.ts";

const memberships = [
  { organizationId: "org-a", role: "owner" },
  { organizationId: "org-b", role: "analyst" },
];
const stores = [
  { id: "store-a-1", organizationId: "org-a" },
  { id: "store-a-2", organizationId: "org-a" },
  { id: "store-b-1", organizationId: "org-b" },
];

test("selects a requested organization and one of its stores", () => {
  assert.deepEqual(selectActiveWorkspace({
    memberships,
    stores,
    requestedOrganizationId: "org-a",
    requestedStoreId: "store-a-2",
  }), {
    membership: memberships[0],
    store: stores[1],
  });
});

test("never carries a store selection across organizations", () => {
  assert.deepEqual(selectActiveWorkspace({
    memberships,
    stores,
    requestedOrganizationId: "org-b",
    requestedStoreId: "store-a-1",
  }), {
    membership: memberships[1],
    store: stores[2],
  });
});

test("falls back safely when persisted ids are stale", () => {
  assert.deepEqual(selectActiveWorkspace({
    memberships,
    stores,
    requestedOrganizationId: "org-missing",
    requestedStoreId: "store-missing",
  }), {
    membership: memberships[0],
    store: stores[0],
  });
});

test("returns an empty selection without memberships", () => {
  assert.deepEqual(selectActiveWorkspace({
    memberships: [],
    stores,
    requestedOrganizationId: "org-a",
    requestedStoreId: "store-a-1",
  }), {
    membership: null,
    store: null,
  });
});

test("selects only the invited store when a person has memberships in several stores", () => {
  const invitedMemberships = [
    { organizationId: "org-a", storeId: "store-a-1", role: "viewer" },
    { organizationId: "org-a", storeId: "store-a-2", role: "admin" },
  ];
  assert.deepEqual(selectActiveWorkspace({
    memberships: invitedMemberships,
    stores,
    requestedOrganizationId: "org-a",
    requestedStoreId: "store-a-2",
  }), {
    membership: invitedMemberships[1],
    store: stores[1],
  });
});

test("selects an invited store when the organization cookie is stale", () => {
  const invitedMembership = { organizationId: "org-b", storeId: "store-b-1", role: "viewer" };
  assert.deepEqual(selectActiveWorkspace({
    memberships: [invitedMembership],
    stores,
    requestedOrganizationId: "org-missing",
    requestedStoreId: "store-b-1",
  }), {
    membership: invitedMembership,
    store: stores[2],
  });
});
