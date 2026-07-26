import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import type { Lead, Profile } from "@/lib/data/types";
import { ContactsTable } from "./contacts-table";

export default async function ContactsPage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const canWrite = profile?.roles.includes("Office") ?? false;

  const [{ data: leads }, { data: reps }] = await Promise.all([
    supabase.from("leads").select("*").order("created_at", { ascending: false }),
    supabase
      .from("profiles")
      .select("id, name, email, phone, roles, status, created_at")
      .eq("status", "Active")
      .order("name", { ascending: true }),
  ]);

  return (
    <ContactsTable
      leads={(leads as Lead[]) ?? []}
      reps={(reps as Profile[]) ?? []}
      canWrite={canWrite}
    />
  );
}
