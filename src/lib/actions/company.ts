"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CURRENT_COMPANY_COOKIE, getCurrentProfile } from "@/lib/data/profile";
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

// Minimal company creation: name in, a working (empty) company out. Seeds
// pipeline stages / calendars / project types / lead sources / call
// dispositions by copying the creator's current company's rows, so a new
// company starts with the same defaults rather than nothing. Goes through
// the service-role admin client throughout -- a brand new company has no
// company_members row yet for RLS to check against.
export async function createCompany(name: string): Promise<{ error?: string; companyId?: string }> {
  const trimmed = name.trim();
  if (!trimmed) return { error: "Company name is required." };

  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "Only Office or Admin users can create a company." };

  const admin = createAdminClient();
  const sourceCompanyId = profile.company_id;

  const { data: company, error: companyError } = await admin
    .from("companies")
    .insert({ name: trimmed })
    .select("id")
    .single();
  if (companyError || !company) {
    return { error: companyError?.message ?? "Failed to create company." };
  }
  const newCompanyId = company.id as string;

  const [
    { data: sourceProfile },
    { data: pipelineStages },
    { data: calendars },
    { data: projectTypes },
    { data: leadSources },
    { data: dispositions },
  ] = await Promise.all([
    admin.from("company_profile").select("timezone, time_format").eq("company_id", sourceCompanyId).single(),
    admin.from("pipeline_stages").select("name, color, sort_order, is_system").eq("company_id", sourceCompanyId),
    admin.from("calendars").select("name, color, sort_order, is_system").eq("company_id", sourceCompanyId),
    admin.from("project_types").select("name, sort_order").eq("company_id", sourceCompanyId),
    admin.from("lead_sources").select("name, sort_order").eq("company_id", sourceCompanyId),
    admin.from("call_dispositions").select("name, color, sort_order, is_system").eq("company_id", sourceCompanyId),
  ]);

  await Promise.all([
    admin.from("company_profile").insert({
      company_id: newCompanyId,
      name: trimmed,
      timezone: sourceProfile?.timezone ?? "Pacific",
      time_format: sourceProfile?.time_format ?? "12h",
    }),
    admin.from("company_members").insert({
      profile_id: profile.id,
      company_id: newCompanyId,
      roles: ["Office", "Admin"],
      can_delete_leads: true,
      status: "Active",
    }),
    pipelineStages?.length
      ? admin.from("pipeline_stages").insert(pipelineStages.map((s) => ({ ...s, company_id: newCompanyId })))
      : Promise.resolve(),
    calendars?.length
      ? admin.from("calendars").insert(calendars.map((c) => ({ ...c, company_id: newCompanyId })))
      : Promise.resolve(),
    projectTypes?.length
      ? admin.from("project_types").insert(projectTypes.map((p) => ({ ...p, company_id: newCompanyId })))
      : Promise.resolve(),
    leadSources?.length
      ? admin.from("lead_sources").insert(leadSources.map((s) => ({ ...s, company_id: newCompanyId })))
      : Promise.resolve(),
    dispositions?.length
      ? admin.from("call_dispositions").insert(dispositions.map((d) => ({ ...d, company_id: newCompanyId })))
      : Promise.resolve(),
  ]);

  await setCurrentCompanyCookie(newCompanyId);
  revalidatePath("/", "layout");
  return { companyId: newCompanyId };
}
