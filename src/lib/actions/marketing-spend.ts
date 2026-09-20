"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { monthKey } from "@/lib/data/marketing-spend";
import { isAdminRole } from "@/lib/data/types";

async function requireOfficeOrAdmin(): Promise<
  { error: string } | { companyId: string; profileId: string }
> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "Only Office or Admin users can enter marketing spend." };
  return { companyId: profile.company_id, profileId: profile.id };
}

function revalidate() {
  revalidatePath("/settings/lead-sources");
  revalidatePath("/marketing-analytics");
}

/** The pre-migration error, said in words the owner can act on. */
function explain(message: string, table: string): string {
  return /relation|column|schema cache|does not exist/i.test(message)
    ? `${table} isn't set up yet: run migration 0165_marketing_spend.sql in the Supabase SQL editor.`
    : message;
}

/**
 * What a source cost in a calendar month, in cents. One row per source
 * per month; saving again replaces the amount.
 */
export async function saveMarketingSpend(
  source: string,
  /** YYYY-MM or any day in the month. */
  month: string,
  amountCents: number,
  note?: string | null
): Promise<{ error?: string }> {
  const guard = await requireOfficeOrAdmin();
  if ("error" in guard) return guard;

  const name = source.trim();
  if (!name) return { error: "Choose a source." };
  if (!/^\d{4}-\d{2}(-\d{2})?$/.test(month)) return { error: "Pick a month." };
  const cents = Math.round(Number(amountCents));
  if (!Number.isFinite(cents) || cents < 0) return { error: "Spend must be zero or more." };

  const supabase = await createClient();
  const { error } = await supabase.from("marketing_spend").upsert(
    {
      company_id: guard.companyId,
      source: name,
      month: monthKey(month),
      amount_cents: cents,
      note: note?.trim() || null,
      updated_by: guard.profileId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "company_id,source,month" }
  );
  if (error) return { error: explain(error.message, "Spend tracking") };
  revalidate();
  return {};
}

/** Marks a source as a purchased list, so Marketing Analytics can switch it off. */
export async function setSourceBoughtList(
  id: string,
  boughtList: boolean
): Promise<{ error?: string }> {
  const guard = await requireOfficeOrAdmin();
  if ("error" in guard) return guard;

  const supabase = await createClient();
  const { error } = await supabase
    .from("lead_sources")
    .update({ bought_list: boughtList })
    .eq("id", id)
    .eq("company_id", guard.companyId);
  if (error) return { error: explain(error.message, "The bought-list flag") };
  revalidate();
  return {};
}
