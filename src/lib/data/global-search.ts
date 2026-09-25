import {
  leadDisplayName,
  moneyCents,
  normalizePhone,
  stageColor,
  type Estimate,
  type Event,
  type Lead,
  type LeadNote,
  type PipelineStageRow,
  type VendorBill,
} from "./types.ts";
import { documentStatusLabel } from "./invoices.ts";

/**
 * The pure half of the topbar's "Search for Anything": given rows the
 * server action already fetched (and was allowed to fetch), decide what
 * matches and how each hit reads. Split from the action so node:test can
 * pin the matching rules -- which fields find a record, and where a hit
 * navigates -- without a database.
 */

export type GlobalHit = {
  id: string;
  name: string;
  sub: string | null;
  badge: string | null;
  color: string;
  href: string;
};

export type GlobalSearchGroup = {
  label: string;
  hits: GlobalHit[];
};

export type SearchableLead = Pick<
  Lead,
  | "id"
  | "contact_type"
  | "company_name"
  | "first_name"
  | "last_name"
  | "phone"
  | "phone2"
  | "phone3"
  | "email"
  | "address"
  | "zip"
  | "second_contact_first_name"
  | "second_contact_last_name"
  | "second_contact_phone"
  | "second_contact_email"
  | "stage"
>;
export type SearchableEstimate = Pick<
  Estimate,
  "id" | "lead_id" | "doc_number" | "title" | "status" | "kind" | "job_address" | "total_cents"
>;
export type SearchableEvent = Pick<
  Event,
  "id" | "title" | "date" | "time" | "event_type" | "status" | "lead_id" | "notes"
>;
export type SearchableBill = Pick<
  VendorBill,
  "id" | "vendor_name" | "reference" | "amount_cents" | "due_date" | "notes" | "voided_at"
>;
export type SearchableNote = Pick<LeadNote, "id" | "lead_id" | "body" | "created_at">;

const PER_GROUP = 5;

// Slate for anything without a stronger opinion; the rest follow the
// traffic-light reading the rest of the app uses for these statuses.
const NEUTRAL = "#64748b";
const DOC_STATUS_COLORS: Record<string, string> = {
  Draft: NEUTRAL,
  Sent: "#2563eb",
  Viewed: "#0891b2",
  Signed: "#16a34a",
  Declined: "#dc2626",
  Expired: "#d97706",
  Void: "#dc2626",
};
const EVENT_STATUS_COLORS: Record<string, string> = {
  Confirmed: "#16a34a",
  Showed: "#16a34a",
  Won: "#16a34a",
  Cancelled: "#dc2626",
  "No-show": "#dc2626",
};

function docKindLabel(kind: string | null | undefined): string | null {
  if (kind === "change_order") return "Change order";
  if (kind === "completion") return "Completion";
  if (kind === "invoice") return "Invoice";
  return null;
}

function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// Stored text is full of whitespace accidents -- doubled, trailing, or
// non-breaking spaces from imports and copy/paste -- that HTML collapses
// when the record renders, so the data looks clean while a contiguous
// substring match fails. Fold every whitespace run to one space, and
// match per word: each typed word must appear somewhere in the folded
// haystack, in any order, across field boundaries. The SQL prefilter
// (migration 0170) applies the same rule -- see DECISIONS #008.
function fold(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** The query as the words both halves of search match on: whitespace
 *  (non-breaking included) folded, lowercased. Empty for a query under
 *  two characters, the same floor buildSearchGroups applies. */
export function searchWords(query: string): string[] {
  const q = fold(query);
  if (q.length < 2) return [];
  return q.split(" ");
}

/**
 * One PostgREST `.or()` filter: this word, as a case-insensitive
 * substring, in any of the columns. For the fallback path the action
 * takes when the global_search SQL function is unavailable -- chaining
 * one of these per word ANDs them, which is the per-word rule above
 * expressed as filters. Values are double-quoted so a comma or
 * parenthesis in the word cannot split the filter, with the quote's own
 * escapes applied after LIKE's, so `%` and `_` stay literal (0141).
 */
export function ilikeAnyColumn(word: string, columns: string[]): string {
  const likeEscaped = word.replace(/[\\%_]/g, (c) => `\\${c}`);
  const quoted = `"%${likeEscaped.replace(/[\\"]/g, (c) => `\\${c}`)}%"`;
  return columns.map((col) => `${col}.ilike.${quoted}`).join(",");
}

function matchesEveryWord(words: string[], fields: (string | null | undefined)[]): boolean {
  // Joined like SQL's concat_ws: empty fields dropped, single spaces,
  // so a query spanning two fields matches here iff it matched there.
  const hay = fold(fields.filter(Boolean).join(" "));
  return words.every((w) => hay.includes(w));
}

// A note can run to paragraphs (AI call notes do); show the part around
// the first matched word, not the first line of a note whose hit is
// buried mid-body.
function noteSnippet(body: string, words: string[]): string {
  const text = body.replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();
  let at = -1;
  let len = 0;
  for (const w of words) {
    const i = lower.indexOf(w);
    if (i >= 0 && (at < 0 || i < at)) {
      at = i;
      len = w.length;
    }
  }
  if (at < 0) return text.slice(0, 80);
  const start = Math.max(0, at - 24);
  const end = Math.min(text.length, at + len + 56);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

export function buildSearchGroups(
  query: string,
  input: {
    leads: SearchableLead[];
    stages: Pick<PipelineStageRow, "name" | "color">[];
    estimates: SearchableEstimate[];
    events: SearchableEvent[];
    bills: SearchableBill[];
    notes: SearchableNote[];
  }
): GlobalSearchGroup[] {
  const words = searchWords(query);
  if (words.length === 0) return [];
  const q = words.join(" ");

  const leadById = new Map(input.leads.map((l) => [l.id, l]));

  // Phone numbers are stored with whatever formatting was typed in, so a
  // plain substring match on the raw text misses e.g. searching digits
  // only ("6263254475") against a stored "(626) 325-4475". Compare
  // normalized digits too, alongside the free-text match.
  const qDigits = q.replace(/\D/g, "");

  // The same fields leads.search_text carries (migration 0170): the
  // display name, every name part (so a Company contact's person is
  // findable), every phone as typed and as bare digits, emails, address
  // and zip. A field the SQL side matches on and this list lacks makes
  // the prefilter return a row this re-filter then drops.
  const contactHits: GlobalHit[] = input.leads
    .filter((l) => {
      const phones = [l.phone, l.phone2, l.phone3, l.second_contact_phone].filter(
        (p): p is string => !!p
      );
      const textMatch = matchesEveryWord(words, [
        leadDisplayName(l),
        l.company_name,
        l.first_name,
        l.last_name,
        l.second_contact_first_name,
        l.second_contact_last_name,
        ...phones,
        ...phones.map((p) => p.replace(/\D/g, "")),
        l.email,
        l.second_contact_email,
        l.address,
        l.zip,
      ]);
      const phoneMatch =
        qDigits.length >= 3 && phones.some((p) => normalizePhone(p).includes(qDigits));
      return textMatch || phoneMatch;
    })
    .slice(0, PER_GROUP)
    .map((l) => ({
      id: l.id,
      name: leadDisplayName(l),
      sub: [l.phone, l.address].filter(Boolean).join(" · ") || null,
      badge: l.stage,
      color: stageColor(input.stages, l.stage),
      href: `/contacts?openLead=${l.id}`,
    }));

  // Client name counts as document text on purpose: typing a customer's
  // name should surface their contract next to their contact card.
  const docHits: GlobalHit[] = input.estimates
    .filter((e) => {
      const client = e.lead_id ? leadById.get(e.lead_id) : undefined;
      return matchesEveryWord(words, [
        e.doc_number,
        e.title,
        e.job_address,
        client ? leadDisplayName(client) : null,
      ]);
    })
    .slice(0, PER_GROUP)
    .map((e) => {
      const client = e.lead_id ? leadById.get(e.lead_id) : undefined;
      const kindLabel = docKindLabel(e.kind);
      return {
        id: e.id,
        name: `${e.doc_number} · ${e.title || "Untitled"}`,
        sub:
          [client ? leadDisplayName(client) : null, e.job_address ?? client?.address ?? null]
            .filter(Boolean)
            .join(" · ") || null,
        badge: kindLabel
          ? `${kindLabel} · ${documentStatusLabel(e.kind, e.status)}`
          : e.status,
        color: DOC_STATUS_COLORS[e.status] ?? NEUTRAL,
        href: `/estimates/${e.id}`,
      };
    });

  const eventHits: GlobalHit[] = input.events
    .filter((ev) => {
      const client = ev.lead_id ? leadById.get(ev.lead_id) : undefined;
      return matchesEveryWord(words, [
        ev.title,
        ev.event_type,
        ev.notes,
        client ? leadDisplayName(client) : null,
      ]);
    })
    .slice(0, PER_GROUP)
    .map((ev) => {
      const client = ev.lead_id ? leadById.get(ev.lead_id) : undefined;
      return {
        id: ev.id,
        name: ev.title || ev.event_type,
        sub:
          [shortDate(ev.date) + (ev.time ? ` ${ev.time.slice(0, 5)}` : ""), client ? leadDisplayName(client) : null]
            .filter(Boolean)
            .join(" · ") || null,
        badge: ev.status,
        color: EVENT_STATUS_COLORS[ev.status] ?? NEUTRAL,
        href: `/calendar?openEvent=${ev.id}`,
      };
    });

  // Body text only, on purpose: a client's name already surfaces the
  // contact itself, so matching notes by client too would just repeat
  // every contact hit. A note whose lead this person cannot see (or that
  // lost its lead) has nowhere to link and no name to show -- skip it.
  const noteHits: GlobalHit[] = input.notes
    .filter((n) => matchesEveryWord(words, [n.body]) && !!leadById.get(n.lead_id))
    .slice(0, PER_GROUP)
    .map((n) => {
      const client = leadById.get(n.lead_id)!;
      return {
        id: n.id,
        name: leadDisplayName(client),
        sub: [noteSnippet(n.body, words), shortDate(n.created_at.slice(0, 10))].join(" · "),
        badge: "Note",
        color: NEUTRAL,
        href: `/contacts?openLead=${n.lead_id}`,
      };
    });

  const billHits: GlobalHit[] = input.bills
    .filter((b) => matchesEveryWord(words, [b.vendor_name, b.reference, b.notes]))
    .slice(0, PER_GROUP)
    .map((b) => ({
      id: b.id,
      name: b.vendor_name || "Bill",
      sub:
        [b.reference, b.due_date ? `due ${shortDate(b.due_date)}` : null].filter(Boolean).join(" · ") ||
        null,
      badge: b.voided_at ? "Void" : moneyCents(b.amount_cents),
      color: b.voided_at ? "#dc2626" : NEUTRAL,
      href: "/bills",
    }));

  return [
    { label: "Contacts", hits: contactHits },
    { label: "Estimates & contracts", hits: docHits },
    { label: "Appointments", hits: eventHits },
    { label: "Notes", hits: noteHits },
    { label: "Bills", hits: billHits },
  ].filter((g) => g.hits.length > 0);
}
