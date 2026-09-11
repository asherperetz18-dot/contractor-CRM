"use client";

/**
 * The watching half of cobrowse: batches of rrweb events arrive from
 * the engine's Realtime channel and play into a live Replayer. The
 * replayed page renders inside rrweb's own sandboxed iframe -- it is a
 * picture of the sharer's DOM, not a logged-in surface of its own, so
 * nothing in it can act as the viewer.
 *
 * The viewer can also write ON the picture: a marker and a laser
 * pointer whose strokes go back over the channel in viewport-relative
 * coordinates and land, fading, on the sharer's screen
 * (src/lib/cobrowse/ink.ts). Drawing here is annotation only -- it
 * never clicks anything in the sharer's CRM.
 *
 * rrweb itself is imported only here and only on demand, so watching a
 * teammate is the first moment the library is ever downloaded.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { eventWithTime, Replayer } from "rrweb";
import {
  emptyInk,
  inkReduce,
  pruneInk,
  renderInk,
  type InkSignal,
  type InkState,
} from "@/lib/cobrowse/ink";
import "rrweb/dist/style.css";

// rrweb EventType values, named locally instead of importing the enum:
// a value import of rrweb here would pull the whole library into the
// layout bundle that every page loads.
const META = 4;
const FULL_SNAPSHOT = 2;

/** startLive baseline sits slightly in the past to absorb network jitter. */
const LIVE_LAG_MS = 400;

/** How often a stroke-in-progress re-sends itself while drawing. */
const STROKE_SEND_MS = 100;
/** Laser pointer send throttle. */
const POINTER_SEND_MS = 50;

type InkTool = "off" | "draw" | "point";

/** Where the scaled mirror sits inside the stage, in stage pixels. */
type MirrorGeom = { left: number; top: number; w: number; h: number };

export function CobrowseViewer({
  attach,
  sendInk,
}: {
  /** The engine hands us its feed hook: we give it a callback for each
   * arriving batch; the cleanup it returns detaches on unmount. */
  attach: (feed: (events: eventWithTime[]) => void) => () => void;
  /** Ships one ink signal to the sharer over the session channel. */
  sendInk?: (signal: InkSignal) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inkCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [tool, setTool] = useState<InkTool>("off");

  // Local echo of the ink so the drawing hand sees its line instantly;
  // the sharer's copy is built from the same signals on their side.
  const inkRef = useRef<InkState>(emptyInk());
  const geomRef = useRef<MirrorGeom | null>(null);

  const applyInk = useCallback(
    (signal: InkSignal) => {
      inkRef.current = inkReduce(inkRef.current, signal, Date.now());
      sendInk?.(signal);
    },
    [sendInk]
  );

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
      const left = Math.max(0, (container.clientWidth - w * scale) / 2);
      const wrap = replayer.wrapper;
      wrap.style.transform = `scale(${scale})`;
      wrap.style.transformOrigin = "top left";
      wrap.style.position = "absolute";
      wrap.style.top = "0";
      wrap.style.left = `${left}px`;
      // the ink layer draws (and reads input) in exactly this box
      geomRef.current = { left, top: 0, w: w * scale, h: h * scale };
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
        import("rrweb")
          .then((m) => {
            mod = m;
            tryStart();
          })
          .catch(() => {
            // chunk load failed; clearing the latch lets the next
            // arriving batch retry instead of blacking out for good
            loading = false;
          });
      } else {
        tryStart();
      }
    };

    // the ink layer, painted over the mirror on every frame
    const canvas = inkCanvasRef.current;
    let raf = 0;
    const loop = () => {
      if (canvas) {
        if (canvas.width !== container.clientWidth || canvas.height !== container.clientHeight) {
          canvas.width = container.clientWidth;
          canvas.height = container.clientHeight;
        }
        const ctx = canvas.getContext("2d");
        const geom = geomRef.current;
        if (ctx) {
          const now = Date.now();
          inkRef.current = pruneInk(inkRef.current, now);
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          if (geom) renderInk(ctx, inkRef.current, { x: geom.left, y: geom.top, w: geom.w, h: geom.h }, now);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const detach = attach(feed);
    return () => {
      dead = true;
      detach();
      ro.disconnect();
      cancelAnimationFrame(raf);
      replayer?.destroy();
      replayer = null;
    };
  }, [attach]);

  // ── ink input: the viewer's hand ────────────────────────────────
  const strokeRef = useRef<{ id: string; points: { x: number; y: number }[] } | null>(null);
  const lastSend = useRef(0);

  const toNorm = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const geom = geomRef.current;
    if (!geom || !geom.w || !geom.h) return null;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left - geom.left) / geom.w;
    const y = (e.clientY - rect.top - geom.top) / geom.h;
    return { x: Math.min(Math.max(x, 0), 1), y: Math.min(Math.max(y, 0), 1) };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (tool !== "draw") return;
    const p = toNorm(e);
    if (!p) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    strokeRef.current = { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, points: [p] };
    lastSend.current = 0;
    applyInk({ kind: "stroke", ...strokeRef.current });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const t = tool;
    const p = toNorm(e);
    if (!p) return;
    if (t === "point") {
      const now = Date.now();
      if (now - lastSend.current < POINTER_SEND_MS) return;
      lastSend.current = now;
      applyInk({ kind: "pointer", ...p });
      return;
    }
    const stroke = strokeRef.current;
    if (t !== "draw" || !stroke) return;
    stroke.points.push(p);
    // stream the growing stroke: the same id replaces itself over there
    const now = Date.now();
    if (now - lastSend.current >= STROKE_SEND_MS) {
      lastSend.current = now;
      applyInk({ kind: "stroke", id: stroke.id, points: stroke.points });
    } else {
      // still echo locally every move so the line follows the hand
      inkRef.current = inkReduce(inkRef.current, { kind: "stroke", id: stroke.id, points: stroke.points }, now);
    }
  };

  const endStroke = () => {
    const stroke = strokeRef.current;
    strokeRef.current = null;
    if (stroke) applyInk({ kind: "stroke", id: stroke.id, points: stroke.points });
  };

  const onPointerUp = () => {
    if (tool === "draw") endStroke();
    else if (tool === "point") applyInk({ kind: "pointer-hide" });
  };

  const pickTool = (next: InkTool) => {
    endStroke();
    if (tool === "point") applyInk({ kind: "pointer-hide" });
    setTool((t) => (t === next ? "off" : next));
  };

  return (
    <div ref={containerRef} className="cb-stage">
      <canvas
        ref={inkCanvasRef}
        className="cb-ink"
        style={{ pointerEvents: tool === "off" ? "none" : "auto", touchAction: tool === "off" ? undefined : "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      />
      {sendInk && (
        <div className="cb-tools">
          <button
            type="button"
            className={"btn-ghost small" + (tool === "draw" ? " cb-tool-active" : "")}
            aria-pressed={tool === "draw"}
            title="Draw on their screen — it fades after a few seconds"
            onClick={() => pickTool("draw")}
          >
            ✏️ Draw
          </button>
          <button
            type="button"
            className={"btn-ghost small" + (tool === "point" ? " cb-tool-active" : "")}
            aria-pressed={tool === "point"}
            title="Point at things on their screen"
            onClick={() => pickTool("point")}
          >
            👉 Point
          </button>
          <button
            type="button"
            className="btn-ghost small"
            title="Wipe your drawings off their screen now"
            onClick={() => applyInk({ kind: "clear" })}
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
