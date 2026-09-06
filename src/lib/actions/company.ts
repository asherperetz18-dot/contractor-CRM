"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { CURRENT_COMPANY_COOKIE, getCurrentProfile } from "@/lib/data/profile";
import { createCompanyWithDefaults } from "@/lib/signup/provision";
import { isAdminRole } from "@/lib/data/types";

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

async function setCurrentCompanyCookie(companyId: string) {
  const cookieStore = await cookies();
  cookieStore.set(CURRENT_COMPANY_COOKIE, companyId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
}

export async function switchCompany(companyId: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: member } = await supabase
    .from("company_members")
    .select("company_id")
    .eq("profile_id", user.id)
    .eq("company_id", companyId)
    .eq("status", "Active")
    .maybeSingle();
  if (!member) return { error: "You're not a member of that company." };

  await setCurrentCompanyCookie(companyId);
  revalidatePath("/", "layout");
  return {};
}

/**
 * The Settings -> New company button.
 *
 * The building itself now lives in lib/signup/provision.ts, shared with
 * the paid self-serve signup -- there is one answer to "what is a working
 * new company" and both doors walk through it. This function is what is
 * specific to this door: only an Office or Admin user may open it, the
 * new company is seeded from the one they are standing in, a clashing
 * name is reported rather than quietly suffixed, and they are switched
 * into it afterwards.
 */
export async function createCompany(name: string): Promise<{ error?: string; companyId?: string }> {
  const trimmed = name.trim();
  if (!trimmed) return { error: "Company name is required." };

  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "Only Office or Admin users can create a company." };

  const { companyId, error } = await createCompanyWithDefaults(trimmed, profile.id, {
    sourceCompanyId: profile.company_id,
    onNameClash: "fail",
  });
  if (!companyId) return { error: error ?? "Failed to create company." };

  await setCurrentCompanyCookie(companyId);
  revalidatePath("/", "layout");
  return { companyId };
}
