import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/data/types";

export type Profile = {
  id: string;
  name: string | null;
  email: string | null;
  roles: AppRole[];
  status: "Active" | "Archived";
  can_delete_leads: boolean;
};

export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, name, email, roles, status, can_delete_leads")
    .eq("id", user.id)
    .single();

  return profile as Profile | null;
});
