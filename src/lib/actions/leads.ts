"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { LeadInput, PipelineStage } from "@/lib/data/types";

function toRow(input: LeadInput) {
  return {
    contact_type: input.contact_type,
    company_name: input.company_name || null,
    first_name: input.first_name || null,
    last_name: input.last_name || null,
    phone: input.phone || null,
    email: input.email || null,
    address: input.address || null,
    zip: input.zip || null,
    source: input.source || null,
    project_type: input.project_type || null,
    stage: input.stage,
    value: Number(input.value) || 0,
    notes: input.notes || null,
    has_appt: input.has_appt,
    second_contact_first_name: input.second_contact_first_name || null,
    second_contact_last_name: input.second_contact_last_name || null,
    second_contact_phone: input.second_contact_phone || null,
  };
}

export async function createLead(input: LeadInput) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase
    .from("leads")
    .insert({ ...toRow(input), created_by: user?.id ?? null });

  if (error) return { error: error.message };
  revalidatePath("/pipeline");
  return {};
}

export async function updateLead(id: string, input: LeadInput) {
  const supabase = await createClient();
  const { error } = await supabase.from("leads").update(toRow(input)).eq("id", id);

  if (error) return { error: error.message };
  revalidatePath("/pipeline");
  return {};
}

export async function deleteLead(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("leads").delete().eq("id", id);

  if (error) return { error: error.message };
  revalidatePath("/pipeline");
  return {};
}

export async function moveLeadStage(id: string, stage: PipelineStage) {
  const supabase = await createClient();
  const { error } = await supabase.from("leads").update({ stage }).eq("id", id);

  if (error) return { error: error.message };
  revalidatePath("/pipeline");
  return {};
}

export async function convertLeadToJob(lead: {
  id: string;
  first_name: string | null;
  last_name: string | null;
  address: string | null;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const name =
    `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() + " — Project";

  const { error: jobError } = await supabase.from("jobs").insert({
    lead_id: lead.id,
    name,
    address: lead.address || null,
    status: "Not Started",
    created_by: user?.id ?? null,
  });
  if (jobError) return { error: jobError.message };

  const { error: leadError } = await supabase
    .from("leads")
    .update({ stage: "Won" })
    .eq("id", lead.id);
  if (leadError) return { error: leadError.message };

  revalidatePath("/pipeline");
  revalidatePath("/production");
  return {};
}

export async function bookAppointmentForLead(
  leadId: string,
  currentStage: PipelineStage,
  details: {
    title: string;
    date: string;
    time: string;
    eventType: string;
    assignedTo: string;
  }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error: eventError } = await supabase.from("events").insert({
    title: details.title || null,
    date: details.date,
    time: details.time || null,
    event_type: details.eventType,
    assigned_to: null,
    lead_id: leadId,
    notes: details.assignedTo ? `Assigned to: ${details.assignedTo}` : null,
    created_by: user?.id ?? null,
  });
  if (eventError) return { error: eventError.message };

  const nextStage =
    currentStage === "New Leads" || currentStage === "Contacted"
      ? "Estimate Scheduled"
      : currentStage;

  const { error: leadError } = await supabase
    .from("leads")
    .update({ has_appt: true, stage: nextStage })
    .eq("id", leadId);
  if (leadError) return { error: leadError.message };

  revalidatePath("/pipeline");
  revalidatePath("/calendar");
  revalidatePath("/schedule");
  return {};
}
