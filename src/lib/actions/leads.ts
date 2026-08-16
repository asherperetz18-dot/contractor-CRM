"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { normalizePhone, type LeadInput, type PipelineStage } from "@/lib/data/types";

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
  notes: string;
};

/**
 * Which incoming rows already exist, matched on phone (normalised to the
 * last 10 digits so formatting differences don't hide a match) or email.
 *
 * Reports rather than blocks -- a repeat enquiry from the same person is
 * sometimes a genuinely new job, so the decision stays with the importer.
 */
export async function findImportDuplicates(
  rows: { phone: string; email: string }[]
): Promise<{ error?: string; duplicateRowIndexes?: number[] }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .select("phone, email, second_contact_phone")
    .eq("company_id", profile.company_id);
  if (error) return { error: error.message };

  const phones = new Set<string>();
  const emails = new Set<string>();
  for (const l of (data as { phone: string | null; email: string | null; second_contact_phone: string | null }[]) ?? []) {
    if (l.phone) phones.add(normalizePhone(l.phone));
    if (l.second_contact_phone) phones.add(normalizePhone(l.second_contact_phone));
    if (l.email) emails.add(l.email.trim().toLowerCase());
  }

  const duplicateRowIndexes: number[] = [];
  rows.forEach((r, i) => {
    const p = r.phone ? normalizePhone(r.phone) : "";
    const e = r.email ? r.email.trim().toLowerCase() : "";
    if ((p && phones.has(p)) || (e && emails.has(e))) duplicateRowIndexes.push(i);
  });

  return { duplicateRowIndexes };
}

// leads.date_received is NOT NULL. A blank or unrecognised date in the
// spreadsheet used to be sent as null, which failed the insert -- and
// because rows go up in chunks, one bad cell aborted the whole import.
// Anything that isn't a real YYYY-MM-DD falls back to today.
function importDate(raw: string): string {
  const trimmed = (raw || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed) && !isNaN(new Date(trimmed).getTime())) {
    return trimmed;
  }
  return new Date().toISOString().slice(0, 10);
}

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
    date_received: importDate(r.date_received),
    stage,
    source: r.source || "CSV Import",
    notes: r.notes || null,
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
  // lead_cost is left null when nobody typed one: a database trigger
  // fills it from the company default (migration 0089), so every way a
  // lead can arrive -- this form, a CSV import, the Facebook webhook --
  // gets priced the same way without each one remembering to.
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
  // Ask for the row back. When RLS blocks the write there is no error --
  // the statement simply matches zero rows -- so without this the save
  // reports success and the edit is silently thrown away.
  const { data, error } = await supabase
    .from("leads")
    .update(toRow(input))
    .eq("id", id)
    .select("id");

  if (error) return { error: error.message };
  if (!data || data.length === 0) {
    return { error: "That change couldn't be saved — your role may not have permission to edit this contact." };
  }
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
  // Same reason as updateLead: an RLS-blocked update returns no error, it
  // just matches nothing, so without asking for the row back this reports
  // success while the stage never moved.
  const { data, error } = await supabase
    .from("leads")
    .update({ stage })
    .eq("id", id)
    .select("id");

  if (error) return { error: error.message };
  if (!data || data.length === 0) {
    return { error: "Couldn't move this contact — your role may not have permission." };
  }
  revalidatePath("/pipeline");
  revalidatePath("/contacts");
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
    endTime?: string;
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
    end_time: details.endTime || null,
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

  // As the signed-in user: 0070 split the old catch-all task policy into
  // insert/update/delete and admitted Dispatch to the first two, so a
  // dispatcher's follow-up no longer needs the service role -- and
  // deleting one is refused by the database rather than by omission here.
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lead_tasks")
    .insert({
      lead_id: leadId,
      title: input.title.trim(),
      due_date: input.due_date,
      due_time: input.due_time || null,
      assigned_to: input.assigned_to || null,
      created_by: profile.id,
      company_id: profile.company_id,
    })
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Couldn't create that task — your role may not have permission." };
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

/**
 * The job's value, captured when the rep reports back from the visit.
 *
 * Recorded separately from the full lead form because it is entered at a
 * different moment by a different person: the rep who just stood in the
 * bathroom, not the office typing up a contact. Every money figure on
 * the pipeline is a sum of this column, so an appointment that comes
 * back without one leaves a hole in the forecast that nobody notices.
 */
export async function setLeadEstimatedValue(
  leadId: string,
  value: number
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!Number.isFinite(value) || value < 0) return { error: "Enter a value of 0 or more." };

  // leads_update admits Dispatch on their own or an unclaimed lead since
  // 0070, so a rep, the office and a dispatcher all take the same path.
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .update({ value })
    .eq("id", leadId)
    .eq("company_id", profile.company_id)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Couldn't save the value — your role may not have permission." };

  revalidatePath("/pipeline");
  revalidatePath("/calendar");
  return {};
}
