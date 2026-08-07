"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { isAdminRole, isStrictAdmin, type AppRole } from "@/lib/data/types";

// User creation and profile edits (name/phone/email) go through the Admin
// API (service role, bypasses RLS) because changing a user's auth email
// requires it -- so the Office-or-Admin check has to happen here rather
// than relying on RLS alone.
async function requireOfficeOrAdmin(): Promise<
  { error: string } | { companyId: string; actorId: string; actorIsAdmin: boolean }
> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "Only Office or Admin users can do this." };
  return {
    companyId: profile.company_id,
    actorId: profile.id,
    actorIsAdmin: isStrictAdmin(profile),
  };
}

/**
 * Granting or removing Admin is itself an admin action.
 *
 * Office runs the company day to day, but the Admin role also unlocks the
 * views that report on people -- Team Activity, who's online, the
 * who-opened-this-lead trail. An Office user able to mint Admins can
 * promote themselves into all of it, so the check is on the change to
 * that one role rather than on editing roles generally.
 */
function adminRoleChangeBlocked(
  actorIsAdmin: boolean,
  before: AppRole[],
  after: AppRole[]
): string | null {
  const had = before.includes("Admin");
  const has = after.includes("Admin");
  if (had === has || actorIsAdmin) return null;
  return has
    ? "Only an Admin can grant the Admin role."
    : "Only an Admin can remove the Admin role.";
}

/**
 * True when this change would leave the company with nobody who can
 * administer it -- there would then be no way back in short of editing
 * the database by hand.
 */
const SUPER_ADMIN_LOCKED =
  "This account is protected and can't be changed from here.";

/**
 * The safety catch. A super admin keeps access no matter what anyone
 * does in the app -- including themselves, since the usual way to lock
 * yourself out is a misclick, not malice. Undoing it is a deliberate
 * database change.
 */
async function targetIsSuperAdmin(userId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("is_super_admin")
    .eq("id", userId)
    .maybeSingle();
  return (data as { is_super_admin: boolean | null } | null)?.is_super_admin === true;
}

/**
 * Shared check for actions that take an Admin's access away wholesale --
 * removing them from the company, or archiving them.
 */
async function adminTargetBlocked(
  guard: { companyId: string; actorIsAdmin: boolean },
  userId: string
): Promise<string | null> {
  const admin = createAdminClient();
  if (await targetIsSuperAdmin(userId)) return SUPER_ADMIN_LOCKED;

  const { data } = await admin
    .from("company_members")
    .select("roles")
    .eq("profile_id", userId)
    .eq("company_id", guard.companyId)
    .maybeSingle();
  const roles = ((data as { roles: AppRole[] } | null)?.roles ?? []) as AppRole[];
  if (!roles.includes("Admin")) return null;

  if (!guard.actorIsAdmin) return "Only an Admin can do this to another Admin.";
  if (await wouldStripLastAdmin(guard.companyId, userId, [])) {
    return "This is the only Admin left in this company — give someone else Admin first.";
  }
  return null;
}

async function wouldStripLastAdmin(
  companyId: string,
  userId: string,
  after: AppRole[]
): Promise<boolean> {
  if (after.includes("Admin")) return false;
  const admin = createAdminClient();
  const { data } = await admin
    .from("company_members")
    .select("profile_id, roles, status")
    .eq("company_id", companyId);
  const rows = (data as { profile_id: string; roles: AppRole[]; status: string }[] | null) ?? [];
  const active = rows.filter((r) => r.status === "Active");

  // A super admin administers the company whatever their roles say, so
  // one being a member means the company can never be left without an
  // administrator -- and this check should not block an ordinary role
  // edit on that basis.
  const { data: supers } = await admin
    .from("profiles")
    .select("id")
    .eq("is_super_admin", true)
    .in("id", active.map((r) => r.profile_id));
  const superIds = new Set(((supers as { id: string }[] | null) ?? []).map((p) => p.id));
  if (active.some((r) => superIds.has(r.profile_id) && r.profile_id !== userId)) return false;
  if (superIds.has(userId)) return false;

  const admins = active.filter((r) => (r.roles ?? []).includes("Admin"));
  return admins.length === 1 && admins[0].profile_id === userId;
}

export async function createUser(input: {
  name: string;
  email: string;
  phone: string;
  password: string;
  roles: AppRole[];
}): Promise<{ error?: string }> {
  const guard = await requireOfficeOrAdmin();
  if ("error" in guard) return guard;

  // Checked before the account is created, not after -- otherwise a
  // rejected role would leave an orphaned auth user behind.
  const roleBlock = adminRoleChangeBlocked(guard.actorIsAdmin, [], input.roles);
  if (roleBlock) return { error: roleBlock };

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
    // fill in identity fields, then grant them access to this company.
    await admin.from("profiles").update({ phone: input.phone || null }).eq("id", newUserId);
    await admin.from("company_members").insert({
      profile_id: newUserId,
      company_id: guard.companyId,
      roles: input.roles,
      can_delete_leads: false,
      status: "Active",
    });
  }

  revalidatePath("/settings/users-roles");
  return {};
}

export async function updateUserProfile(
  userId: string,
  input: { name: string; email: string; phone: string; password?: string }
): Promise<{ error?: string }> {
  const guard = await requireOfficeOrAdmin();
  if ("error" in guard) return guard;

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
  // This used to check only that someone was signed in, leaving the rest
  // to RLS -- and an RLS-blocked update matches zero rows without raising
  // anything, so a rejected change reported success and silently did
  // nothing.
  const guard = await requireOfficeOrAdmin();
  if ("error" in guard) return guard;

  // Deliberately no super-admin block here. is_super_admin grants Admin
  // access on its own, whatever the roles say, so editing them cannot
  // lock the account out -- and blocking it stopped the owner adding
  // themselves to Sales, which is an ordinary thing to want. Archiving
  // and removal do end access, and those stay blocked.
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("company_members")
    .select("roles")
    .eq("profile_id", userId)
    .eq("company_id", guard.companyId)
    .maybeSingle();
  const before = ((existing as { roles: AppRole[] } | null)?.roles ?? []) as AppRole[];

  const roleBlock = adminRoleChangeBlocked(guard.actorIsAdmin, before, roles);
  if (roleBlock) return { error: roleBlock };

  if (await wouldStripLastAdmin(guard.companyId, userId, roles)) {
    return {
      error: "This is the only Admin left in this company — give someone else Admin first.",
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_members")
    .update({ roles })
    .eq("profile_id", userId)
    .eq("company_id", guard.companyId)
    .select("profile_id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) {
    return { error: "That change couldn't be saved — your role may not have permission." };
  }
  revalidatePath("/settings/users-roles");
  revalidatePath("/", "layout");
  return {};
}

export async function updateCanDeleteLeads(
  userId: string,
  canDelete: boolean
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("company_members")
    .update({ can_delete_leads: canDelete })
    .eq("profile_id", userId)
    .eq("company_id", profile.company_id);
  if (error) return { error: error.message };
  revalidatePath("/settings/users-roles");
  return {};
}

export async function toggleUserStatus(
  userId: string,
  currentStatus: string
): Promise<{ error?: string }> {
  const guard = await requireOfficeOrAdmin();
  if ("error" in guard) return guard;

  const nextStatus = currentStatus === "Active" ? "Archived" : "Active";
  // Archiving an Admin takes their access away just as surely as removing
  // the role, so it goes through the same two checks.
  if (nextStatus === "Archived") {
    const block = await adminTargetBlocked(guard, userId);
    if (block) return { error: block };
  }

  const profile = { company_id: guard.companyId };
  const supabase = await createClient();
  const { error } = await supabase
    .from("company_members")
    .update({ status: nextStatus })
    .eq("profile_id", userId)
    .eq("company_id", profile.company_id);
  if (error) return { error: error.message };
  revalidatePath("/settings/users-roles");
  return {};
}

// Finding a user by email crosses the company boundary on purpose -- the
// whole point is to add someone who's currently in a *different* company
// (or no company at all) to this one, so profiles RLS (which only allows
// seeing people you already share a company with) would otherwise block
// discovering them at all. Only used to look someone up; the actual
// company_members insert below still goes through the normal RLS-checked
// client.
export async function findUserByEmail(
  email: string
): Promise<{ error?: string; user?: { id: string; name: string | null; email: string } }> {
  const guard = await requireOfficeOrAdmin();
  if ("error" in guard) return guard;

  const trimmed = email.trim();
  if (!trimmed) return { error: "Enter an email address." };

  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("id, name, email")
    .ilike("email", trimmed)
    .maybeSingle();
  const found = data as { id: string; name: string | null; email: string | null } | null;
  if (!found?.email) return { error: "No user found with that email." };

  const { data: existing } = await admin
    .from("company_members")
    .select("profile_id")
    .eq("profile_id", found.id)
    .eq("company_id", guard.companyId)
    .maybeSingle();
  if (existing) return { error: "This user is already a member of this company." };

  return { user: { id: found.id, name: found.name, email: found.email } };
}

export async function addUserToCompany(
  userId: string,
  roles: AppRole[]
): Promise<{ error?: string }> {
  const guard = await requireOfficeOrAdmin();
  if ("error" in guard) return guard;

  const roleBlock = adminRoleChangeBlocked(guard.actorIsAdmin, [], roles);
  if (roleBlock) return { error: roleBlock };

  const supabase = await createClient();
  const { error } = await supabase.from("company_members").insert({
    profile_id: userId,
    company_id: guard.companyId,
    roles,
    can_delete_leads: false,
    status: "Active",
  });
  if (error) {
    if (error.code === "23505") return { error: "This user is already a member of this company." };
    return { error: error.message };
  }

  revalidatePath("/settings/users-roles");
  return {};
}

export async function removeUserFromCompany(userId: string): Promise<{ error?: string }> {
  const guard = await requireOfficeOrAdmin();
  if ("error" in guard) return guard;

  if (userId === guard.actorId) {
    return { error: "You can't remove yourself from this company." };
  }

  // Removing someone takes their roles with them, so the same two rules
  // apply as to editing roles directly.
  const block = await adminTargetBlocked(guard, userId);
  if (block) return { error: block };

  const supabase = await createClient();
  const { error } = await supabase
    .from("company_members")
    .delete()
    .eq("profile_id", userId)
    .eq("company_id", guard.companyId);
  if (error) return { error: error.message };

  revalidatePath("/settings/users-roles");
  return {};
}
