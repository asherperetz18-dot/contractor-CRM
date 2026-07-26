import { createClient } from "@/lib/supabase/server";
import type { Lead, Profile } from "@/lib/data/types";
import { SalespeopleGrid } from "./salespeople-grid";

export default async function SalespeoplePage() {
  const supabase = await createClient();
  const [{ data: reps }, { data: leads }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, name, email, phone, roles, status, created_at")
      .order("name", { ascending: true }),
    supabase.from("leads").select("*"),
  ]);

  return (
    <SalespeopleGrid
      reps={(reps as Profile[]) ?? []}
      leads={(leads as Lead[]) ?? []}
    />
  );
}
