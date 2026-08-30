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

/**
 * The signed-in user, fetched at most once per request.
 *
 * supabase.auth.getUser() is a network call: it re-validates the JWT
 * against the Auth API rather than trusting what is in the cookie. That
 * is the behaviour we want, but it was happening twice per render --
 * once here and once in getCurrentProfile() -- because each had its own
 * client. Two identical validations of the same token, each a round
 * trip from the function region to the database region.
 *
 * cache() makes the second caller reuse the first result for the life of
 * the request. It cannot dedupe against the proxy's own getUser(), which
 * runs in a separate edge invocation.
 *
 * getClaims() would remove the round trip entirely by verifying the JWT
 * locally, but only for projects on asymmetric signing keys; on a
 * symmetric (HS*) secret it falls back to getUser() internally, so it
 * would buy nothing here until the project migrates its JWT keys.
 */
const getAuthUserId = cache(async (): Promise<string | null> => {
  const supabase = await createClient();
  // getClaims, not getUser. getUser asks the Auth API to validate the
  // token over the network, every time; getClaims verifies the signature
  // here, against this project's public key, and only reaches out when
  // the key is not already cached. This project signs with ES256, so
  // that verification is genuinely local -- on a symmetric secret
  // getClaims falls back to getUser internally and nothing is saved.
  //
  // The trade is that a token stays good until it expires. Deleting a
  // user no longer cuts them off mid-token, but it does take their
  // company_members row with it, and every policy in the database reads
  // that row -- so they are locked out of all data at once, which is the
  // part that matters.
  const { data } = await supabase.auth.getClaims();
  return data?.claims?.sub ?? null;
});

// Every active company the signed-in user belongs to, for the switcher
// and for resolving which one is "current." Wrapped in cache() so it's
// only fetched once per request even though multiple call sites need it.
export const getCurrentUserCompanies = cache(async (): Promise<CompanyMembership[]> => {
  const userId = await getAuthUserId();
  if (!userId) return [];

  const supabase = await createClient();

  const { data } = await supabase
    .from("company_members")
    .select("company_id, companies(name)")
    .eq("profile_id", userId)
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
  const userId = await getAuthUserId();
  if (!userId) return null;

  const supabase = await createClient();

  const companyId = await getCurrentCompanyId();
  if (!companyId) return null;

  const [{ data: identityData }, { data: membershipData }] = await Promise.all([
    supabase.from("profiles").select("name, email, is_super_admin").eq("id", userId).single(),
    supabase
      .from("company_members")
      .select("roles, status, can_delete_leads, can_view_estimates, can_create_estimates, is_dispatch_supervisor")
      .eq("profile_id", userId)
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
    id: userId,
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
