import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getSigningKeys } from "@/lib/supabase/jwks";
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
  // Send Estimates switch -- see canSendEstimates in data/types.
  can_send_estimates: boolean;
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
 * The signed-in user, worked out at most once per request and without
 * leaving the machine.
 *
 * This was getUser(), which hands the token to the Auth API and waits to
 * be told it is valid -- a network call, and it happened twice per
 * render because this function and getCurrentProfile() each had their
 * own client. cache() collapsed those two into one. getClaims() then
 * removed the call itself: the token is signed with ES256 and the
 * matching public key is published, so the signature is checked here.
 *
 * The key set is passed in rather than left to supabase-js to fetch.
 * supabase-js caches it on the client object and this app builds a
 * fresh client per request, so its cache was always cold and it went
 * back to Supabase for the same unchanging document every time. See
 * lib/supabase/jwks.ts.
 */
const getAuthUserId = cache(async (): Promise<string | null> => {
  const supabase = await createClient();
  // The trade is that a token stays good until it expires. Deleting a
  // user no longer cuts them off mid-token, but it does take their
  // company_members row with it, and every policy in the database reads
  // that row -- so they are locked out of all data at once, which is the
  // part that matters.
  const { data } = await supabase.auth.getClaims(undefined, {
    jwks: await getSigningKeys(),
  });
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
    // Every column rather than a list of them. Naming a column that is
    // not there yet (can_send_estimates before migration 0126 has run)
    // fails the whole select, and a failed select here signs everyone
    // out. With "*" a missing column simply reads as undefined, which
    // the mapping below treats as the column's default.
    supabase
      .from("company_members")
      .select("*")
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
    can_send_estimates?: boolean;
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
    // Default true, matching the column: only an explicit false restricts.
    can_send_estimates: membership.can_send_estimates !== false,
    is_dispatch_supervisor: membership.is_dispatch_supervisor === true,
    is_super_admin: identity?.is_super_admin === true,
    company_id: companyId,
  };
});
