import { test } from "node:test";
import assert from "node:assert/strict";
import { GROUP_LABEL, POPUP_KINDS, shapeToasts, type PopupKind, type PopupToast } from "./popup-shape.ts";

const ALL_ON: Record<PopupKind, boolean> = {
  message: true,
  money: true,
  job: true,
  lead: true,
  appointment: true,
};

function item(kind: PopupKind, n: number, sticky = false): PopupToast {
  return {
    id: `${kind}:${n}`,
    kind,
    icon: "•",
    title: `${kind} ${n}`,
    body: "",
    href: `/${kind}/${n}`,
    sticky,
  };
}

test("one or two of a kind pop as themselves", () => {
  const out = shapeToasts([item("lead", 1), item("lead", 2), item("money", 1, true)], ALL_ON);
  assert.deepEqual(
    out.map((t) => t.id),
    ["lead:1", "lead:2", "money:1"]
  );
  assert.equal(out[2].sticky, true);
});

test("three or more of a kind fold into one summary toast", () => {
  const out = shapeToasts([item("lead", 1), item("lead", 2), item("lead", 3), item("job", 1)], ALL_ON);
  assert.equal(out.length, 2);
  const [summary, job] = out;
  assert.equal(summary.id, "group:lead:lead:1");
  assert.equal(summary.title, "3 new leads");
  assert.equal(summary.body, "lead 1 · lead 2 · …");
  assert.equal(summary.href, "/contacts");
  assert.equal(summary.sticky, false);
  assert.equal(job.id, "job:1");
});

test("a burst that includes a sticky item stays sticky", () => {
  const out = shapeToasts([item("money", 1, true), item("money", 2, true), item("money", 3, true)], ALL_ON);
  assert.equal(out.length, 1);
  assert.equal(out[0].sticky, true);
  assert.equal(out[0].title, "3 payments received");
});

test("a kind switched off never pops, and does not count toward a group", () => {
  const out = shapeToasts(
    [item("lead", 1), item("lead", 2), item("lead", 3), item("appointment", 1)],
    { ...ALL_ON, lead: false }
  );
  assert.deepEqual(
    out.map((t) => t.id),
    ["appointment:1"]
  );
});

test("nothing in, nothing out", () => {
  assert.deepEqual(shapeToasts([], ALL_ON), []);
});

test("every popup kind has a switch label and a group label", () => {
  // The bell builds its filter tabs from POPUP_KINDS, and the switches
  // panel does too. If a kind is missing here it has no tab -- which is
  // exactly how "Leads" could be switched on but never seen.
  const kinds = POPUP_KINDS.map((k) => k.key).sort();
  assert.deepEqual(kinds, (Object.keys(GROUP_LABEL) as PopupKind[]).sort());
  assert.deepEqual(kinds, Object.keys(ALL_ON).sort());
  for (const k of POPUP_KINDS) {
    assert.ok(k.label.trim(), `${k.key} needs a label`);
    assert.ok(k.hint.trim(), `${k.key} needs a hint`);
  }
});
