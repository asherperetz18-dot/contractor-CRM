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
export function repLeadStats(
  slim: { assigned_to: string | null; stage: string; value: number }[]
): Map<string, RepLeadStats> {
  const map = new Map<string, RepLeadStats>();
  for (const l of slim) {
    if (!l.assigned_to) continue;
    const row = map.get(l.assigned_to) ?? { assignedCount: 0, openCount: 0, wonCount: 0, wonValue: 0 };
    row.assignedCount += 1;
    if (!["Won", "Lost", "DNC"].includes(l.stage)) row.openCount += 1;
    if (l.stage === "Won") {
      row.wonCount += 1;
      row.wonValue += Number(l.value) || 0;
    }
    map.set(l.assigned_to, row);
  }
  return map;
}
