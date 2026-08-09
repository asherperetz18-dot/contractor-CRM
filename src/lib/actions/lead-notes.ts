"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dispatcherMayWriteToLead } from "@/lib/dispatcher-access";
import { getCurrentProfile } from "@/lib/data/profile";

export async function addLeadNote(
  leadId: string,
  body: string,
  eventId?: string | null
): Promise<{ error?: string }> {
  const trimmed = body.trim();
  if (!trimmed) return { error: "Note can't be empty." };

  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  // A dispatcher works the lead they are paid on, but the insert policy
  // still admits only Office, Sales and Field -- so their own note is
  // written with the service role after an explicit ownership check.
  const asDispatcher = await dispatcherMayWriteToLead(profile, leadId, profile.company_id);
  const supabase = asDispatcher ? createAdminClient() : await createClient();
  const { error } = await supabase.from("lead_notes").insert({
    lead_id: leadId,
    author_id: profile.id,
    body: trimmed,
    event_id: eventId || null,
    company_id: profile.company_id,
  });
  if (error) return { error: error.message };

  revalidatePath("/pipeline");
  revalidatePath("/contacts");
  revalidatePath("/calendar");
  return {};
}

export async function deleteLeadNote(id: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.from("lead_notes").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/pipeline");
  revalidatePath("/contacts");
  revalidatePath("/calendar");
  return {};
}
