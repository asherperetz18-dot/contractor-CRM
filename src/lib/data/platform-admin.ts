import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { InviteHistoryRow } from "@/lib/signup/invite-history";
import { selectAll } from "@/lib/data/select-all";
import {
  buildCompanyDirectory,
  type CompanyDirectoryRow,
  type DirectoryBilling,
  type DirectoryCompany,
  type DirectoryMember,
} from "@/lib/company-directory";
import { usageMonth, type UsageRow } from "@/lib/usage/usage";
import type { LimitsRow } from "@/lib/usage/limits";
import { listSetupSummaries } from "@/lib/data/setup-checklist";

export type PlatformAdminRow = {
  id: string;
  name: string | null;
  email: string | null;
};

/**
 * Everyone who currently holds is_platform_admin, for the management
 * page. Expected to stay a short list -- this is meant to be a handful
 * of people, not a roster -- so no paging.
 *
 * Not a "use server" action: only ever called from platform-admin/page.tsx
 * during render, which is itself behind PlatformAdminGate. Reading the
 * list needs no guard of its own the way granting and revoking do,
 * exactly as getCompanyMembers has none beyond its caller's page gate.
 */
export async function listPlatformAdmins(): Promise<PlatformAdminRow[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("id, name, email")
    .eq("is_platform_admin", true)
    .order("name");
  return (data as PlatformAdminRow[] | null) ?? [];
}

const INVITE_HISTORY_LIMIT = 300;

/**
 * Every setup link ever sent, newest first, for the Platform Admin
 * history card. Reads signup_invites through the service-role client
 * because that table has RLS on with no policies by design (0130); the
 * page gate is the whole guard, same as listPlatformAdmins above. Only
 * display fields come out -- never token_hash.
 *
 * Capped rather than paged: invites arrive a few a week, so the cap is a
 * years-out safety net, not something anyone will hit soon.
 */
export async function listInviteHistory(): Promise<InviteHistoryRow[]> {
  const admin = createAdminClient();
  const base =
    "id, email, company_name, source, created_at, invite_sent_at, expires_at, consumed_at, company_id";

  let { data, error } = await admin
    .from("signup_invites")
    .select(`${base}, sent_by, companies (name)`)
    .order("created_at", { ascending: false })
    .limit(INVITE_HISTORY_LIMIT);

  // Until migration 0172 is pasted the sent_by column doesn't exist;
  // show the history without the sender rather than an empty card.
  if (error && /sent_by/.test(error.message)) {
    ({ data, error } = await admin
      .from("signup_invites")
      .select(`${base}, companies (name)`)
      .order("created_at", { ascending: false })
      .limit(INVITE_HISTORY_LIMIT));
  }
  if (error || !data) return [];

  type Raw = Omit<InviteHistoryRow, "sent_by_name"> & {
    sent_by?: string | null;
    companies: { name: string } | { name: string }[] | null;
  };
  const rows = data as Raw[];

  // One lookup for every sender instead of a join: the roster is small
  // and the FK is the only thing the join would need anyway.
  const senderIds = Array.from(new Set(rows.map((r) => r.sent_by).filter((id): id is string => Boolean(id))));
  const names = new Map<string, string | null>();
  if (senderIds.length > 0) {
    const { data: people } = await admin.from("profiles").select("id, name").in("id", senderIds);
    for (const p of (people as { id: string; name: string | null }[] | null) ?? []) names.set(p.id, p.name);
  }

  return rows.map((r) => {
    const co = Array.isArray(r.companies) ? r.companies[0] : r.companies;
    return {
      id: r.id,
      email: r.email,
      // A redeemed invite's company may have been renamed since; the live
      // name wins over the one typed at signup.
      company_name: co?.name ?? r.company_name,
      source: r.source,
      created_at: r.created_at,
      invite_sent_at: r.invite_sent_at,
      expires_at: r.expires_at,
      consumed_at: r.consumed_at,
      company_id: r.company_id,
      sent_by_name: r.sent_by ? (names.get(r.sent_by) ?? null) : null,
    };
  });
}

/**
 * Every company on the platform, for the Companies page (DECISIONS #127).
 * Three reads, each paged past the 1,000-row cap (selectAll), instead of
 * a query per company: the list is meant to stay quick at hundreds of
 * companies. Behind PlatformAdminGate like the rest of this file.
 */
export async function listCompanyDirectory(): Promise<CompanyDirectoryRow[]> {
  const admin = createAdminClient();
  const [companies, members, billing] = await Promise.all([
    selectAll<DirectoryCompany>((from, to) =>
      admin.from("companies").select("id, name, created_at").order("id").range(from, to)
    ),
    selectAll<DirectoryMember>((from, to) =>
      admin
        .from("company_members")
        .select("company_id, roles, status, granted_via_platform_admin, created_at, profiles(name, email)")
        .eq("status", "Active")
        .order("id")
        .range(from, to)
    ),
    selectAll<DirectoryBilling>((from, to) =>
      // "*": trial_ends_at (0198) may not exist yet, and naming it would empty the list.
      admin.from("company_billing").select("*").order("company_id").range(from, to)
    ),
  ]);
  // This month's counts (0199): none until it has run, which reads as zeros.
  const month = usageMonth(new Date());
  const usage = await selectAll<UsageRow>((from, to) =>
    admin.from("company_usage").select("*").eq("month", month).order("company_id").range(from, to)
  );
  // Monthly limits (0200): none until it has run, which reads as no limits.
  const limits = await selectAll<LimitsRow>((from, to) =>
    admin.from("company_limits").select("*").order("company_id").range(from, to)
  );
  // Closed companies (0201): none until it has run.
  const closures = await selectAll<{ company_id: string; closed_at: string; reason: string | null }>((from, to) =>
    admin.from("company_closures").select("*").order("company_id").range(from, to)
  );
  const rows = buildCompanyDirectory(companies, members, billing, usage, limits, closures);
  // The setup checklist's count (DECISIONS #136), with the directory's own team count.
  const setup = await listSetupSummaries(new Map(rows.map((r) => [r.id, r.team])));
  return rows.map((r) => ({ ...r, setup: setup.get(r.id) }));
}
