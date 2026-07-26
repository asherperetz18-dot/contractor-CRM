"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { JobInput } from "@/lib/data/types";

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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase
    .from("jobs")
    .insert({ ...toRow(input), created_by: user?.id ?? null });

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

export async function deleteJob(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("jobs").delete().eq("id", id);

  if (error) return { error: error.message };
  revalidatePath("/production");
  return {};
}
