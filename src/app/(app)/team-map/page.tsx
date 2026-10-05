import { AdminGate } from "@/components/admin-gate";
import { createClient } from "@/lib/supabase/server";
import { getCurrentCompanyId } from "@/lib/data/profile";
import { TeamMapView } from "./team-map-view";

export const dynamic = "force-dynamic";

export default async function TeamMapPage() {
  // Where the map opens when nobody on the clock has a location yet: the
  // company's own address, not Los Angeles (DECISIONS #118).
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const { data } = companyId
    ? await supabase.from("company_profile").select("address").eq("company_id", companyId).maybeSingle()
    : { data: null };
  const companyAddress = (data as { address: string | null } | null)?.address ?? null;
  return (
    <AdminGate>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Team Map</h1>
          <p className="module-sub">Everyone on the clock, live. People off the clock aren&apos;t shown.</p>
        </div>
      </div>
      <TeamMapView companyAddress={companyAddress} />
    </AdminGate>
  );
}
