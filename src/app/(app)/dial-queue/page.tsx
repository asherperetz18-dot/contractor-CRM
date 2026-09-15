import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import {
  canUseSalesCenter,
  NO_DISPOSITION,
  type CallDispositionRow,
  type CompanyProfile,
  type DialList,
  type PipelineStageRow,
} from "@/lib/data/types";
import { listDialContacts } from "@/lib/actions/dial-contacts";
import { DialQueueView } from "./dial-queue-view";
import { listCompanyPhoneNumbers } from "@/lib/actions/phone-numbers";

export default async function DialQueuePage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const canWrite = canUseSalesCenter(profile);
  const companyId = profile?.company_id ?? "";

  // The contact book itself never rides along: the page carries the 50
  // rows it first shows and a total, and the view asks the server for
  // every further page or filter. This page used to ship every lead in
  // the company (all columns) plus every call log -- at 79k contacts
  // that was tens of megabytes and minutes of load. See DECISIONS #019.
  const [
    initialContacts,
    { data: stages },
    allReps,
    { data: dispositions },
    { data: dialLists },
    { data: companyProfile },
  ] = await Promise.all([
    listDialContacts({
      tab: "contact",
      search: "",
      page: 1,
      callAttempts: "All",
      dispositionFilter: NO_DISPOSITION,
      addressTypeFilter: "All",
      statusFilter: "All",
      stageFilter: "All",
      repFilter: "All",
      calledFilter: "All",
      leadDispositionFilter: "All",
      createdSince: "",
    }),
    supabase.from("pipeline_stages").select("*").eq("company_id", companyId).order("sort_order", { ascending: true }),
    profile ? getCompanyMembers(companyId) : Promise.resolve([]),
    supabase.from("call_dispositions").select("*").eq("company_id", companyId).order("sort_order", { ascending: true }),
    supabase.from("dial_lists").select("*").eq("company_id", companyId).order("created_at", { ascending: false }),
    profile
      ? supabase.from("company_profile").select("call_script").eq("company_id", companyId).single()
      : Promise.resolve({ data: null }),
  ]);
  const reps = allReps.filter((r) => r.status === "Active").sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  const phoneNumbers = await listCompanyPhoneNumbers();

  return (
    <DialQueueView
      initialContacts={initialContacts}
      stages={(stages as PipelineStageRow[]) ?? []}
      reps={reps}
      dispositions={(dispositions as CallDispositionRow[]) ?? []}
      dialLists={(dialLists as DialList[]) ?? []}
      callScript={(companyProfile as Pick<CompanyProfile, "call_script"> | null)?.call_script ?? null}
      canWrite={canWrite}
      phoneNumbers={phoneNumbers}
    />
  );
}
