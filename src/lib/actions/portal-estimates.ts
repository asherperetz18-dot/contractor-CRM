"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortalViewer } from "@/lib/portal/session";
import { advanceStageOnEstimateSigned } from "@/lib/pipeline/advance-stage";
import type { EstimateSigner, EstimateStatus } from "@/lib/data/types";

type EstimateRow = {
  id: string;
  lead_id: string;
  company_id: string;
  status: EstimateStatus;
  total_cents: number;
  expires_at: string | null;
};

/**
 * Loads an estimate on behalf of the signed-in customer.
 *
 * The portal has no Supabase Auth user, so every read here goes through
 * the service role and RLS cannot be the thing keeping customers apart.
 * This ownership check is that boundary: an estimate is only reachable if
 * it belongs to the lead the session cookie resolves to.
 */
async function loadForViewer(
  estimateId: string
): Promise<{ error: string } | { estimate: EstimateRow; leadId: string }> {
  const viewer = await getPortalViewer();
  if (!viewer) return { error: "Your sign-in link has expired. Request a new one." };

  const admin = createAdminClient();
  const { data } = await admin
    .from("estimates")
    .select("id, lead_id, company_id, status, total_cents, expires_at")
    .eq("id", estimateId)
    .maybeSingle<EstimateRow>();

  if (!data || data.lead_id !== viewer.lead.id) {
    // Deliberately the same message as a missing row: a distinct "not
    // yours" would confirm the id belongs to somebody.
    return { error: "That estimate isn't available." };
  }
  return { estimate: data, leadId: viewer.lead.id };
}

function expired(estimate: EstimateRow): boolean {
  if (!estimate.expires_at) return false;
  return new Date(`${estimate.expires_at}T23:59:59`).getTime() < Date.now();
}

/** Records that the customer opened the document. */
export async function markEstimateViewed(estimateId: string): Promise<void> {
  const loaded = await loadForViewer(estimateId);
  if ("error" in loaded) return;
  if (loaded.estimate.status !== "Sent") return;

  const admin = createAdminClient();
  await admin
    .from("estimates")
    .update({ status: "Viewed" as EstimateStatus, viewed_at: new Date().toISOString() })
    .eq("id", estimateId);
  revalidatePath("/estimates");
}

export async function signEstimateAsCustomer(
  estimateId: string,
  typedName: string
): Promise<{ error?: string; complete?: boolean }> {
  const name = typedName.trim();
  if (!name) return { error: "Type your full name to sign." };

  const loaded = await loadForViewer(estimateId);
  if ("error" in loaded) return loaded;
  const { estimate } = loaded;

  if (estimate.status === "Signed") return { error: "This estimate is already signed." };
  if (estimate.status === "Declined") return { error: "This estimate was declined." };
  if (expired(estimate)) {
    return { error: "This estimate has expired. Ask your contractor for an updated one." };
  }

  const admin = createAdminClient();
  const { data: signerRows } = await admin
    .from("estimate_signers")
    .select("*")
    .eq("estimate_id", estimateId)
    .order("sort_order", { ascending: true })
    .returns<EstimateSigner[]>();

  const signers = signerRows ?? [];
  const mine = signers.find((s) => s.party === "customer" && !s.signed_at);
  if (!mine) return { error: "There's nothing left for you to sign." };

  // Kept as evidence of who signed from where -- the whole point of an
  // e-signature is being able to show this later.
  const head = await headers();
  const ip =
    head.get("x-forwarded-for")?.split(",")[0]?.trim() || head.get("x-real-ip") || null;

  const now = new Date().toISOString();
  const { data: signed, error } = await admin
    .from("estimate_signers")
    .update({
      signed_at: now,
      signature_name: name,
      signature_ip: ip,
      signature_user_agent: head.get("user-agent"),
    })
    .eq("id", mine.id)
    .select("id");
  if (error) return { error: error.message };
  if (!signed?.length) return { error: "Could not record your signature." };

  // Only a fully signed document becomes a contract. With co-owners, one
  // signature leaves it pending rather than binding.
  const remaining = signers.filter((s) => s.id !== mine.id && !s.signed_at);
  if (remaining.length === 0) {
    await admin
      .from("estimates")
      .update({ status: "Signed" as EstimateStatus, signed_at: now })
      .eq("id", estimateId);

    // Won work outranks a merely sent estimate as the lead's value.
    await admin
      .from("leads")
      .update({ value: estimate.total_cents / 100 })
      .eq("id", estimate.lead_id);

    // A signed contract is won work, whatever the board still says. Left
    // to a rep to update by hand, this is exactly the step that gets
    // missed -- and a won job sitting in "Appointment Scheduled" is
    // missing from the pipeline's won figure.
    await advanceStageOnEstimateSigned(admin, estimate.lead_id, estimate.company_id);
  }

  revalidatePath("/estimates");
  revalidatePath("/pipeline");
  return { complete: remaining.length === 0 };
}

export async function declineEstimateAsCustomer(
  estimateId: string,
  reason: string
): Promise<{ error?: string }> {
  const loaded = await loadForViewer(estimateId);
  if ("error" in loaded) return loaded;
  const { estimate } = loaded;

  if (estimate.status === "Signed") return { error: "This estimate is already signed." };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("estimates")
    .update({
      status: "Declined" as EstimateStatus,
      declined_at: new Date().toISOString(),
      declined_reason: reason.trim() || null,
    })
    .eq("id", estimateId)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Could not record that." };

  revalidatePath("/estimates");
  return {};
}
