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
  // No RETURNING on purpose. An insert the policy refuses raises loudly
  // on its own -- while asking for the row back additionally demands
  // SELECT visibility of it, which a sales-scoped rep noting a visit on
  // a colleague's customer doesn't have. Their note was being refused
  // for the crime of not being allowed to read it back.
  const { error } = await supabase.from("lead_notes").insert({
    lead_id: leadId,
    author_id: profile.id,
    body: trimmed,
    event_id: eventId || null,
    company_id: profile.company_id,
  });
  if (error) return { error: "Couldn't save that note — your role may not have permission." };

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
