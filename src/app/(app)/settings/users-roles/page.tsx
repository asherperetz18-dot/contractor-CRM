import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/data/types";
import { AdminGate } from "@/components/admin-gate";
import { UsersRolesTable } from "./users-roles-table";

export default async function UsersRolesPage() {
  const supabase = await createClient();
  const { data: users } = await supabase
    .from("profiles")
    .select("id, name, email, phone, roles, status, can_delete_leads, created_at")
    .order("created_at", { ascending: true });

  return (
    <AdminGate>
      <UsersRolesTable users={(users as Profile[]) ?? []} />
    </AdminGate>
  );
}
