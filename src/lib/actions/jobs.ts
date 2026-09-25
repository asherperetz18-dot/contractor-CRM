"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { backfillSeeds, productionJobRow, type SignedContractSeed } from "@/lib/production-job";
import type { JobInput, JobStatus } from "@/lib/data/types";

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
 *  never clobber edits somebody else is making in the job's form. */
export async function updateJobStatus(id: string, status: JobStatus) {
  const supabase = await createClient();
  const { error } = await supabase.from("jobs").update({ status }).eq("id", id);

  if (error) return { error: error.message };
  revalidatePath("/production");
  return {};
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
