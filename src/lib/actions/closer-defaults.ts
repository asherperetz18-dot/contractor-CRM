"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { isAdminRole } from "@/lib/data/types";

/**
 * The company's starting closer share, in basis points (500 = 5%).
 *
 * Its own file rather than an addition to rep-commission.ts: this is the
 * company default behind leads.closer_bp, and it is read and written by
 * one screen. The commission and lead-cost defaults next to it on that
 * screen keep their own action, untouched.
 *
 * A share of NET PROFIT, the same base the rep commission uses -- not a
 * share of the contract. See migration 0135 for the conversion into the
 * pool split a signed contract actually carries.
 */
export async function getCloserDefault(): Promise<{ default_closer_bp: number }> {
  const profile = await getCurrentProfile();
  if (!profile) return { default_closer_bp: 500 };

  const supabase = await createClient();
  const { data } = await supabase
    .from("company_profile")
    .select("default_closer_bp")
    .eq("company_id", profile.company_id)
    .maybeSingle<{ default_closer_bp: number | null }>();

  // 500 is the column default from migration 0134. Repeated here so a
  // company with no row yet sees the same 5% the database would give it,
  // rather than a blank box reading as "closers are not paid".
  return { default_closer_bp: data?.default_closer_bp ?? 500 };
}

export async function saveCloserDefault(
  closerBp: number
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) {
    return { error: "Only Office or Admin can change company defaults." };
  }

  const value = Math.round(Number(closerBp) || 0);
  if (value < 0) return { error: "A closer share can't be negative." };
  // 10000bp is the whole of net profit. Anything at or above it would
  // hand the closer every penny of profit and leave the rep -- and the
  // company -- on nothing, which is a typo rather than a policy.
  if (value >= 10000) {
    return { error: "A closer share has to be under 100% of net profit." };
  }

  const { data, error } = await supabase_update(profile.company_id, value);
  if (error) return { error };
  if (!data) return { error: "Couldn't save the closer default." };

  revalidatePath("/settings/sales-commission");
  return {};
}

// Split out so the guard clauses above read as one list rather than
// being interrupted by the query.
async function supabase_update(
  companyId: string,
  value: number
): Promise<{ data?: boolean; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_profile")
    .update({ default_closer_bp: value })
    .eq("company_id", companyId)
    .select("company_id")
    .returns<{ company_id: string }[]>();
  if (error) return { error: error.message };
  return { data: !!data?.length };
}
