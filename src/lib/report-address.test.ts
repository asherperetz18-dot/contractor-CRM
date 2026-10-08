import { test } from "node:test";
import assert from "node:assert/strict";
import { requestsAddress } from "./report-address.ts";

/**
 * A report whose period rides in the address (the Schedule, Text Reports,
 * Appointment Reports) keeps the period being picked in state and asks
 * the router for it; it follows an address it never asked for (a link,
 * such as a Daily Brief tile tapped over the open report). These replay
 * the view's two rules against a router that, like Next's, drops an
 * older request the moment a newer one is sent.
 */

type View = {
  wanted: string;
  loaded: string;
  seen: string;
  sent: string;
  lastLoaded: string;
  onTheWay: string | null;
  asks: string[];
};

function start(qs: string): View {
  return { wanted: qs, loaded: qs, seen: qs, sent: qs, lastLoaded: qs, onTheWay: null, asks: [] };
}

// The view's effect: ask for the wanted address if the rule says so.
function effect(v: View): View {
  const ask = requestsAddress({
    wanted: v.wanted,
    loaded: v.loaded,
    sent: v.sent,
    pending: v.onTheWay !== null,
    followed: v.loaded !== v.lastLoaded,
  });
  return {
    ...v,
    sent: v.wanted,
    lastLoaded: v.loaded,
    onTheWay: ask ? v.wanted : v.onTheWay,
    asks: ask ? [...v.asks, v.wanted] : v.asks,
  };
}

// The view's render: follow an address it didn't ask for.
function render(v: View): View {
  if (v.seen === v.loaded) return v;
  return { ...v, seen: v.loaded, wanted: v.loaded !== v.wanted ? v.loaded : v.wanted };
}

const pick = (v: View, qs: string) => effect({ ...v, wanted: qs });
const lands = (v: View) => (v.onTheWay === null ? v : effect(render({ ...v, loaded: v.onTheWay, onTheWay: null })));
// A link is a newer navigation: the router drops whatever this view had on the way.
const link = (v: View, qs: string) => effect(render({ ...v, loaded: qs, onTheWay: null }));
// Back or Forward lands outside the view's transition: the router drops
// its request, but the view still reads it as on the way until it settles.
const back = (v: View, qs: string) => effect(render({ ...v, loaded: qs }));

test("picking a period asks for it once, and its arrival is not mistaken for a link", () => {
  let v = pick(start(""), "?range=7");
  assert.equal(v.onTheWay, "?range=7");
  v = lands(v);
  assert.deepEqual([v.wanted, v.loaded, v.onTheWay], ["?range=7", "?range=7", null]);
});

test("going back to the loaded period while another is on its way stays there", () => {
  // Last 30 Days loaded; click Last 7 Days, then Last 30 Days again
  // before the 7 days arrive. The second request is what makes the
  // router drop the first -- without it, the 7 days landed and were
  // taken for a link, ending on the period just backed out of.
  let v = pick(start(""), "?range=7");
  v = pick(v, "");
  assert.equal(v.onTheWay, "");
  v = lands(v);
  assert.deepEqual([v.wanted, v.loaded, v.onTheWay], ["", "", null]);
});

test("a link that arrives while the report is open is followed, without loading it twice", () => {
  let v = link(start(""), "?from=2026-10-05&to=2026-10-08");
  assert.deepEqual([v.wanted, v.loaded, v.onTheWay], ["?from=2026-10-05&to=2026-10-08", "?from=2026-10-05&to=2026-10-08", null]);
  // Even over a pick of the view's own that hadn't arrived yet.
  v = link(pick(start(""), "?range=90"), "?range=7");
  assert.deepEqual([v.wanted, v.loaded, v.onTheWay], ["?range=7", "?range=7", null]);
});

test("Back while the report's own request is on its way follows, without loading the page again", () => {
  // Opened from the brief, then Last 7 Days picked and Back pressed before
  // it loaded: the restored address is followed, and nothing more is
  // asked -- it used to ask for the very address just restored.
  let v = link(start(""), "?from=2026-10-05&to=2026-10-08");
  v = pick(v, "?range=7");
  v = back(v, "");
  assert.equal(v.wanted, "");
  assert.deepEqual(v.asks, ["?range=7"]);
});

test("nothing is asked for while the period already loaded is the one wanted", () => {
  const settled = { pending: false, followed: false };
  assert.equal(requestsAddress({ wanted: "", loaded: "", sent: "", ...settled }), false);
  assert.equal(requestsAddress({ wanted: "?range=7", loaded: "", sent: "?range=7", pending: true, followed: false }), false);
});
