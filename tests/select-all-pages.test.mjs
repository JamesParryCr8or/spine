import { test } from "node:test";
import assert from "node:assert/strict";

import { selectAllPages } from "../lib/supabase/select-all.ts";

function fakeTable(rows) {
  return ({ from, to }) => Promise.resolve({ data: rows.slice(from, to + 1), error: null });
}

test("returns every row across several full pages", async () => {
  const rows = Array.from({ length: 2500 }, (_, index) => ({ id: index }));
  const { rows: fetched, error } = await selectAllPages(fakeTable(rows), 1000);
  assert.equal(error, null);
  assert.equal(fetched.length, 2500);
  assert.deepEqual(fetched[0], { id: 0 });
  assert.deepEqual(fetched[2499], { id: 2499 });
});

test("stops after a single short page", async () => {
  const rows = Array.from({ length: 7 }, (_, index) => ({ id: index }));
  const { rows: fetched, error } = await selectAllPages(fakeTable(rows), 1000);
  assert.equal(error, null);
  assert.equal(fetched.length, 7);
});

test("stops exactly on a page-size boundary without an extra request", async () => {
  const rows = Array.from({ length: 1000 }, (_, index) => ({ id: index }));
  let calls = 0;
  const loadPage = ({ from, to }) => {
    calls += 1;
    return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
  };
  const { rows: fetched } = await selectAllPages(loadPage, 1000);
  assert.equal(fetched.length, 1000);
  assert.equal(calls, 2);
});

test("surfaces an error and the rows collected before it", async () => {
  let call = 0;
  const loadPage = () => {
    call += 1;
    if (call === 1) return Promise.resolve({ data: [{ id: 1 }], error: null });
    return Promise.resolve({ data: null, error: { message: "boom" } });
  };
  const { rows, error } = await selectAllPages(loadPage, 1);
  assert.equal(error, "boom");
  assert.deepEqual(rows, [{ id: 1 }]);
});
