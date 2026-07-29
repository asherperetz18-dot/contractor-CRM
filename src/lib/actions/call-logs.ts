"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { getTwilioVoiceEnv } from "@/lib/twilio-env";

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
  const voiceEnv = getTwilioVoiceEnv();

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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { error } = await supabase
    .from("call_logs")
    .update({ disposition })
    .eq("id", callLogId);
  if (error) return { error: error.message };

  revalidatePath("/call-reports");
  revalidatePath("/dial-queue");
  return {};
}

export async function updateCallNotes(
  callLogId: string,
  notes: string
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { error } = await supabase.from("call_logs").update({ notes }).eq("id", callLogId);
  if (error) return { error: error.message };

  revalidatePath("/call-reports");
  return {};
}
