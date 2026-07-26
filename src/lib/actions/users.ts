"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AppRole } from "@/lib/data/types";

export async function createUser(input: {
  name: string;
  email: string;
  phone: string;
  password: string;
  roles: AppRole[];
}) {
  // Guard: only an Office user may create accounts. RLS protects the
  // profiles table itself, but user creation goes through the Admin API
  // (service role, bypasses RLS), so the check has to happen here.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { data: profile } = await supabase
    .from("profiles")
    .select("roles")
    .eq("id", user.id)
    .single();
  const roles = (profile as { roles: AppRole[] } | null)?.roles ?? [];
  if (!roles.includes("Office")) {
    return { error: "Only Office users can create accounts." };
  }

  const admin = createAdminClient();
  const { data: created, error } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { name: input.name },
  });
  if (error) return { error: error.message };

  const newUserId = created.user?.id;
  if (newUserId) {
    // handle_new_user trigger already inserted a bare profiles row;
    // fill in the rest.
    await admin
      .from("profiles")
      .update({ phone: input.phone || null, roles: input.roles })
      .eq("id", newUserId);
  }

  revalidatePath("/settings/users-roles");
  return {};
}

export async function updateUserRoles(userId: string, roles: AppRole[]) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ roles })
    .eq("id", userId);
  if (error) return { error: error.message };
  revalidatePath("/settings/users-roles");
  return {};
}

export async function toggleUserStatus(userId: string, currentStatus: string) {
  const supabase = await createClient();
  const nextStatus = currentStatus === "Active" ? "Archived" : "Active";
  const { error } = await supabase
    .from("profiles")
    .update({ status: nextStatus })
    .eq("id", userId);
  if (error) return { error: error.message };
  revalidatePath("/settings/users-roles");
  return {};
}
