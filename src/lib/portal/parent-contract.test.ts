import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { portalParentContract } from "./parent-contract.ts";

/**
 * The contract a change order belongs to, as its customer's portal reads
 * it. The portal has no CRM login, so the staff lookup came back empty
 * under row-level security: the change order lost "To contract EST-1112",
 * the original contract's total and the revised total, and the customer
 * was asked to sign $8,500 with no idea what it added up to.
 */

type Row = Record<string, unknown>;

/** A tiny stand-in for the Supabase query builder over in-memory tables. */
function fakeDb(tables: Record<string, Row[]>) {
  const client = {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      let columns: string[] = [];
      const builder = {
        select: (list: string) => ((columns = list.split(",").map((c) => c.trim())), builder),
        eq: (col: string, val: unknown) => ((rows = rows.filter((r) => r[col] === val)), builder),
        maybeSingle: async () => ({
          data: rows[0] ? Object.fromEntries(columns.map((c) => [c, rows[0][c]])) : null,
          error: null,
        }),
      };
      return builder;
    },
  };
  return client as unknown as SupabaseClient;
}

const contract = {
  id: "est-1112",
  lead_id: "lead-1",
  doc_number: "EST-1112",
  total_cents: 4200000,
  signed_at: "2026-09-02T18:00:00Z",
};

test("the customer's own contract comes back for their change order", async () => {
  const parent = await portalParentContract(fakeDb({ estimates: [contract] }), "est-1112", "lead-1");
  assert.deepEqual(parent, {
    doc_number: "EST-1112",
    total_cents: 4200000,
    signed_at: "2026-09-02T18:00:00Z",
  });
});

test("another customer's contract never does", async () => {
  // Read with the service role, so this scope is the boundary.
  assert.equal(await portalParentContract(fakeDb({ estimates: [contract] }), "est-1112", "lead-2"), null);
});

test("a document with no parent has none", async () => {
  assert.equal(await portalParentContract(fakeDb({ estimates: [contract] }), null, "lead-1"), null);
});
