import { test } from "node:test";
import assert from "node:assert/strict";
import { chipMatches } from "./project-filters.ts";
import type { ProjectCard } from "./projects-view";

/**
 * The "New this month" chip exists so the stat card of the same name is
 * clickable -- the card counts jobs signed this calendar month, and the
 * chip must select exactly those, or the card says 8 and the click
 * shows some other list.
 */

const card = (over: Partial<ProjectCard>): ProjectCard =>
  ({
    status: "in_progress",
    signedAt: null,
    rollup: { netCashCents: 0, receivableCents: 0 },
    ...over,
  }) as ProjectCard;

const NOW = new Date("2026-09-17T12:00:00");

test("NewMonth keeps only jobs signed this calendar month", () => {
  assert.equal(chipMatches(card({ signedAt: "2026-09-02T10:00:00Z" }), "NewMonth", NOW), true);
  assert.equal(chipMatches(card({ signedAt: "2026-08-31T10:00:00Z" }), "NewMonth", NOW), false);
  assert.equal(chipMatches(card({ signedAt: "2025-09-10T10:00:00Z" }), "NewMonth", NOW), false);
  assert.equal(chipMatches(card({ signedAt: null }), "NewMonth", NOW), false);
});

test("a cancelled contract is never new business, same as the card's count", () => {
  assert.equal(
    chipMatches(card({ signedAt: "2026-09-02T10:00:00Z", status: "cancelled" }), "NewMonth", NOW),
    false
  );
});
