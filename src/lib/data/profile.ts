import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/data/types";

export type Profile = {
  id: string;
  name: string | null;
  email: string | null;
  roles: AppRole[];
  status: "Active" | "Archived";
  can_delete_leads: boolean;
  can_view_estimates: boolean;
  can_create_estimates: boolean;
  // Dispatch Supervisor: runs the desk -- whole book, new leads, new
  // sources, assigns dispatchers. Only meaningful with the Dispatch role.
  is_dispatch_supervisor?: boolean;
  // Mirrors profiles.is_super_admin -- see isSuperAdmin in data/types.
  is_super_admin?: boolean;
  company_id: string;
};

export const CURRENT_COMPANY_COOKIE = "current_company_id";

export type CompanyMembership = {
  company_id: string;
  company_name: string | null;
};

// Every active company the signed-in user belongs to, for the switcher
// and for resolving which one is "current." Wrapped in cache() so it's
// only fetched once per request even though multiple call sites need it.
export const getCurrentUserCompanies = cache(async (): Promise<CompanyMembership[]> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from("company_members")
    .select("company_id, companies(name)")
    .eq("profile_id", user.id)
    .eq("status", "Active");

  return ((data ?? []) as unknown as { company_id: string; companies: { name: string | null } | null }[]).map(
    (row) => ({ company_id: row.company_id, company_name: row.companies?.name ?? null })
  );
});

// Resolves which company is "current" for this request: the
// current_company_id cookie if it's set and the user is still a member,
// otherwise their first company. Returns null if the user belongs to no
// company at all.
export const getCurrentCompanyId = cache(async (): Promise<string | null> => {
  const memberships = await getCurrentUserCompanies();
  if (memberships.length === 0) return null;

  const cookieStore = await cookies();
  const cookieCompanyId = cookieStore.get(CURRENT_COMPANY_COOKIE)?.value;
  if (cookieCompanyId && memberships.some((m) => m.company_id === cookieCompanyId)) {
    return cookieCompanyId;
  }
  return memberships[0].company_id;
});

// company_members is the source of truth for roles/status/can_delete_leads
// as of the multi-company migration -- a person can hold different roles
// in different companies. profiles stays identity-only (name/email/phone).
export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const companyId = await getCurrentCompanyId();
  if (!companyId) return null;

  const [{ data: identityData }, { data: membershipData }] = await Promise.all([
    supabase.from("profiles").select("name, email, is_super_admin").eq("id", user.id).single(),
    supabase
      .from("company_members")
      .select("roles, status, can_delete_leads, can_view_estimates, can_create_estimates, is_dispatch_supervisor")
      .eq("profile_id", user.id)
      .eq("company_id", companyId)
      .single(),
  ]);
  const identity = identityData as {
    name: string | null;
    email: string | null;
    is_super_admin: boolean | null;
  } | null;
  const membership = membershipData as {
    roles: AppRole[];
    status: "Active" | "Archived";
    can_delete_leads: boolean;
    can_view_estimates: boolean;
    can_create_estimates: boolean;
    is_dispatch_supervisor: boolean;
  } | null;
  if (!membership) return null;

  return {
    id: user.id,
    name: identity?.name ?? null,
    email: identity?.email ?? null,
    roles: membership.roles,
    status: membership.status,
    can_delete_leads: membership.can_delete_leads,
    can_view_estimates: membership.can_view_estimates,
    can_create_estimates: membership.can_create_estimates,
    is_dispatch_supervisor: membership.is_dispatch_supervisor === true,
    is_super_admin: identity?.is_super_admin === true,
    company_id: companyId,
  };
});
