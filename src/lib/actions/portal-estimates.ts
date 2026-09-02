"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortalViewer, portalBaseUrl } from "@/lib/portal/session";
import { collectSignatureEvidence } from "@/lib/portal/signature-evidence";
import { finalizeSignedEstimate } from "@/lib/estimate-signing";
import { sendEmail } from "@/lib/email-env";
import { getEmailForCompany } from "@/lib/email-company";
import type { EstimateSigner, EstimateStatus } from "@/lib/data/types";

type EstimateRow = {
  id: string;
  lead_id: string;
  company_id: string;
  status: EstimateStatus;
  total_cents: number;
  expires_at: string | null;
  kind: string;
  parent_estimate_id: string | null;
  doc_number: string;
  title: string | null;
  assigned_to: string | null;
};

// The rep notification and every post-signature side effect now live in
// @/lib/estimate-signing, shared with the staff "signed on paper" action
// so the two signing paths can never drift apart.

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
    .select(
      "id, lead_id, company_id, status, total_cents, expires_at, kind, parent_estimate_id, doc_number, title, assigned_to"
    )
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

/**
 * Records that the customer opened the document.
 *
 * Called from the portal page's own render, which is why there is no
 * revalidatePath here: Next refuses one during a render and throws, so
 * the first time a customer opened anything still marked Sent, their
 * page failed with a server error. Every earlier test opened documents
 * that were already Signed, where this returns before reaching it.
 *
 * Nothing is lost by dropping it. The staff estimates list is rendered
 * dynamically on each request, so it picks the new status up on its next
 * load regardless.
 */
// Two rapid opens are one look, not two -- a customer refreshing, or the
// page re-rendering after a payment, must not inflate the count.
const VIEW_COLLAPSE_MINUTES = 5;

export async function markEstimateViewed(estimateId: string): Promise<void> {
  const loaded = await loadForViewer(estimateId);
  if ("error" in loaded) return;

  const admin = createAdminClient();

  // The full trail, not just the first open. "Viewed 5 times in two
  // days" is a customer deciding; "never opened since Sent" is a phone
  // call waiting to happen -- one timestamp cannot say either. Recorded
  // only from this portal path, so staff previews never count as
  // customer interest.
  const since = new Date(Date.now() - VIEW_COLLAPSE_MINUTES * 60000).toISOString();
  const { data: recent } = await admin
    .from("estimate_views")
    .select("id")
    .eq("estimate_id", estimateId)
    .gte("viewed_at", since)
    .limit(1);
  if (!recent?.length) {
    await admin.from("estimate_views").insert({
      estimate_id: estimateId,
      company_id: loaded.estimate.company_id,
    });
  }

  if (loaded.estimate.status !== "Sent") return;
  await admin
    .from("estimates")
    .update({ status: "Viewed" as EstimateStatus, viewed_at: new Date().toISOString() })
    .eq("id", estimateId);
}

export type CustomerSignature =
  | { type: "typed"; name: string }
  | { type: "drawn"; image: string };

/**
 * A drawn signature is a base64 PNG data URL from the portal's own canvas
 * (signature-pad.tsx), never larger than the sign panel it was drawn in.
 * Anything wildly bigger than that is not a real signature and is rejected
 * outright rather than stored -- the column has no length cap of its own,
 * and this is the one place free-form data from an unauthenticated portal
 * request lands directly in a text column.
 */
const MAX_SIGNATURE_IMAGE_BYTES = 300 * 1024;

function validSignatureImage(image: string): boolean {
  return (
    image.startsWith("data:image/png;base64,") &&
    image.length <= MAX_SIGNATURE_IMAGE_BYTES
  );
}

export async function signEstimateAsCustomer(
  estimateId: string,
  signature: CustomerSignature,
  /** Completion certificates only: anything the customer wants put right. */
  customerItems?: string
): Promise<{ error?: string; complete?: boolean }> {
  const image = signature.type === "drawn" ? signature.image : null;
  if (image !== null && !validSignatureImage(image)) {
    return { error: "That signature didn't come through. Please draw it again." };
  }
  const typedName = signature.type === "typed" ? signature.name.trim() : "";
  if (signature.type === "typed" && !typedName) return { error: "Type your full name to sign." };

  const loaded = await loadForViewer(estimateId);
  if ("error" in loaded) return loaded;
  const { estimate } = loaded;

  if (estimate.status === "Signed") return { error: "This estimate is already signed." };
  if (estimate.status === "Declined") return { error: "This estimate was declined." };
  // Void was missing here. A cancelled document was still signable by
  // anyone holding the link, and signing one is not harmless: a signed
  // change order appends a payment phase to its contract, so the company
  // would have billed for work it had already cancelled.
  if (estimate.status === "Void") {
    return { error: "This document was cancelled. Ask your contractor for an updated one." };
  }
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
  const now = new Date().toISOString();
  const evidence = collectSignatureEvidence(head, now);

  // A drawn signature is the mark, not a name the customer retyped -- it
  // is attributed to the name already on the document rather than asking
  // them to type it a second time on top of drawing it.
  const signedName = signature.type === "drawn" ? mine.name : typedName;

  const { data: signed, error } = await admin
    .from("estimate_signers")
    .update({
      signed_at: evidence.signedAt,
      signature_name: signedName,
      signature_image: image,
      signature_type: signature.type,
      signature_ip: evidence.ip,
      signature_user_agent: evidence.userAgent,
    })
    .eq("id", mine.id)
    .select("id");
  if (error) return { error: error.message };
  if (!signed?.length) return { error: "Could not record your signature." };

  // Recorded before the document is marked signed, and on the first
  // signature rather than the last: with co-owners, whoever signs first
  // must not lose what they raised. Appended rather than replaced for the
  // same reason -- a second owner's concerns are not a correction of the
  // first owner's.
  if (estimate.kind === "completion" && customerItems?.trim()) {
    const { data: existing } = await admin
      .from("estimates")
      .select("completion_customer_items")
      .eq("id", estimateId)
      .maybeSingle<{ completion_customer_items: string | null }>();
    const prior = existing?.completion_customer_items?.trim();
    await admin
      .from("estimates")
      .update({
        completion_customer_items: prior
          ? `${prior}\n\n${signedName}:\n${customerItems.trim()}`
          : customerItems.trim(),
      })
      .eq("id", estimateId);
  }

  // Only a fully signed document becomes a contract. With co-owners, one
  // signature leaves it pending rather than binding.
  const remaining = signers.filter((s) => s.id !== mine.id && !s.signed_at);
  if (remaining.length === 0) {
    await finalizeSignedEstimate(admin, estimate, now);
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
  // Declining a cancelled document would overwrite Void with Declined,
  // losing the record of who cancelled it and why.
  if (estimate.status === "Void") {
    return { error: "This document was cancelled, so there is nothing to decline." };
  }

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
