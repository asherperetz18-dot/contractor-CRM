import { normalizePhone } from "./data/types.ts";

/**
 * What the report pages need from the contact book, made precise. They
 * used to ship every lead to the browser to print names next to their
 * rows; now the server fetches only the leads the rows reference --
 * by id, or (for a text that was never linked to a lead) by the
 * counterparty's phone. See DECISIONS #021.
 */

/**
 * The normalized phone keys an SMS list needs leads looked up for: the
 * counterparty side of every message that carries no lead_id. Same
 * derivation the Reply Inbox and Text Reports views use to match a
 * conversation to a saved contact.
 */
export function counterpartyPhoneKeys(
  messages: { lead_id: string | null; direction: string; from_number: string; to_number: string }[]
): Set<string> {
  const keys = new Set<string>();
  for (const m of messages) {
    if (m.lead_id) continue;
    const phone = m.direction === "inbound" ? m.from_number : m.to_number;
    const key = normalizePhone(phone);
    if (key) keys.add(key);
  }
  return keys;
}

export type RepLeadStats = {
  assignedCount: number;
  openCount: number;
  wonCount: number;
  wonValue: number;
};

/**
 * The Salespeople grid's per-rep tallies, from a slim scan
 * (assigned_to, stage, value) -- the same buckets the grid computed
 * from full rows in the browser.
 */
/** One row per rep from the rep_lead_stats SQL function (0156) --
 *  Postgres aggregates can arrive as strings through JSON, so every
 *  figure is coerced here, in one place. */
export type RepLeadStatsRow = {
  assigned_to: string;
  assigned_count: number | string;
  open_count: number | string;
  won_count: number | string;
  won_value: number | string;
};

/**
 * The same tallies repLeadStats builds from a scan, taken instead from
 * the grouped rows the database already reduced -- so the page reads
 * one row per rep, not one per lead. The two must bucket identically;
 * the buckets live in the SQL (migration 0156) and are pinned by the
 * tests beside this file.
 */
export function repLeadStatsFromRows(rows: RepLeadStatsRow[]): Map<string, RepLeadStats> {
  return new Map(
    rows.map((r) => [
      r.assigned_to,
      {
        assignedCount: Number(r.assigned_count) || 0,
        openCount: Number(r.open_count) || 0,
        wonCount: Number(r.won_count) || 0,
        wonValue: Number(r.won_value) || 0,
      },
    ])
  );
}

export function repLeadStats(
  slim: {
    assigned_to: string | null;
    /** The second rep on a partnership job (0163). The lead lands in
     *  both books and both get the Won notch, but the value splits half
     *  and half -- one sale's money, never doubled on the grid. */
    partner_rep_id?: string | null;
    stage: string;
    value: number;
  }[]
): Map<string, RepLeadStats> {
  const map = new Map<string, RepLeadStats>();
  const credit = (repId: string, l: { stage: string; value: number }, valueShare: number) => {
    const row = map.get(repId) ?? { assignedCount: 0, openCount: 0, wonCount: 0, wonValue: 0 };
    row.assignedCount += 1;
    if (!["Won", "Lost", "DNC"].includes(l.stage)) row.openCount += 1;
    if (l.stage === "Won") {
      row.wonCount += 1;
      row.wonValue += (Number(l.value) || 0) * valueShare;
    }
    map.set(repId, row);
  };
  for (const l of slim) {
    // Guarded even though the pickers forbid it: the same person in
    // both seats is one rep and one sale, not two.
    const partner = l.partner_rep_id && l.partner_rep_id !== l.assigned_to ? l.partner_rep_id : null;
    const share = partner ? 0.5 : 1;
    if (l.assigned_to) credit(l.assigned_to, l, share);
    if (partner) credit(partner, l, 0.5);
  }
  return map;
}
