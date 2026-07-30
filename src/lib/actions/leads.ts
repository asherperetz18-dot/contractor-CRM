"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
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
    lead_cost: input.lead_cost.trim() === "" ? null : Number(input.lead_cost) || 0,
    date_received: input.date_received || undefined,
    notes: input.notes || null,
    has_appt: input.has_appt,
    second_contact_first_name: input.second_contact_first_name || null,
    second_contact_last_name: input.second_contact_last_name || null,
    second_contact_phone: input.second_contact_phone || null,
    assigned_to: input.assigned_to || null,
  };
}

export type BulkLeadRow = {
  company_name: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  address: string;
  project_type: string;
  value: string;
  date_received: string;
  source: string;
};

export async function bulkImportLeads(rows: BulkLeadRow[], stage: PipelineStage) {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in.", imported: 0 };

  const supabase = await createClient();
  const payload = rows.map((r) => ({
    contact_type: "Individual" as const,
    company_name: r.company_name || null,
    first_name: r.first_name || null,
    last_name: r.last_name || null,
    phone: r.phone || null,
    email: r.email || null,
    address: r.address || null,
    project_type: r.project_type || null,
    value: Number(r.value) || 0,
    date_received: r.date_received || undefined,
    stage,
    source: r.source || "CSV Import",
    created_by: profile.id,
    company_id: profile.company_id,
  }));

  const CHUNK = 500;
  for (let i = 0; i < payload.length; i += CHUNK) {
    const { error } = await supabase.from("leads").insert(payload.slice(i, i + CHUNK));
    if (error) return { error: error.message, imported: i };
  }

  revalidatePath("/pipeline");
  return { imported: payload.length };
}

export async function createLead(input: LeadInput) {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .insert({ ...toRow(input), created_by: profile.id, company_id: profile.company_id })
    .select("id")
    .single();

  if (error) return { error: error.message };
  revalidatePath("/pipeline");
  return { id: (data as { id: string }).id };
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

export async function requestLeadRefund(id: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("leads")
    .update({ refund_status: "Requested", refund_requested_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return { error: error.message };
  revalidatePath("/pipeline");
  return {};
}

export async function resolveLeadRefund(id: string, status: "Received" | "Denied") {
  const supabase = await createClient();
  const { error } = await supabase.from("leads").update({ refund_status: status }).eq("id", id);

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
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  const name =
    `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() + " — Project";

  const { error: jobError } = await supabase.from("jobs").insert({
    lead_id: lead.id,
    name,
    address: lead.address || null,
    status: "Not Started",
    created_by: profile.id,
    company_id: profile.company_id,
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
    notes?: string;
    projectType?: string;
  }
) {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  const { error: eventError } = await supabase.from("events").insert({
    title: details.title || null,
    date: details.date,
    time: details.time || null,
    event_type: details.eventType,
    assigned_to: details.assignedTo || null,
    notes: details.notes || null,
    lead_id: leadId,
    created_by: profile.id,
    company_id: profile.company_id,
  });
  if (eventError) return { error: eventError.message };

  const preAppointmentStages: PipelineStage[] = [
    "Unsorted",
    "New Lead",
    "Meta",
    "No Answer",
    "Contacted",
  ];
  const nextStage = preAppointmentStages.includes(currentStage)
    ? "Appointment Scheduled"
    : currentStage;

  const { error: leadError } = await supabase
    .from("leads")
    .update({
      has_appt: true,
      stage: nextStage,
      ...(details.projectType ? { project_type: details.projectType } : {}),
    })
    .eq("id", leadId);
  if (leadError) return { error: leadError.message };

  revalidatePath("/pipeline");
  revalidatePath("/calendar");
  revalidatePath("/schedule");
  return {};
}

export async function createLeadTask(
  leadId: string,
  input: { title: string; due_date: string; due_time?: string; assigned_to: string }
) {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  const { error } = await supabase.from("lead_tasks").insert({
    lead_id: leadId,
    title: input.title.trim(),
    due_date: input.due_date,
    due_time: input.due_time || null,
    assigned_to: input.assigned_to || null,
    created_by: profile.id,
    company_id: profile.company_id,
  });
  if (error) return { error: error.message };
  revalidatePath("/pipeline");
  return {};
}

export async function completeLeadTask(taskId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("lead_tasks")
    .update({ completed_at: new Date().toISOString() })
    .eq("id", taskId);
  if (error) return { error: error.message };
  revalidatePath("/pipeline");
  return {};
}

export async function deleteLeadTask(taskId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("lead_tasks").delete().eq("id", taskId);
  if (error) return { error: error.message };
  revalidatePath("/pipeline");
  return {};
}
