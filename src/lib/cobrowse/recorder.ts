"use client";

/**
 * The sharer's half of cobrowse: rrweb watches this tab's DOM and
 * emits events, which are batched on a short timer and handed to the
 * caller for the wire. Loading rrweb is deferred to the moment someone
 * actually shares, so the library never weighs down a normal page
 * visit.
 *
 * What leaves the device is the CRM tab's DOM only -- never the rest
 * of the screen, other apps, or notifications -- and password fields
 * go out masked. That containment is the point of cobrowse next to
 * full screen share.
 */

import type { eventWithTime } from "rrweb";

/** How long emitted events pool before a flush. Short enough to feel
 * live, long enough to coalesce a burst of mutations into one batch. */
const FLUSH_MS = 250;

export type CobrowseRecorder = {
  /** Re-send the whole picture -- called when a viewer (re)joins. */
  snapshot: () => void;
  stop: () => void;
};

export async function startCobrowseRecorder(
  send: (events: eventWithTime[]) => void
): Promise<CobrowseRecorder | null> {
  const { record, takeFullSnapshot } = await import("rrweb");

  let buffer: eventWithTime[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const flush = () => {
    timer = null;
    if (stopped || !buffer.length) return;
    const batch = buffer;
    buffer = [];
    send(batch);
  };

  const stopRecord = record({
    emit: (event) => {
      if (stopped) return;
      buffer.push(event);
      if (!timer) timer = setTimeout(flush, FLUSH_MS);
    },
    // Anything marked rr-block renders as a placeholder box for the
    // viewer instead of its contents.
    blockClass: "rr-block",
    maskInputOptions: { password: true },
    inlineStylesheet: true,
    // Mousemove/scroll/input firehoses are sampled down -- the viewer
    // needs to follow along, not forensically replay every pixel.
    sampling: { mousemove: 60, scroll: 120, input: "last", media: 800 },
  });
  if (!stopRecord) return null;

  return {
    snapshot: () => {
      if (stopped) return;
      // isCheckout marks a fresh baseline: everything before it is
      // irrelevant to a viewer who starts here.
      takeFullSnapshot(true);
    },
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      buffer = [];
      stopRecord();
    },
  };
}
