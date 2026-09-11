"use client";

/**
 * The sharer's half of ink: while their CRM view is being cobrowsed, a
 * click-dead canvas floats over the whole app and paints whatever the
 * watching teammate draws -- circles, arrows, the laser dot -- fading
 * out on the shared clock in src/lib/cobrowse/ink.ts. It never takes a
 * pointer event, so nothing about using the CRM changes underneath it.
 */

import { useEffect, useRef } from "react";
import { emptyInk, inkReduce, pruneInk, renderInk, type InkSignal, type InkState } from "@/lib/cobrowse/ink";

export function SharerInkOverlay({
  attach,
}: {
  /** The engine hands us its ink hook: we give it a callback for each
   * arriving signal; the cleanup it returns detaches on unmount. */
  attach: (feed: (signal: InkSignal) => void) => () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let state: InkState = emptyInk();
    let raf = 0;

    const detach = attach((signal) => {
      state = inkReduce(state, signal, Date.now());
    });

    const fit = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    fit();
    window.addEventListener("resize", fit);

    const loop = () => {
      const now = Date.now();
      state = pruneInk(state, now);
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        renderInk(ctx, state, { x: 0, y: 0, w: canvas.width, h: canvas.height }, now);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      detach();
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", fit);
    };
  }, [attach]);

  return <canvas ref={canvasRef} className="cb-ink-overlay" aria-hidden="true" />;
}
