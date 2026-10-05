/**
 * The platform admin's list of every company (DECISIONS #127): who owns
 * it, how many people work in it, and where its AI Build Pro billing
 * stands. Pure, so the rules -- whose seat counts, who reads as the
 * owner -- are tested apart from the database.
 */
import { isBillingLocked } from "./billing/subscription.ts";
import { usageFromRow, type MonthUsage, type UsageRow } from "./usage/usage.ts";
import { limitsFromRow, type CompanyLimits, type LimitsRow } from "./usage/limits.ts";

export type DirectoryCompany = { id: string; name: string; created_at: string };

type Person = { name: string | null; email: string | null };

export type DirectoryMember = {
  company_id: string;
  roles: string[];
  status: string;
  /** A seat a platform admin holds only to look in (migration 0132), not a member of the company's team. */
  granted_via_platform_admin: boolean;
  created_at: string;
  profiles: Person | Person[] | null;
};

export type DirectoryBilling = {
  company_id: string;
  billing_status: string | null;
  /** When a free trial ends (0198); absent before it has run. */
  trial_ends_at?: string | null;
};

export type BillingState = "paying" | "trial" | "payment_failed" | "locked" | "unsynced" | "not_billed";

export const BILLING_STATE_LABEL: Record<BillingState, string> = {
  paying: "Paying",
  trial: "Free trial",
  payment_failed: "Payment failed",
  locked: "Locked",
  unsynced: "Waiting on Stripe",
  not_billed: "Not billed",
};

/**
 * No billing row: a company that has never had a subscription (made by a
 * platform admin, or before self-serve signup) -- never locked. A row
 * whose status hasn't come in yet, or that Stripe names something new,
 * reads "Waiting on Stripe", never as paying.
 */
export function billingState(row: { billing_status: string | null } | undefined): BillingState {
  if (!row) return "not_billed";
  const status = row.billing_status;
  if (status === "active") return "paying";
  if (status === "trialing") return "trial";
  if (status === "past_due" || status === "incomplete") return "payment_failed";
  if (isBillingLocked(status)) return "locked";
  return "unsynced";
}

export type CompanyDirectoryRow = {
  id: string;
  name: string;
  createdAt: string;
  owner: Person | null;
  /** Active people of the company's own; platform admins looking in aren't counted. */
  team: number;
  billing: BillingState;
  /** A free trial's end, for the trial's row (DECISIONS #130). */
  trialEndsAt: string | null;
  /** This month's AI uses, texts and emails (DECISIONS #132). */
  usage: MonthUsage;
  /** Its monthly limits; null each where none is set (DECISIONS #133). */
  limits: CompanyLimits;
};

function person(p: DirectoryMember["profiles"]): Person | null {
  const one = Array.isArray(p) ? p[0] : p;
  return one ? { name: one.name, email: one.email } : null;
}

export function buildCompanyDirectory(
  companies: DirectoryCompany[],
  members: DirectoryMember[],
  billing: DirectoryBilling[],
  /** This month's company_usage rows (0199); none before it has run. */
  usage: UsageRow[] = [],
  /** company_limits rows (0200); none before it has run. */
  limits: LimitsRow[] = []
): CompanyDirectoryRow[] {
  const usageByCompany = new Map(usage.map((u) => [u.company_id, u]));
  const limitsByCompany = new Map(limits.map((l) => [l.company_id, l]));
  const own = new Map<string, DirectoryMember[]>();
  for (const m of members) {
    if (m.status !== "Active" || m.granted_via_platform_admin) continue;
    const list = own.get(m.company_id) ?? [];
    list.push(m);
    own.set(m.company_id, list);
  }
  const billingByCompany = new Map(billing.map((b) => [b.company_id, b]));

  return companies
    .map((c) => {
      const team = own.get(c.id) ?? [];
      // The company's first Office or Admin: whoever set it up, in practice.
      const owner = team
        .filter((m) => m.roles.includes("Admin") || m.roles.includes("Office"))
        .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
      return {
        id: c.id,
        name: c.name,
        createdAt: c.created_at,
        owner: owner ? person(owner.profiles) : null,
        team: team.length,
        billing: billingState(billingByCompany.get(c.id)),
        trialEndsAt: billingByCompany.get(c.id)?.trial_ends_at ?? null,
        usage: usageFromRow(usageByCompany.get(c.id)),
        limits: limitsFromRow(limitsByCompany.get(c.id)),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export type DirectoryFilter = "all" | BillingState;

export function filterCompanyDirectory(
  rows: CompanyDirectoryRow[],
  filter: DirectoryFilter,
  search: string
): CompanyDirectoryRow[] {
  const q = search.trim().toLowerCase();
  return rows.filter((r) => {
    if (filter !== "all" && r.billing !== filter) return false;
    if (!q) return true;
    return [r.name, r.owner?.name, r.owner?.email].some((s) => (s ?? "").toLowerCase().includes(q));
  });
}

export function directoryCounts(rows: CompanyDirectoryRow[]): Record<DirectoryFilter, number> {
  const counts = Object.fromEntries(
    (Object.keys(BILLING_STATE_LABEL) as BillingState[]).map((k) => [k, 0])
  ) as Record<BillingState, number>;
  for (const r of rows) counts[r.billing] += 1;
  return { all: rows.length, ...counts };
}
