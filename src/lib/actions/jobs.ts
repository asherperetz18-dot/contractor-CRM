"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { backfillSeeds, productionJobRow, type SignedContractSeed } from "@/lib/production-job";
import { projectHoldForJobStatus } from "@/lib/production-board";
import { isAdminRole, type JobInput, type JobStatus } from "@/lib/data/types";

function toRow(input: JobInput) {
  return {
    name: input.name.trim(),
    address: input.address || null,
    status: input.status,
    start_date: input.start_date || null,
    end_date: input.end_date || null,
    assigned_to: input.assigned_to || null,
    notes: input.notes || null,
  };
}

export async function createJob(input: JobInput) {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("jobs")
    .insert({ ...toRow(input), created_by: profile.id, company_id: profile.company_id });

  if (error) return { error: error.message };
  revalidatePath("/production");
  return {};
}

export async function updateJob(id: string, input: JobInput) {
  const supabase = await createClient();
  const { error } = await supabase.from("jobs").update(toRow(input)).eq("id", id);

  if (error) return { error: error.message };
  revalidatePath("/production");
  return {};
}

/** The board's drag-between-columns move: status alone, so a drop can
 *  never clobber edits somebody else is making in the job's form.
 *
 *  On Hold is one switch shared with the Projects page: a card dragged
 *  into or out of On Hold puts its project on or off hold too. Only
 *  Office/Admin may change a project's hold (setProjectHold's rule), so
 *  anyone else can still park a card in On Hold but can't release a
 *  project the office put there. */
export async function updateJobStatus(id: string, status: JobStatus) {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  const { data: job } = await supabase
    .from("jobs")
    .select("id, lead_id")
    .eq("id", id)
    .eq("company_id", profile.company_id)
    .maybeSingle<{ id: string; lead_id: string | null }>();
  if (!job) return { error: "Job not found." };

  const contract = job.lead_id ? await liveContract(supabase, profile.company_id, job.lead_id) : null;
  const hold = contract ? projectHoldForJobStatus(status, contract.project_on_hold) : null;
  if (hold === false && !isAdminRole(profile)) {
    return {
      error: "This project is on hold on the Projects page. Only Office or Admin can take it off hold.",
    };
  }

  const { error } = await supabase.from("jobs").update({ status }).eq("id", id);
  if (error) return { error: error.message };

  if (contract && hold !== null && isAdminRole(profile)) {
    const { error: holdError } = await supabase
      .from("estimates")
      .update({ project_on_hold: hold })
      .eq("id", contract.id)
      .eq("company_id", profile.company_id);
    if (holdError) return { error: `Moved, but the project's hold didn't change: ${holdError.message}` };
    revalidatePath("/projects");
  }
  revalidatePath("/production");
  return {};
}

/** The lead's live contract -- the latest signed one -- and its hold
 *  flag. Null when there is none, or before migration 0093 added the
 *  hold column (the query errors; the board then has no hold to sync). */
async function liveContract(
  supabase: Awaited<ReturnType<typeof createClient>>,
  companyId: string,
  leadId: string
): Promise<{ id: string; project_on_hold: boolean } | null> {
  const { data, error } = await supabase
    .from("estimates")
    .select("id, project_on_hold")
    .eq("company_id", companyId)
    .eq("lead_id", leadId)
    .eq("status", "Signed")
    .or("kind.eq.contract,kind.is.null")
    .order("signed_at", { ascending: false })
    .limit(1)
    .returns<{ id: string; project_on_hold: boolean | null }[]>();
  if (error || !data?.[0]) return null;
  return { id: data[0].id, project_on_hold: !!data[0].project_on_hold };
}

/**
 * The board's one-click catch-up: a job for every signed contract that
 * doesn't have one — the contracts signed before auto-create shipped
 * (decision #048), or one whose auto-create failed. Idempotent: a lead
 * with a job is skipped, so clicking twice adds nothing twice.
 */
export async function backfillJobsFromSignedContracts(): Promise<{
  error?: string;
  created?: number;
}> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  const [{ data: signed, error: signedErr }, { data: jobRows, error: jobsErr }] =
    await Promise.all([
      supabase
        .from("estimates")
        .select("id, lead_id, kind, title, signed_at")
        .eq("company_id", profile.company_id)
        .eq("status", "Signed"),
      supabase.from("jobs").select("lead_id").eq("company_id", profile.company_id),
    ]);
  if (signedErr) return { error: signedErr.message };
  if (jobsErr) return { error: jobsErr.message };

  const existing = new Set(
    (jobRows ?? []).map((r) => r.lead_id as string | null).filter((x): x is string => !!x)
  );
  const seeds = backfillSeeds((signed ?? []) as SignedContractSeed[], existing);
  if (seeds.length === 0) return { created: 0 };

  // Only the leads the seeds actually name -- never the contact book.
  const { data: leads, error: leadsErr } = await supabase
    .from("leads")
    .select("id, contact_type, company_name, first_name, last_name, address")
    .in("id", seeds.map((s) => s.lead_id as string))
    .returns<
      {
        id: string;
        contact_type: string | null;
        company_name: string | null;
        first_name: string | null;
        last_name: string | null;
        address: string | null;
      }[]
    >();
  if (leadsErr) return { error: leadsErr.message };
  const leadById = new Map((leads ?? []).map((l) => [l.id, l]));

  const rows = seeds
    .map((s) =>
      productionJobRow(
        { kind: s.kind, lead_id: s.lead_id, company_id: profile.company_id, title: s.title },
        leadById.get(s.lead_id as string) ?? null,
        false
      )
    )
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .map((r) => ({ ...r, created_by: profile.id }));
  if (rows.length === 0) return { created: 0 };

  const { error } = await supabase.from("jobs").insert(rows);
  if (error) return { error: error.message };
  revalidatePath("/production");
  return { created: rows.length };
}

export async function deleteJob(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("jobs").delete().eq("id", id);

  if (error) return { error: error.message };
  revalidatePath("/production");
  return {};
}
