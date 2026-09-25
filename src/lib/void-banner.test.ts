import { test } from "node:test";
import assert from "node:assert/strict";
import { voidBannerLead } from "./void-banner.ts";

test("a hand void names who pressed it, with the day and the reason", () => {
  assert.equal(
    voidBannerLead({ day: "9/18/2026", voidedByName: "Asher Peretz", reason: "na" }),
    "Voided on 9/18/2026 by Asher Peretz — na"
  );
});

test("an automatic void (superseded by a signed version) names nobody", () => {
  assert.equal(
    voidBannerLead({ day: "9/18/2026", voidedByName: null, reason: "Superseded by EST-1066 v7" }),
    "Voided on 9/18/2026 — Superseded by EST-1066 v7"
  );
});

test("missing day and reason drop out instead of leaving gaps", () => {
  assert.equal(
    voidBannerLead({ day: null, voidedByName: "Asher", reason: null }),
    "Voided by Asher"
  );
  assert.equal(voidBannerLead({ day: null, voidedByName: null, reason: "  " }), "Voided");
});
