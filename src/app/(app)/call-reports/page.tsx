import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/data/select-all";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import {
  canUseSalesCenter,
  type CallDispositionRow,
  type CallLog,
  type Lead,
} from "@/lib/data/types";
import { CallReportsView } from "./call-reports-view";

export default async function CallReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; fromTs?: string; toTs?: string }>;
}) {
  const { range, fromTs, toTs } = await searchParams;
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const canWrite = canUseSalesCenter(profile);
  const companyId = profile?.company_id ?? "";

  // The window is decided in the browser (local midnights, sent as UTC
  // instants) and applied here, so the database only hands over the
  // range the page is going to show. First visit defaults to the last
  // 30 days -- "everything ever" is a choice, not the accident of
  // landing on the page.
  const valid = (s?: string) => !!s && !isNaN(Date.parse(s));
  const rangeKey = range ?? "30d";
  // A request-time "30 days back from now" default is the point here --
  // every visit to this dynamic page recomputes its own window.
  // eslint-disable-next-line react-hooks/purity
  const thirtyDaysBack = new Date(Date.now() - 30 * 86400000).toISOString();
  const fromIso = valid(fromTs) ? fromTs! : rangeKey === "all" ? null : thirtyDaysBack;
  const toIso = valid(toTs) ? toTs! : null;

  const [callLogs, leads, reps, { data: dispositions }] = await Promise.all([
    // selectAll, where a bare select stopped at PostgREST's 1000-row
    // ceiling in silence -- the Total Calls card was reading exactly
    // 1000 because that was the cap, not the count.
    selectAll<CallLog>((f, t) => {
      let q = supabase
        .from("call_logs")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      if (fromIso) q = q.gte("created_at", fromIso);
      if (toIso) q = q.lt("created_at", toIso);
      return q.range(f, t);
    }),
    selectAll<Lead>((f, t) =>
      supabase.from("leads").select("*").eq("company_id", companyId).range(f, t)
    ),
    profile ? getCompanyMembers(companyId) : Promise.resolve([]),
    supabase.from("call_dispositions").select("*").eq("company_id", companyId).order("sort_order", { ascending: true }),
  ]);

  return (
    <CallReportsView
      callLogs={callLogs ?? []}
      leads={(leads as Lead[]) ?? []}
      reps={reps}
      dispositions={(dispositions as CallDispositionRow[]) ?? []}
      canWrite={canWrite}
      initialRange={rangeKey}
    />
  );
}
