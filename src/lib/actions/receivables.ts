"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { canManageBills } from "@/lib/data/types";

/**
 * Bills a phase: stamps it requested with a one-week due date. The
 * Billable Now tab's whole point -- work that is done or doable and
 * simply never asked for becomes an invoice in one click. Nothing is
 * sent to the customer; the balance appears on their portal, and
 * telling them stays a deliberate separate act.
 */
export async function requestPhaseNow(phaseId: string): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canManageBills(profile)) return { error: "Bookkeeping, Office or Admin only." };

  const now = new Date();
  const due = new Date(now);
  due.setDate(due.getDate() + 7);

  // Admin client behind the app gate: the estimate_payments write
  // policy belongs to the roles that EDIT documents, and Bookkeeping
  // rightly isn't one -- but billing an existing phase is collections,
  // not document editing, and it is exactly this page's job. The
  // company scope stays explicit.
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("estimate_payments")
    .update({
      requested_at: now.toISOString(),
      due_date: due.toISOString().slice(0, 10),
      updated_at: now.toISOString(),
    })
    .eq("id", phaseId)
    .eq("company_id", profile.company_id)
    .is("requested_at", null)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "That phase is already billed, or couldn't be found." };

  revalidatePath("/collect");
  revalidatePath("/payments");
  return {};
}
