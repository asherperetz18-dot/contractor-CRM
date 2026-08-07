import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { selectAll } from "@/lib/data/select-all";
import type { Estimate, EstimateSigner } from "@/lib/data/types";
import { EstimatesView, type EstimateLead, type EstimateRep } from "./estimates-view";

export const dynamic = "force-dynamic";

export default async function EstimatesPage() {
  const profile = await getCurrentProfile();
  if (!profile) return null;

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
        .select("id, first_name, last_name, email, address, stage")
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
      canDelete={
        profile.roles.includes("Office") ||
        profile.roles.includes("Admin") ||
        (profile.roles.includes("Sales") && profile.can_delete_leads)
      }
    />
  );
}
