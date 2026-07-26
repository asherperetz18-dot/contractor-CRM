import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/data/types";
import { UsersRolesTable } from "./users-roles-table";

export default async function UsersRolesPage() {
  const supabase = await createClient();
  const { data: users } = await supabase
    .from("profiles")
    .select("id, name, email, phone, roles, status, created_at")
    .order("created_at", { ascending: true });

  return <UsersRolesTable users={(users as Profile[]) ?? []} />;
}
