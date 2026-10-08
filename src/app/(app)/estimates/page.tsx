import { getCompanyZone } from "@/lib/data/company-today";
import { isoDateInZone } from "@/lib/company-clock";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { selectAll } from "@/lib/data/select-all";
import { canCreateEstimates, canViewEstimates } from "@/lib/data/types";
import {
  ESTIMATE_LIST_COLUMNS,
  ESTIMATE_LIST_SIGNER_COLUMNS,
  type EstimateListRow,
  type EstimateListSigner,
} from "@/lib/data/estimate-list-rows";
import { EstimatesView, type EstimateLead, type EstimateRep } from "./estimates-view";
import { staffPageLabel } from "@/lib/staff-words";
import { getCompanyWordsCached } from "@/lib/data/company-chrome";

export const dynamic = "force-dynamic";

export default async function EstimatesPage() {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  // RLS would return an empty list anyway, which reads as "you have no
  // estimates" rather than "you aren't allowed to see these" -- and a
  // silent empty page is how people conclude their data is missing.
  if (!canViewEstimates(profile)) {
    return (
      <div className="empty-state">
        <p className="empty-label">You don&apos;t have access to estimates</p>
        <p className="empty-hint">
          Ask an Office or Admin user to switch on View Estimates for you in Admin Settings &rarr;
          Users &amp; Roles.
        </p>
      </div>
    );
  }

  const supabase = await createClient();

  // selectAll rather than a bare select: PostgREST silently truncates at
  // 1000 rows, which has already cost this app a broken search and a
  // broken dialer.
  //
  // Every document -- the cards' counts and totals and the search cover
  // them all -- but only the columns the list draws (DECISIONS #145):
  // not each contract's terms, notes and messages, nor the signature
  // pictures, which it used to download for every signed document.
  const [estimates, signers, reps] = await Promise.all([
    selectAll<EstimateListRow>((from, to) =>
      supabase
        .from("estimates")
        .select(ESTIMATE_LIST_COLUMNS)
        .eq("company_id", profile.company_id)
        .order("created_at", { ascending: false })
        .range(from, to)
    ),
    selectAll<EstimateListSigner>((from, to) =>
      supabase
        .from("estimate_signers")
        .select(ESTIMATE_LIST_SIGNER_COLUMNS)
        .eq("company_id", profile.company_id)
        .order("sort_order", { ascending: true })
        .range(from, to)
    ),
    selectAll<EstimateRep>((from, to) =>
      supabase.from("profiles").select("id, name, email").range(from, to)
    ),
  ]);

  // Only the leads these documents actually name -- not the company's
  // whole contact book, which at 79k rows froze the browser for the
  // several seconds it took to ship and hydrate a list that draws a few
  // dozen documents (same cure as Contacts and the pipeline board,
  // DECISIONS #019/#020). The New Estimate dialog reaches every lead
  // through searchEstimateLeads instead of this array.
  const leadIds = [...new Set(estimates.map((e) => e.lead_id).filter(Boolean))];
  const leads = leadIds.length
    ? await selectAll<EstimateLead>((from, to) =>
        supabase
          .from("leads")
          .select(
            "id, contact_type, company_name, first_name, last_name, email, address, stage, assigned_to, partner_rep_id, closer_id"
          )
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

  // The company's calendar for the date filter, handed down: a document
  // made after 5pm Pacific is that day's, not the UTC day after.
  const zone = await getCompanyZone();
  const today = isoDateInZone(new Date(), zone);

  return (
    <EstimatesView
      today={today}
      zone={zone}
      title={staffPageLabel("/estimates", "Estimates & Contracts", await getCompanyWordsCached(profile.company_id))}
      words={await getCompanyWordsCached(profile.company_id)}
      estimates={estimates}
      signers={signers}
      leads={leads}
      reps={reps}
      viewsByEstimate={viewsByEstimate}
      canCreate={canCreateEstimates(profile)}
      savedCardOrder={profile.estimate_funnel_order ?? null}
    />
  );
}
