import { repDropdownOptions } from "./rep-options.ts";
import type { AppRole } from "./types.ts";

/**
 * The Salesperson filter's options on /sales-commission.
 *
 * The standing rule for rep filters, applied here: the active Sales
 * roster (via repDropdownOptions, the one narrowing every people
 * dropdown), PLUS anyone present in the commission rows themselves,
 * plus the current tick. A rep who left the company still has lines on
 * this report -- their money is still owed -- so their name must stay
 * reachable, carrying the name the rows already use; and a tick must
 * stay visible to be undone.
 */
export function commissionRepFilterOptions(
  roster: { id: string; name: string; roles: AppRole[] }[],
  rows: { repId: string; repName: string }[],
  currentTick: string
): { id: string; name: string }[] {
  const rowIds = rows.map((r) => r.repId);
  const fromRoster = repDropdownOptions(
    roster.map((r) => ({ id: r.id, name: r.name, email: null, roles: r.roles, status: null })),
    [currentTick, ...rowIds]
  ).map((r) => ({ id: r.id, name: r.name || "Unnamed" }));

  const have = new Set(fromRoster.map((o) => o.id));
  const extras: { id: string; name: string }[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (have.has(r.repId) || seen.has(r.repId)) continue;
    seen.add(r.repId);
    extras.push({ id: r.repId, name: r.repName });
  }
  // The tick itself may point at someone with no roster entry and no
  // rows left (a stale URL) -- keep it selectable so it can be cleared.
  if (currentTick && !have.has(currentTick) && !seen.has(currentTick)) {
    extras.push({ id: currentTick, name: "(no longer listed)" });
  }

  return [...fromRoster, ...extras].sort((a, b) => a.name.localeCompare(b.name));
}
