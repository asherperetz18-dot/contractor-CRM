/**
 * Chunked transport for cobrowse (rrweb) event batches over Supabase
 * Realtime broadcast. A full DOM snapshot of a busy CRM page is far
 * bigger than a single Realtime payload, so a batch is stringified
 * once and shipped as numbered parts; the viewer rebuilds it when the
 * last part lands. Pure data-in/data-out -- the recording and replay
 * live elsewhere -- so it runs under node --test.
 */

/** Realtime rejects oversized broadcasts; stay well inside the limit. */
export const CHUNK_CHARS = 50_000;

export type CobrowsePart = {
  /** batch number, one per flush on the sharer */
  seq: number;
  /** this part's index within the batch */
  part: number;
  /** how many parts the batch was split into */
  parts: number;
  /** a slice of the batch's JSON */
  data: string;
};

/** Split one batch of rrweb events into broadcast-sized parts. */
export function packEvents(
  events: readonly unknown[],
  seq: number,
  chunkChars: number = CHUNK_CHARS
): CobrowsePart[] {
  const json = JSON.stringify(events);
  const parts = Math.max(1, Math.ceil(json.length / chunkChars));
  const out: CobrowsePart[] = [];
  for (let i = 0; i < parts; i++) {
    out.push({ seq, part: i, parts, data: json.slice(i * chunkChars, (i + 1) * chunkChars) });
  }
  return out;
}

/** A viewer joining mid-batch leaves stragglers that can never finish;
 * cap how many we keep so a lossy (or hostile) stream can't grow memory. */
const MAX_PENDING = 32;

/**
 * Rebuilds batches from parts on the viewer. Parts may arrive out of
 * order or twice; anything malformed is swallowed, never thrown -- a
 * bad frame just isn't a picture yet.
 */
export class Reassembler {
  private pending = new Map<number, { parts: (string | undefined)[]; got: number }>();

  get pendingCount(): number {
    return this.pending.size;
  }

  /** Returns the batch's events when this part completes it, else null. */
  push(p: CobrowsePart): unknown[] | null {
    if (
      !Number.isInteger(p.part) ||
      !Number.isInteger(p.parts) ||
      p.parts < 1 ||
      p.part < 0 ||
      p.part >= p.parts ||
      typeof p.data !== "string"
    ) {
      return null;
    }

    let entry = this.pending.get(p.seq);
    if (!entry) {
      entry = { parts: new Array<string | undefined>(p.parts), got: 0 };
      this.pending.set(p.seq, entry);
      // Oldest-inserted goes first: it has waited longest for a part
      // that evidently isn't coming.
      if (this.pending.size > MAX_PENDING) {
        const oldest = this.pending.keys().next().value;
        if (oldest !== undefined) this.pending.delete(oldest);
      }
    }
    if (entry.parts.length !== p.parts || entry.parts[p.part] !== undefined) return null;
    entry.parts[p.part] = p.data;
    entry.got++;
    if (entry.got < entry.parts.length) return null;

    this.pending.delete(p.seq);
    try {
      const events = JSON.parse(entry.parts.join(""));
      return Array.isArray(events) ? events : null;
    } catch {
      return null;
    }
  }
}
