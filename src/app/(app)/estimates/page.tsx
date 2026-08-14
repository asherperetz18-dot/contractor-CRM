import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { selectAll } from "@/lib/data/select-all";
import { canCreateEstimates, canViewEstimates, type Estimate, type EstimateSigner } from "@/lib/data/types";
import { EstimatesView, type EstimateLead, type EstimateRep } from "./estimates-view";

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
  const [estimates, signers, leads, reps] = await Promise.all([
    selectAll<Estimate>((from, to) =>
      supabase
        .from("estimates")
        .select("*")
        .eq("company_id", profile.company_id)
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
    selectAll<EstimateLead>((from, to) =>
      supabase
        .from("leads")
        .select("id, first_name, last_name, email, address, stage, assigned_to")
        .eq("company_id", profile.company_id)
        .range(from, to)
    ),
    selectAll<EstimateRep>((from, to) =>
      supabase.from("profiles").select("id, name, email").range(from, to)
    ),
  ]);

  return (
    <EstimatesView
      estimates={estimates}
      signers={signers}
      leads={leads}
      reps={reps}
      canCreate={canCreateEstimates(profile)}
    />
  );
}
