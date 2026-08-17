"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTwilioVoiceForCompany } from "@/lib/twilio-company";
import { leadForPhoneNumber } from "@/lib/data/lead-for-number";
import { dispositionStageMove } from "@/lib/data/types";

export async function logCall(input: {
  leadId: string | null;
  toNumber: string;
  durationSeconds: number;
  twilioCallSid: string | null;
  status: string;
}): Promise<{ id?: string; error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  const voiceEnv = await getTwilioVoiceForCompany(profile.company_id);

  // A call placed from a lead card, the calendar or the dial queue
  // carries its lead. A number typed into the keypad carries nothing --
  // but the number itself is often already in the book, and the call
  // belongs on that customer's history whichever way it was dialled.
  // Inbound has always matched this way; outbound simply never did, so a
  // rep who typed a customer's number saw the call vanish from their card.
  const leadId =
    input.leadId ?? (await leadForPhoneNumber(supabase, profile.company_id, input.toNumber));

  const { data, error } = await supabase
    .from("call_logs")
    .insert({
      lead_id: leadId,
      rep_id: profile.id,
      direction: "outbound",
      from_number: voiceEnv?.phoneNumber ?? "",
      to_number: input.toNumber,
      status: input.status,
      duration_seconds: Math.max(0, Math.round(input.durationSeconds)),
      twilio_call_sid: input.twilioCallSid,
      company_id: profile.company_id,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  revalidatePath("/call-reports");
  revalidatePath("/dial-queue");
  return { id: (data as { id: string }).id };
}

export async function updateCallDisposition(
  callLogId: string,
  disposition: string
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  // Scoped to the caller's company and checked by row count. Matching on
  // id alone trusted whatever id arrived, and a server action is
  // reachable directly -- so a call belonging to another company was one
  // guessed uuid away from being relabelled.
  const { data, error } = await supabase
    .from("call_logs")
    .update({ disposition })
    .eq("id", callLogId)
    .eq("company_id", profile.company_id)
    .select("id, lead_id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "That call couldn't be updated." };

  // The outcome drives the lead, not just the log. Before this, a
  // disposition was written to a table nobody looks at and the lead sat
  // untouched on the pipeline -- "Not Interested" left it at "New Lead",
  // which made the buttons read as broken.
  const leadId = (data[0] as { lead_id: string | null }).lead_id;
  if (leadId) {
    await applyDispositionToLead(profile.company_id, profile.id, leadId, disposition);
  }

  revalidatePath("/call-reports");
  revalidatePath("/dial-queue");
  revalidatePath("/pipeline");
  return {};
}

/**
 * The pipeline consequences of a call outcome: a stage move, a
 * follow-up task, or nothing, as configured per disposition in
 * Settings → Call Dispositions.
 *
 * Runs with the service role, deliberately. The dialer is worked by
 * Call Center users, whose role cannot write leads under RLS -- but the
 * move isn't their discretion being exercised, it is a rule an Office
 * or Admin user configured on the disposition. The lead is verified to
 * belong to the caller's company first, and the rule itself
 * (dispositionStageMove) only ever advances leads still in the
 * pre-appointment stages.
 *
 * Failures here are logged, not returned: the disposition itself saved,
 * and telling the rep "that call couldn't be updated" when it was would
 * be false.
 */
async function applyDispositionToLead(
  companyId: string,
  callerId: string,
  leadId: string,
  dispositionName: string
) {
  const admin = createAdminClient();
  const { data: dispo } = await admin
    .from("call_dispositions")
    .select("move_to_stage, creates_followup_task")
    .eq("company_id", companyId)
    .eq("name", dispositionName)
    .maybeSingle<{ move_to_stage: string | null; creates_followup_task: boolean }>();
  if (!dispo) return;

  const { data: lead } = await admin
    .from("leads")
    .select("id, stage, company_id")
    .eq("id", leadId)
    .eq("company_id", companyId)
    .maybeSingle<{ id: string; stage: string; company_id: string }>();
  if (!lead) return;

  if (dispo.creates_followup_task) {
    const { error: taskError } = await admin.from("lead_tasks").insert({
      lead_id: leadId,
      title: "Call back",
      // Due today, so it lands on Follow-ups Due immediately rather
      // than surfacing tomorrow when the promise has gone stale.
      due_date: new Date().toISOString().slice(0, 10),
      assigned_to: callerId,
      created_by: callerId,
      company_id: companyId,
    });
    if (taskError) console.error("disposition follow-up task failed:", taskError.message);
  }

  if (dispo.move_to_stage) {
    const { data: stages } = await admin
      .from("pipeline_stages")
      .select("name")
      .eq("company_id", companyId);
    const target = dispositionStageMove({
      currentStage: lead.stage,
      moveToStage: dispo.move_to_stage,
      companyStages: (stages ?? []).map((s) => (s as { name: string }).name),
    });
    if (target) {
      const { error: moveError } = await admin
        .from("leads")
        .update({ stage: target })
        .eq("id", leadId)
        .eq("company_id", companyId);
      if (moveError) console.error("disposition stage move failed:", moveError.message);
    }
  }
}

export async function updateCallNotes(
  callLogId: string,
  notes: string
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("call_logs")
    .update({ notes })
    .eq("id", callLogId)
    .eq("company_id", profile.company_id)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "That call couldn't be updated." };

  revalidatePath("/call-reports");
  revalidatePath("/pipeline");
  return {};
}

export type LeadCall = {
  id: string;
  direction: string;
  status: string;
  duration_seconds: number;
  disposition: string;
  notes: string | null;
  created_at: string;
  repName: string | null;
  hasRecording: boolean;
};

/**
 * Every call on one contact, newest first.
 *
 * recording_url is deliberately not returned. It is a Twilio URL that
 * only Twilio's own credentials can open, so it is useless to the browser
 * and would only invite someone to link straight to it; the audio is
 * streamed through /api/voice/recording/[id], which checks the session
 * and uses that company's credentials.
 */
export async function getLeadCalls(
  leadId: string
): Promise<{ error?: string; calls?: LeadCall[] }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  const [{ data: rows, error }, members] = await Promise.all([
    supabase
      .from("call_logs")
      .select("id, direction, status, duration_seconds, disposition, notes, created_at, rep_id, recording_url")
      .eq("lead_id", leadId)
      .eq("company_id", profile.company_id)
      .order("created_at", { ascending: false })
      .returns<
        {
          id: string;
          direction: string;
          status: string;
          duration_seconds: number;
          disposition: string;
          notes: string | null;
          created_at: string;
          rep_id: string | null;
          recording_url: string | null;
        }[]
      >(),
    getCompanyMembers(profile.company_id),
  ]);
  if (error) return { error: error.message };

  const nameById = new Map(members.map((m) => [m.id, m.name || m.email || "Unnamed"]));
  return {
    calls: (rows ?? []).map((r) => ({
      id: r.id,
      direction: r.direction,
      status: r.status,
      duration_seconds: r.duration_seconds,
      disposition: r.disposition,
      notes: r.notes,
      created_at: r.created_at,
      repName: r.rep_id ? (nameById.get(r.rep_id) ?? null) : null,
      hasRecording: !!r.recording_url,
    })),
  };
}

/** The company's disposition list, for labelling a call from the card. */
export async function getCallDispositions(): Promise<string[]> {
  const profile = await getCurrentProfile();
  if (!profile) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("call_dispositions")
    .select("name")
    .eq("company_id", profile.company_id)
    .order("sort_order", { ascending: true })
    .returns<{ name: string }[]>();
  return (data ?? []).map((d) => d.name);
}
