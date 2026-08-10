"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
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

  // Written as the signed-in user, so the insert policy decides. This
  // used to take the service role for dispatchers, because the policy
  // predated the Dispatch role and would have refused them; 0070 added
  // it, so the check belongs in one place again rather than being
  // half in the database and half here.
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lead_notes")
    .insert({
      lead_id: leadId,
      author_id: profile.id,
      body: trimmed,
      event_id: eventId || null,
      company_id: profile.company_id,
    })
    .select("id");
  if (error) return { error: error.message };
  // Row count as well as the error: an insert refused by policy raises,
  // but nothing else here would notice a write that quietly did nothing.
  if (!data?.length) return { error: "Couldn't save that note — your role may not have permission." };

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
