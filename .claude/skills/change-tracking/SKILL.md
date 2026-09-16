---
name: change-tracking
description: Add an append-only audit trail whenever building or touching an admin edit that can restate pay, money, or history on a signed/settled record after the fact — commission seats, rates, retro edits to signed documents, anything where "who changed this and when" will one day be a payroll dispute. Use it to design the table, RLS, action wiring, and UI history consistently with sales_team_changes (0154).
---

# Change tracking (audit trails)

## When this applies

Any edit that is (a) allowed **after** a record is signed/settled, and
(b) restates what somebody is owed or what history says — because the
reading side computes live from current values. The tell: "if this
field changes, a report silently reads as if it was always so."
Worked example everywhere below: `sales_team_changes` (migration
0154, decision 026) — commission seats on a signed contract.

Not for ordinary CRUD noise (a lead's phone number), and not a
replacement for RLS: the trail records the change, RLS still decides
who may make it.

## The pattern

**1. Table — raw snapshots, append-only by RLS.**
One `<thing>_changes` table per audited surface:

- `id uuid pk`, `company_id` (references companies, cascade — every
  tenant table scopes by company), `<target>_id` (references the
  audited row, cascade), `changed_by uuid references profiles on
  delete set null` (nullable so the trail survives a profile
  deletion; null renders as "system"), `changed_at timestamptz
  default now()`, `old_<x> jsonb not null`, `new_<x> jsonb not null`.
- Snapshot the **raw stored columns**, nulls included — a null rate
  is "never chosen", a different fact from 0. Never store prose.
- RLS: `select` and `insert` only, for exactly the role that may make
  the edit (mirror the server action's role check, e.g.
  `m.roles && array['Office','Admin']::app_role[]` on an active
  `company_members` row). Insert additionally requires
  `changed_by = auth.uid()`. **No update or delete policy for
  anyone** — an audit trail you can edit is not an audit trail.
- Index `(<target>_id, changed_at desc)`. Migration is idempotent
  with a verify block, like every migration in `supabase/migrations/`.

**2. Describe at read time — one pure, tested function.**
A `describe<Thing>Change(before, after, nameResolver): string[]` in
`src/lib/data/<thing>-changes.ts`, TDD'd beside it (see
`sales-team-changes.test.ts`): one line per decision in the UI's own
vocabulary ("Salesperson: A → B"), coupled numbers as one line
("Share split: 100% / 0% → 60% / 40%"), null as "unset"/"none",
ids resolved through a caller-supplied resolver. `changed()` is
`describe(...).length > 0` — the same rule decides recording and
rendering, so the trail can never hold an empty entry. Test first:
no-change → `[]`, a swap names both people, unresolvable historical
ids still describe.

**3. Capture in the server action that makes the edit.**
Read the current row (the before), perform the update, then insert
the audit row only when `changed()`. Order matters: the business
update is the fact; if the audit insert then fails, return an error
saying "saved, but recording it in the history failed" — never
pretend the save failed. If more than one code path can write the
audited columns, prefer a `before update` trigger instead (and note
service-role paths have `auth.uid()` null — 024). Either way, log
the uncovered paths in `docs/TECH_DEBT.md`.

**4. Show it where the edit happens.**
A small "Change history" list at the bottom of the editing panel,
gated to the same role that may edit (this is pay/history data, not
general info): `date · who — line · line`. Resolve names through the
**whole roster**, never the narrowed dropdown list (AGENTS.md —
historical assignees must not become "Unnamed"). Refresh the list
after a successful save.

**5. Docs.**
Feature row in `docs/features/<domain>.md`, a numbered entry in
`docs/DECISIONS.md` (what's captured, what deliberately isn't, why
action vs trigger), and any known bypass in `docs/TECH_DEBT.md`.

## Hard rules

- Append-only means **enforced by RLS**, not by "the app never
  updates it".
- The trail starts when the migration lands; never backfill invented
  history, and never let display changes restate stored snapshots.
- Recording a change is not permission to make it — keep the edit's
  own role check exactly as strict as before.
