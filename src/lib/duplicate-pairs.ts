import { normalizePhone, type Lead } from "./data/types.ts";

/**
 * The duplicate-merge tool's pairing, as a pure function with safety
 * rails. The old version expanded every shared phone/email into
 * pairwise combinations of full lead rows: one junk number shared by
 * 500 imported contacts is 124,750 pairs, which froze the browser the
 * day the 73k import landed. Two rails fix that without changing what
 * a pair means: a group past maxGroupSize is reported as a cluster
 * (nobody merges a junk number one pair at a time), and the returned
 * list is capped while the total stays exact.
 */

export type DupPairContact = {
  id: string;
  contact_type: Lead["contact_type"];
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  source: string | null;
  stage: string;
  created_at: string;
};

export type DuplicateReason = "phone" | "email";

export type DuplicatePair = {
  leadA: DupPairContact;
  leadB: DupPairContact;
  reasons: DuplicateReason[];
};

export type OversizedDupGroup = { kind: DuplicateReason; key: string; count: number };

export function buildDuplicatePairs(
  rows: DupPairContact[],
  dismissedPairs: Set<string>,
  opts: { maxGroupSize: number; maxPairs: number }
): { pairs: DuplicatePair[]; totalPairs: number; oversized: OversizedDupGroup[] } {
  const byPhone = new Map<string, DupPairContact[]>();
  const byEmail = new Map<string, DupPairContact[]>();
  for (const lead of rows) {
    const phone = lead.phone ? normalizePhone(lead.phone) : "";
    if (phone.length >= 7) {
      if (!byPhone.has(phone)) byPhone.set(phone, []);
      byPhone.get(phone)!.push(lead);
    }
    const email = lead.email?.trim().toLowerCase() ?? "";
    if (email) {
      if (!byEmail.has(email)) byEmail.set(email, []);
      byEmail.get(email)!.push(lead);
    }
  }

  const oversized: OversizedDupGroup[] = [];
  const pairReasons = new Map<
    string,
    { leadA: DupPairContact; leadB: DupPairContact; reasons: Set<DuplicateReason> }
  >();
  function addGroups(groups: Map<string, DupPairContact[]>, reason: DuplicateReason) {
    for (const [key, group] of groups) {
      if (group.length < 2) continue;
      if (group.length > opts.maxGroupSize) {
        oversized.push({ kind: reason, key, count: group.length });
        continue;
      }
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const [a, b] = group[i].id < group[j].id ? [group[i], group[j]] : [group[j], group[i]];
          const pairId = `${a.id}:${b.id}`;
          if (dismissedPairs.has(pairId)) continue;
          const entry = pairReasons.get(pairId) ?? { leadA: a, leadB: b, reasons: new Set<DuplicateReason>() };
          entry.reasons.add(reason);
          pairReasons.set(pairId, entry);
        }
      }
    }
  }
  addGroups(byPhone, "phone");
  addGroups(byEmail, "email");

  const all = [...pairReasons.values()]
    .map((p) => ({ leadA: p.leadA, leadB: p.leadB, reasons: [...p.reasons] }))
    .sort((a, b) => b.reasons.length - a.reasons.length);
  oversized.sort((a, b) => b.count - a.count);

  return { pairs: all.slice(0, opts.maxPairs), totalPairs: all.length, oversized };
}
