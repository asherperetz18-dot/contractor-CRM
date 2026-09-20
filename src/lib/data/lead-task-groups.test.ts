import { test } from "node:test";
import assert from "node:assert/strict";
import { groupTasksByDue } from "./lead-task-groups.ts";

/**
 * The Tasks page's whole job is the grouping: overdue first, then due
 * today, then what's coming. The dashboard's "overdue tasks" card and
 * this page must count the same rows (completed_at null, due_date
 * before today), so the boundary day is pinned here.
 */

const t = (id: string, due: string) => ({ id, due_date: due });

test("tasks split on today's date: before is overdue, today is due today, after is upcoming", () => {
  const groups = groupTasksByDue(
    [t("a", "2026-09-25"), t("b", "2026-09-20"), t("c", "2026-09-10"), t("d", "2026-09-19")],
    "2026-09-20"
  );
  assert.deepEqual(groups.overdue.map((x) => x.id), ["c", "d"]);
  assert.deepEqual(groups.dueToday.map((x) => x.id), ["b"]);
  assert.deepEqual(groups.upcoming.map((x) => x.id), ["a"]);
});

test("overdue and upcoming both read soonest-relevant first", () => {
  // Overdue: oldest first -- the longest-waiting customer tops the list.
  // Upcoming: nearest first -- what's next comes before next month.
  const groups = groupTasksByDue(
    [t("late1", "2026-09-01"), t("late2", "2026-08-15"), t("up1", "2026-10-05"), t("up2", "2026-09-22")],
    "2026-09-20"
  );
  assert.deepEqual(groups.overdue.map((x) => x.id), ["late2", "late1"]);
  assert.deepEqual(groups.upcoming.map((x) => x.id), ["up2", "up1"]);
});

test("same due date keeps the input order", () => {
  const groups = groupTasksByDue(
    [t("first", "2026-09-01"), t("second", "2026-09-01")],
    "2026-09-20"
  );
  assert.deepEqual(groups.overdue.map((x) => x.id), ["first", "second"]);
});

test("empty input means three empty groups, never a crash", () => {
  assert.deepEqual(groupTasksByDue([], "2026-09-20"), {
    overdue: [],
    dueToday: [],
    upcoming: [],
  });
});
