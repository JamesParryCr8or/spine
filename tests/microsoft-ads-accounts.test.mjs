import test from "node:test";
import assert from "node:assert/strict";

import { microsoftAdsAccounts, microsoftAdsCustomerIds } from "../lib/analytics/microsoft-ads-accounts.ts";

test("reads customer roles from the top-level Microsoft GetUser response", () => {
  const payload = {
    User: { Id: "100" },
    CustomerRoles: [
      { CustomerId: "200", AccountIds: ["300"] },
      { CustomerId: 201 },
      { CustomerId: "200" },
    ],
  };
  assert.deepEqual(microsoftAdsCustomerIds(payload), ["200", "201"]);
});

test("accepts the nested CustomerRole response form as a compatibility fallback", () => {
  assert.deepEqual(microsoftAdsCustomerIds({ User: { CustomerRoles: { CustomerRole: { CustomerId: 200 } } } }), ["200"]);
});

test("normalizes Microsoft account info into selectable account rows", () => {
  assert.deepEqual(microsoftAdsAccounts({ AccountsInfo: [{ Id: 187160910, Name: "HairMax", Number: "G145LB8F", AccountLifeCycleStatus: "Active" }] }, "123"), [
    { account_id: "187160910", customer_id: "123", name: "HairMax", account_number: "G145LB8F", currency: null, status: "Active" },
  ]);
});
