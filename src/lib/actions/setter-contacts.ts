"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";

export async function assignSetterContact(setterId: string, leadId: string) {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("setter_contacts")
    .insert({ setter_id: setterId, lead_id: leadId, company_id: profile.company_id });
  if (error) return { error: error.message };
  revalidatePath("/appt-setter-assignments");
  return {};
}

export async function unassignSetterContact(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("setter_contacts").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/appt-setter-assignments");
  return {};
}
