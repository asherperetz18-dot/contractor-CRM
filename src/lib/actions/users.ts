"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AppRole } from "@/lib/data/types";

// User creation and profile edits (name/phone/email) go through the Admin
// API (service role, bypasses RLS) because changing a user's auth email
// requires it -- so the Office-or-Admin check has to happen here rather
// than relying on RLS alone.
async function requireOfficeOrAdmin(): Promise<{ error: string } | null> {
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
  if (!roles.includes("Office") && !roles.includes("Admin")) {
    return { error: "Only Office or Admin users can do this." };
  }
  return null;
}

export async function createUser(input: {
  name: string;
  email: string;
  phone: string;
  password: string;
  roles: AppRole[];
}): Promise<{ error?: string }> {
  const guardError = await requireOfficeOrAdmin();
  if (guardError) return guardError;

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

export async function updateUserProfile(
  userId: string,
  input: { name: string; email: string; phone: string; password?: string }
): Promise<{ error?: string }> {
  const guardError = await requireOfficeOrAdmin();
  if (guardError) return guardError;

  if (input.password && input.password.length < 6) {
    return { error: "Password must be at least 6 characters." };
  }

  const admin = createAdminClient();

  const { data: current } = await admin
    .from("profiles")
    .select("email")
    .eq("id", userId)
    .single();
  const currentEmail = (current as { email: string | null } | null)?.email;

  const authUpdates: { email?: string; email_confirm?: boolean; password?: string } = {};
  if (input.email && input.email !== currentEmail) {
    authUpdates.email = input.email;
    authUpdates.email_confirm = true;
  }
  if (input.password) {
    authUpdates.password = input.password;
  }
  if (Object.keys(authUpdates).length > 0) {
    const { error: authError } = await admin.auth.admin.updateUserById(userId, authUpdates);
    if (authError) return { error: authError.message };
  }

  const { error } = await admin
    .from("profiles")
    .update({
      name: input.name || null,
      email: input.email || null,
      phone: input.phone || null,
    })
    .eq("id", userId);
  if (error) return { error: error.message };

  revalidatePath("/settings/users-roles");
  return {};
}

export async function updateUserRoles(
  userId: string,
  roles: AppRole[]
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ roles })
    .eq("id", userId);
  if (error) return { error: error.message };
  revalidatePath("/settings/users-roles");
  return {};
}

export async function updateCanDeleteLeads(
  userId: string,
  canDelete: boolean
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ can_delete_leads: canDelete })
    .eq("id", userId);
  if (error) return { error: error.message };
  revalidatePath("/settings/users-roles");
  return {};
}

export async function toggleUserStatus(
  userId: string,
  currentStatus: string
): Promise<{ error?: string }> {
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
