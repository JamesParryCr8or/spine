import { test } from "node:test";
import assert from "node:assert/strict";

import { selectOrdersByProcessedAt } from "../lib/supabase/select-orders.ts";

function fakeAscendingTable(rows) {
  return (cursor, pageSize) => {
    const start = cursor
      ? rows.findIndex((row) => row.processed_at > cursor.processedAt || (row.processed_at === cursor.processedAt && row.id > cursor.id))
      : 0;
    const from = start === -1 ? rows.length : start;
    return Promise.resolve({ data: rows.slice(from, from + pageSize), error: null });
  };
}

test("pages every row across several full pages without an OFFSET", async () => {
  const rows = Array.from({ length: 2500 }, (_, index) => ({ id: String(index).padStart(5, "0"), processed_at: new Date(Date.UTC(2026, 0, 1) + index * 60_000).toISOString() }));
  const { rows: fetched, error } = await selectOrdersByProcessedAt(fakeAscendingTable(rows), 1000);
  assert.equal(error, null);
  assert.equal(fetched.length, 2500);
  assert.equal(fetched[0].id, rows[0].id);
  assert.equal(fetched[2499].id, rows[2499].id);
});

test("breaks ties on id when many orders share the same processed_at", async () => {
  // Ten orders with the identical timestamp, paged two at a time: this is
  // exactly the case plain `processed_at > cursor` pagination drops rows on.
  const rows = Array.from({ length: 10 }, (_, index) => ({ id: String(index).padStart(2, "0"), processed_at: "2026-01-01T00:00:00Z" }));
  const { rows: fetched, error } = await selectOrdersByProcessedAt(fakeAscendingTable(rows), 2);
  assert.equal(error, null);
  assert.deepEqual(fetched.map((row) => row.id), rows.map((row) => row.id));
});

test("stops after a single short page", async () => {
  const rows = [{ id: "a", processed_at: "2026-01-01T00:00:00Z" }, { id: "b", processed_at: "2026-01-02T00:00:00Z" }];
  const { rows: fetched, error } = await selectOrdersByProcessedAt(fakeAscendingTable(rows), 1000);
  assert.equal(error, null);
  assert.equal(fetched.length, 2);
});

test("surfaces an error and the rows collected before it", async () => {
  let call = 0;
  const loadPage = () => {
    call += 1;
    if (call === 1) return Promise.resolve({ data: [{ id: "a", processed_at: "2026-01-01T00:00:00Z" }], error: null });
    return Promise.resolve({ data: null, error: { message: "boom" } });
  };
  const { rows, error } = await selectOrdersByProcessedAt(loadPage, 1);
  assert.equal(error, "boom");
  assert.deepEqual(rows, [{ id: "a", processed_at: "2026-01-01T00:00:00Z" }]);
});
