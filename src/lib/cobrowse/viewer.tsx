"use client";

/**
 * The watching half of cobrowse: batches of rrweb events arrive from
 * the engine's Realtime channel and play into a live Replayer. The
 * replayed page renders inside rrweb's own sandboxed iframe -- it is a
 * picture of the sharer's DOM, not a logged-in surface of its own, so
 * nothing in it can act as the viewer.
 *
 * rrweb itself is imported only here and only on demand, so watching a
 * teammate is the first moment the library is ever downloaded.
 */

import { useEffect, useRef } from "react";
import type { eventWithTime, Replayer } from "rrweb";
import "rrweb/dist/style.css";

// rrweb EventType values, named locally instead of importing the enum:
// a value import of rrweb here would pull the whole library into the
// layout bundle that every page loads.
const META = 4;
const FULL_SNAPSHOT = 2;

/** startLive baseline sits slightly in the past to absorb network jitter. */
const LIVE_LAG_MS = 400;

export function CobrowseViewer({
  attach,
}: {
  /** The engine hands us its feed hook: we give it a callback for each
   * arriving batch; the cleanup it returns detaches on unmount. */
  attach: (feed: (events: eventWithTime[]) => void) => () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let replayer: Replayer | null = null;
    let pending: eventWithTime[] = [];
    let dead = false;

    // Fit the sharer's viewport into whatever box the viewer has --
    // an iPhone's tall portrait DOM inside an office monitor, or the
    // reverse. Down-scale only; a small screen is shown at 1:1.
    const rescale = () => {
      if (!replayer) return;
      const w = replayer.iframe.offsetWidth;
      const h = replayer.iframe.offsetHeight;
      if (!w || !h) return;
      const scale = Math.min(container.clientWidth / w, container.clientHeight / h, 1);
      const wrap = replayer.wrapper;
      wrap.style.transform = `scale(${scale})`;
      wrap.style.transformOrigin = "top left";
      wrap.style.position = "absolute";
      wrap.style.top = "0";
      wrap.style.left = `${Math.max(0, (container.clientWidth - w * scale) / 2)}px`;
    };
    const ro = new ResizeObserver(rescale);
    ro.observe(container);

    // rrweb loads once, on the first batch; until it and a snapshot
    // are both here, batches pool in `pending`.
    let mod: typeof import("rrweb") | null = null;
    let loading = false;

    const tryStart = () => {
      if (dead || replayer || !mod) return;
      // The first watchable moment is a Meta (viewport size) followed
      // by a FullSnapshot -- exactly what the sharer emits when our
      // hello triggers a checkout. Anything earlier is noise from a
      // stream we joined mid-sentence.
      const snapAt = pending.findIndex((e) => e.type === FULL_SNAPSHOT);
      if (snapAt < 1) return;
      let metaAt = -1;
      for (let i = snapAt - 1; i >= 0; i--) {
        if (pending[i].type === META) {
          metaAt = i;
          break;
        }
      }
      if (metaAt < 0) return;
      const initial = [pending[metaAt], ...pending.slice(snapAt)];
      pending = [];
      replayer = new mod.Replayer(initial, {
        root: container,
        liveMode: true,
        mouseTail: false,
        showWarning: false,
      });
      replayer.on("resize", rescale);
      replayer.startLive(initial[0].timestamp - LIVE_LAG_MS);
      rescale();
    };

    const feed = (events: eventWithTime[]) => {
      if (dead) return;
      if (replayer) {
        for (const e of events) replayer.addEvent(e);
        return;
      }
      pending.push(...events);
      if (!mod && !loading) {
        loading = true;
        void import("rrweb").then((m) => {
          mod = m;
          tryStart();
        });
      } else {
        tryStart();
      }
    };

    const detach = attach(feed);
    return () => {
      dead = true;
      detach();
      ro.disconnect();
      replayer?.destroy();
      replayer = null;
    };
  }, [attach]);

  return <div ref={containerRef} className="cb-stage" />;
}
