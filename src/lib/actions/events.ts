"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { EventInput } from "@/lib/data/types";

function toRow(input: EventInput) {
  return {
    title: input.title || null,
    date: input.date,
    time: input.time || null,
    event_type: input.event_type,
    assigned_to: input.assigned_to || null,
    job_id: input.job_id || null,
    notes: input.notes || null,
    customer_confirmed: input.customer_confirmed,
    rep_confirmed: input.rep_confirmed,
  };
}

function revalidateCalendarRoutes() {
  revalidatePath("/calendar");
  revalidatePath("/schedule");
  revalidatePath("/");
}

export async function createEvent(input: EventInput, leadId?: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from("events").insert({
    ...toRow(input),
    lead_id: leadId || null,
    created_by: user?.id ?? null,
  });
  if (error) return { error: error.message };
  revalidateCalendarRoutes();
  return {};
}

export async function updateEvent(id: string, input: EventInput) {
  const supabase = await createClient();
  const { error } = await supabase.from("events").update(toRow(input)).eq("id", id);
  if (error) return { error: error.message };
  revalidateCalendarRoutes();
  return {};
}

export async function deleteEvent(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("events").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidateCalendarRoutes();
  return {};
}
