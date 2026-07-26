import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { canDeleteLeads, canEditDispatch, type Lead, type Profile } from "@/lib/data/types";
import { ContactsTable } from "./contacts-table";

export default async function ContactsPage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const canWrite = canEditDispatch(profile);
  const canDelete = canDeleteLeads(profile);

  const [{ data: leads }, { data: reps }] = await Promise.all([
    supabase.from("leads").select("*").order("created_at", { ascending: false }),
    supabase
      .from("profiles")
      .select("id, name, email, phone, roles, status, can_delete_leads, created_at")
      .eq("status", "Active")
      .order("name", { ascending: true }),
  ]);

  return (
    <ContactsTable
      leads={(leads as Lead[]) ?? []}
      reps={(reps as Profile[]) ?? []}
      canWrite={canWrite}
      canDelete={canDelete}
    />
  );
}
