/**
 * Ink: the viewer writing on the sharer's screen during a cobrowse
 * session. Strokes and a laser pointer travel as small signals over
 * the same channel the picture arrives on, in coordinates normalized
 * to the sharer's viewport (0..1), so the drawing lands in the same
 * place whatever size either screen is. Both sides fold signals into
 * this state and paint it; strokes hold for a few seconds, fade, and
 * are gone -- ink is a gesture, not a document.
 *
 * Signals come from another client, so everything here is defensive:
 * malformed input is dropped, coordinates are clamped, and growth is
 * capped. Pure data-in/data-out, so it runs under node --test.
 */

/** A stroke stays fully visible this long after its last update... */
export const STROKE_FADE_START_MS = 6000;
/** ...then fades to nothing by here and is pruned. */
export const STROKE_FADE_END_MS = 8000;
/** The laser pointer vanishes when it stops moving. */
export const POINTER_TTL_MS = 2000;
/** Growth caps: a runaway (or hostile) peer can't grow memory. */
export const MAX_STROKES = 64;
export const MAX_POINTS = 600;

export type InkPoint = { x: number; y: number };

export type InkSignal =
  | { kind: "stroke"; id: string; points: InkPoint[] }
  | { kind: "pointer"; x: number; y: number }
  | { kind: "pointer-hide" }
  | { kind: "clear" };

export type InkStroke = { id: string; points: InkPoint[]; at: number };

export type InkState = {
  strokes: InkStroke[];
  pointer: { x: number; y: number; at: number } | null;
};

export const emptyInk = (): InkState => ({ strokes: [], pointer: null });

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Keep finite points, clamped to the unit square; drop the rest. */
function cleanPoints(points: unknown): InkPoint[] | null {
  if (!Array.isArray(points)) return null;
  const out: InkPoint[] = [];
  for (const p of points) {
    if (out.length >= MAX_POINTS) break;
    const x = (p as InkPoint)?.x;
    const y = (p as InkPoint)?.y;
    if (typeof x !== "number" || typeof y !== "number" || !isFinite(x) || !isFinite(y)) continue;
    out.push({ x: clamp01(x), y: clamp01(y) });
  }
  return out.length ? out : null;
}

/**
 * Fold one signal in. A stroke updates in place under its id -- the
 * sender streams the same stroke as it grows -- and each touch
 * restarts its fade clock, so ink never dissolves mid-gesture.
 */
export function inkReduce(state: InkState, signal: InkSignal, now: number): InkState {
  const kind = (signal as { kind?: unknown })?.kind;
  if (kind === "clear") return emptyInk();
  if (kind === "pointer-hide") {
    return state.pointer ? { ...state, pointer: null } : state;
  }
  if (kind === "pointer") {
    const { x, y } = signal as { x?: unknown; y?: unknown };
    if (typeof x !== "number" || typeof y !== "number" || !isFinite(x) || !isFinite(y)) return state;
    return { ...state, pointer: { x: clamp01(x), y: clamp01(y), at: now } };
  }
  if (kind === "stroke") {
    const { id } = signal as { id?: unknown };
    if (typeof id !== "string") return state;
    const points = cleanPoints((signal as { points?: unknown }).points);
    if (!points) return state;
    const next: InkStroke = { id, points, at: now };
    const others = state.strokes.filter((s) => s.id !== id);
    others.push(next);
    // oldest-first eviction keeps what the viewer drew most recently
    return { ...state, strokes: others.slice(Math.max(0, others.length - MAX_STROKES)) };
  }
  return state;
}

/** 1 while holding, sliding to 0 across the fade window. */
export function strokeAlpha(ageMs: number): number {
  if (ageMs <= STROKE_FADE_START_MS) return 1;
  if (ageMs >= STROKE_FADE_END_MS) return 0;
  return 1 - (ageMs - STROKE_FADE_START_MS) / (STROKE_FADE_END_MS - STROKE_FADE_START_MS);
}

/** Drop what has finished fading; called from the render loop. */
export function pruneInk(state: InkState, now: number): InkState {
  const strokes = state.strokes.filter((s) => now - s.at < STROKE_FADE_END_MS);
  const pointer = state.pointer && now - state.pointer.at < POINTER_TTL_MS ? state.pointer : null;
  if (strokes.length === state.strokes.length && pointer === state.pointer) return state;
  return { strokes, pointer };
}

/** Where on a canvas the mirrored viewport sits, in canvas pixels. */
export type InkRect = { x: number; y: number; w: number; h: number };

/**
 * Paint the state onto a canvas: marker strokes with their fade, and
 * the pointer as a dot in a soft ring. The same painter runs on both
 * sides -- the sharer's full-viewport overlay and the viewer's overlay
 * on the scaled mirror -- so what one draws is exactly what the other
 * sees; only the rect differs.
 */
export function renderInk(ctx: CanvasRenderingContext2D, state: InkState, rect: InkRect, now: number): void {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // marker width follows the mirror's size but stays visible when small
  ctx.lineWidth = Math.max(3, rect.w / 300);
  for (const s of state.strokes) {
    const alpha = strokeAlpha(now - s.at);
    if (alpha <= 0) continue;
    ctx.strokeStyle = `rgba(224, 49, 39, ${alpha})`;
    ctx.beginPath();
    for (let i = 0; i < s.points.length; i++) {
      const px = rect.x + s.points[i].x * rect.w;
      const py = rect.y + s.points[i].y * rect.h;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    if (s.points.length === 1) {
      // a tap still lands as a visible dot
      ctx.lineTo(rect.x + s.points[0].x * rect.w + 0.1, rect.y + s.points[0].y * rect.h);
    }
    ctx.stroke();
  }
  const p = state.pointer;
  if (p && now - p.at < POINTER_TTL_MS) {
    const px = rect.x + p.x * rect.w;
    const py = rect.y + p.y * rect.h;
    ctx.fillStyle = "rgba(224, 49, 39, 0.25)";
    ctx.beginPath();
    ctx.arc(px, py, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(224, 49, 39, 0.95)";
    ctx.beginPath();
    ctx.arc(px, py, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}
