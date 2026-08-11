"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import { getTwilioVoiceForCompany } from "@/lib/twilio-company";

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

  const { data, error } = await supabase
    .from("call_logs")
    .insert({
      lead_id: input.leadId,
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
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "That call couldn't be updated." };

  revalidatePath("/call-reports");
  revalidatePath("/dial-queue");
  revalidatePath("/pipeline");
  return {};
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
