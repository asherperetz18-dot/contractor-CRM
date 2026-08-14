"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A drawn e-signature, captured with the Pointer Events API so the same
 * handlers cover mouse, touch and stylus without separate touch listeners.
 *
 * Renders at the canvas's on-screen size times devicePixelRatio, so a
 * signature drawn on a retina phone isn't a blurry upscale later. Sized
 * once on mount rather than tracked with a ResizeObserver -- this pad only
 * ever appears already at its final size, inside a tab that mounts when
 * chosen rather than one that's merely hidden and resized under it.
 */
export function SignaturePad({
  onChange,
  height = 160,
}: {
  /** The drawn mark as a PNG data URL, or null once cleared / while empty. */
  onChange: (dataUrl: string | null) => void;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const hasStroke = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.25;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1a1a1a";
  }, []);

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    canvas?.setPointerCapture(e.pointerId);
    drawing.current = true;
    const p = pos(e);
    last.current = p;
    // A tap with no drag -- a dot, or the period at the end of a signature
    // -- would otherwise never reach move() and register as nothing at
    // all. Drawing a filled dot right away means even a single tap counts.
    if (ctx) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fill();
    }
    if (!hasStroke.current) {
      hasStroke.current = true;
      setEmpty(false);
    }
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !last.current) return;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    if (!hasStroke.current) {
      hasStroke.current = true;
      setEmpty(false);
    }
  }

  function end(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    e.preventDefault();
    drawing.current = false;
    last.current = null;
    onChange(hasStroke.current ? (canvasRef.current?.toDataURL("image/png") ?? null) : null);
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasStroke.current = false;
    setEmpty(true);
    onChange(null);
  }

  return (
    <div className="sig-pad">
      <canvas
        ref={canvasRef}
        className="sig-pad-canvas"
        style={{ height }}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />
      <div className="sig-pad-footer">
        <span className="sig-pad-hint">{empty ? "Draw your signature above" : "Looks good"}</span>
        <button type="button" className="btn-ghost small" onClick={clear} disabled={empty}>
          Clear
        </button>
      </div>
    </div>
  );
}
