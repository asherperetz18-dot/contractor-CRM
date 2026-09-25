import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { selectAll } from "@/lib/data/select-all";
import {
  canCreateEstimates,
  canViewEstimates,
  type Estimate,
  type EstimateSigner,
} from "@/lib/data/types";
import { ContractsView, type ContractLead, type ContractRep } from "./contracts-view";

export const dynamic = "force-dynamic";

/**
 * The Contract Board: every contract by where it stands on the way to a
 * signature. A contract is an estimates row with kind 'contract' -- the
 * board is a view over the same rows the Estimates and Projects pages
 * read, so it can never disagree with either.
 */
export default async function ContractsPage() {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  // Same gate as Estimates: these are the same documents. RLS would
  // return an empty list anyway, which reads as "you have no contracts"
  // rather than "you aren't allowed to see these".
  if (!canViewEstimates(profile)) {
    return (
      <div className="empty-state">
        <p className="empty-label">You don&apos;t have access to contracts</p>
        <p className="empty-hint">
          Ask an Office or Admin user to switch on View Estimates for you in Admin Settings &rarr;
          Users &amp; Roles.
        </p>
      </div>
    );
  }

  const supabase = await createClient();

  // selectAll rather than a bare select: PostgREST silently truncates at
  // 1000 rows. Contracts only -- change orders and completion
  // certificates attach to a contract and would double-count the job.
  const [contracts, signers, reps] = await Promise.all([
    selectAll<Estimate>((from, to) =>
      supabase
        .from("estimates")
        .select("*")
        .eq("company_id", profile.company_id)
        .eq("kind", "contract")
        .order("created_at", { ascending: false })
        .range(from, to)
    ),
    selectAll<EstimateSigner>((from, to) =>
      supabase
        .from("estimate_signers")
        .select("*")
        .eq("company_id", profile.company_id)
        .order("sort_order", { ascending: true })
        .range(from, to)
    ),
    selectAll<ContractRep>((from, to) =>
      supabase.from("profiles").select("id, name, email").range(from, to)
    ),
  ]);

  // Only the leads these contracts actually name -- not the company's
  // whole contact book (79k rows froze the browser once; DECISIONS
  // #019/#020).
  const leadIds = [...new Set(contracts.map((e) => e.lead_id).filter(Boolean))];
  const leads = leadIds.length
    ? await selectAll<ContractLead>((from, to) =>
        supabase
          .from("leads")
          .select("id, contact_type, company_name, first_name, last_name, address, assigned_to")
          .eq("company_id", profile.company_id)
          .in("id", leadIds)
          .range(from, to)
      )
    : [];

  // Customer opens per document, newest first so [0] is the latest look.
  const views = await selectAll<{ estimate_id: string; viewed_at: string }>((from, to) =>
    supabase
      .from("estimate_views")
      .select("estimate_id, viewed_at")
      .eq("company_id", profile.company_id)
      .order("viewed_at", { ascending: false })
      .range(from, to)
  );
  const viewsByEstimate: Record<string, { count: number; last: string }> = {};
  for (const v of views) {
    const entry = viewsByEstimate[v.estimate_id];
    if (entry) entry.count += 1;
    else viewsByEstimate[v.estimate_id] = { count: 1, last: v.viewed_at };
  }

  return (
    <ContractsView
      contracts={contracts}
      signers={signers}
      leads={leads}
      reps={reps}
      viewsByEstimate={viewsByEstimate}
      canCreate={canCreateEstimates(profile)}
    />
  );
}
