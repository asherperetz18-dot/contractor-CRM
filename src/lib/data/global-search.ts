import {
  leadDisplayName,
  moneyCents,
  normalizePhone,
  stageColor,
  type Estimate,
  type Event,
  type Lead,
  type PipelineStageRow,
  type VendorBill,
} from "./types.ts";

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
  "id" | "contact_type" | "company_name" | "first_name" | "last_name" | "phone" | "email" | "address" | "stage"
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
  return null;
}

function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function buildSearchGroups(
  query: string,
  input: {
    leads: SearchableLead[];
    stages: Pick<PipelineStageRow, "name" | "color">[];
    estimates: SearchableEstimate[];
    events: SearchableEvent[];
    bills: SearchableBill[];
  }
): GlobalSearchGroup[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const leadById = new Map(input.leads.map((l) => [l.id, l]));

  // Phone numbers are stored with whatever formatting was typed in, so a
  // plain substring match on the raw text misses e.g. searching digits
  // only ("6263254475") against a stored "(626) 325-4475". Compare
  // normalized digits too, alongside the free-text match.
  const qDigits = q.replace(/\D/g, "");

  const contactHits: GlobalHit[] = input.leads
    .filter((l) => {
      const textMatch = `${leadDisplayName(l)} ${l.phone ?? ""} ${l.address ?? ""} ${l.email ?? ""}`
        .toLowerCase()
        .includes(q);
      const phoneMatch = qDigits.length >= 3 && !!l.phone && normalizePhone(l.phone).includes(qDigits);
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
      return `${e.doc_number} ${e.title ?? ""} ${e.job_address ?? ""} ${client ? leadDisplayName(client) : ""}`
        .toLowerCase()
        .includes(q);
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
        badge: kindLabel ? `${kindLabel} · ${e.status}` : e.status,
        color: DOC_STATUS_COLORS[e.status] ?? NEUTRAL,
        href: `/estimates/${e.id}`,
      };
    });

  const eventHits: GlobalHit[] = input.events
    .filter((ev) => {
      const client = ev.lead_id ? leadById.get(ev.lead_id) : undefined;
      return `${ev.title ?? ""} ${ev.event_type} ${ev.notes ?? ""} ${client ? leadDisplayName(client) : ""}`
        .toLowerCase()
        .includes(q);
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

  const billHits: GlobalHit[] = input.bills
    .filter((b) =>
      `${b.vendor_name ?? ""} ${b.reference ?? ""} ${b.notes ?? ""}`.toLowerCase().includes(q)
    )
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
    { label: "Bills", hits: billHits },
  ].filter((g) => g.hits.length > 0);
}
