import { test } from "node:test";
import assert from "node:assert/strict";
import { portalStaffIds, toPortalStaff } from "./portal-staff.ts";

/**
 * The portal runs with the service role and hands what it reads to the
 * customer's browser. Staff are fetched only by the ids this customer's
 * own page references, and only their names cross over -- never the
 * platform's whole roster, never an email or phone number.
 */

test("collects the appointment reps and the note authors and answerers", () => {
  const ids = portalStaffIds(
    [
      { assigned_to: "rep-1", second_assigned_to: "rep-2" },
      { assigned_to: "rep-1", second_assigned_to: null },
    ],
    [
      { author_id: "rep-3", answered_by: null },
      { author_id: null, answered_by: "rep-4" },
    ]
  );
  assert.deepEqual(ids.sort(), ["rep-1", "rep-2", "rep-3", "rep-4"]);
});

test("nothing referenced means nothing to fetch", () => {
  assert.deepEqual(portalStaffIds([], []), []);
  assert.deepEqual(portalStaffIds([{ assigned_to: null, second_assigned_to: null }], null), []);
});

test("only the id and name reach the browser", () => {
  const staff = toPortalStaff([
    { id: "rep-1", name: "Asher Peretz", email: "a@example.com", phone: "555-0100" },
    { id: "rep-2", name: null },
  ]);
  assert.deepEqual(staff, [
    { id: "rep-1", name: "Asher Peretz" },
    { id: "rep-2", name: null },
  ]);
});
