"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortalViewer, portalBaseUrl } from "@/lib/portal/session";
import { collectSignatureEvidence } from "@/lib/portal/signature-evidence";
import { notifyRepOfSignature } from "@/lib/portal/rep-signed-notification";
import { advanceStageOnEstimateSigned } from "@/lib/pipeline/advance-stage";
import { sendEmail } from "@/lib/email-env";
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

/**
 * Tells the assigned rep a document was fully signed, and logs server-side
 * (never surfaced to the customer) exactly why when it doesn't go out.
 * Production shipped this silently swallowing a real Resend failure:
 * sendEmail resolves with `{ error }` rather than throwing, and the caller
 * here never inspected that result, so a failed send and a successful one
 * looked identical from the outside. notifyRepOfSignature (the pure,
 * tested core of this) now returns which of those happened; this wrapper's
 * only job is to log it and supply the real Supabase lookup and sendEmail.
 */
async function reportSignatureToRep(
  admin: ReturnType<typeof createAdminClient>,
  estimate: EstimateRow
): Promise<void> {
  const result = await notifyRepOfSignature({
    assignedTo: estimate.assigned_to,
    lookupRep: async (profileId) => {
      const { data } = await admin
        .from("profiles")
        .select("email, name")
        .eq("id", profileId)
        .maybeSingle<{ email: string | null; name: string | null }>();
      return data ?? null;
    },
    sendEmail,
    docNumber: estimate.doc_number,
    kind: estimate.kind,
    link: `${portalBaseUrl()}/estimates/${estimate.id}`,
  });

  if (result.outcome !== "sent") {
    // Server logs only -- the signature already succeeded regardless of
    // whether the rep gets told, and nothing here ever includes the email
    // API key or its response body, only sendEmail's own safe message.
    const detail = "error" in result ? `: ${result.error}` : "";
    console.error(
      `[estimate ${estimate.id}] rep sign-notification not sent (${result.outcome}${detail})`
    );
  }
}

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
export async function markEstimateViewed(estimateId: string): Promise<void> {
  const loaded = await loadForViewer(estimateId);
  if ("error" in loaded) return;
  if (loaded.estimate.status !== "Sent") return;

  const admin = createAdminClient();
  await admin
    .from("estimates")
    .update({ status: "Viewed" as EstimateStatus, viewed_at: new Date().toISOString() })
    .eq("id", estimateId);
}

export async function signEstimateAsCustomer(
  estimateId: string,
  typedName: string,
  /** Completion certificates only: anything the customer wants put right. */
  customerItems?: string
): Promise<{ error?: string; complete?: boolean }> {
  const name = typedName.trim();
  if (!name) return { error: "Type your full name to sign." };

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

  const { data: signed, error } = await admin
    .from("estimate_signers")
    .update({
      signed_at: evidence.signedAt,
      signature_name: name,
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
          ? `${prior}\n\n${name}:\n${customerItems.trim()}`
          : customerItems.trim(),
      })
      .eq("id", estimateId);
  }

  // Only a fully signed document becomes a contract. With co-owners, one
  // signature leaves it pending rather than binding.
  const remaining = signers.filter((s) => s.id !== mine.id && !s.signed_at);
  if (remaining.length === 0) {
    await admin
      .from("estimates")
      .update({ status: "Signed" as EstimateStatus, signed_at: now })
      .eq("id", estimateId);

    if (estimate.kind === "completion" && estimate.parent_estimate_id) {
      // Accepting the work makes what is left of the contract due. Every
      // unbilled phase -- including any change order -- is marked billed
      // and dated, so the balance is on the customer's portal the moment
      // they accept rather than waiting on somebody to remember.
      //
      // No text goes out. Billing and telling them are separate acts, and
      // a pay link arriving while the contractor is still standing in
      // their kitchen reads as pushy.
      const due = new Date();
      due.setDate(due.getDate() + 7);
      await admin
        .from("estimate_payments")
        .update({
          requested_at: now,
          due_date: due.toISOString().slice(0, 10),
          updated_at: now,
        })
        .eq("estimate_id", estimate.parent_estimate_id)
        .is("requested_at", null);

      revalidatePath(`/estimates/${estimate.parent_estimate_id}`);
      revalidatePath("/payments");
    } else if (estimate.kind === "change_order" && estimate.parent_estimate_id) {
      // A signed change order becomes a payment phase on the contract it
      // belongs to, rather than editing the contract's own total. The
      // signed document is the record of what was agreed and must keep
      // saying so; the extra is billed alongside it.
      //
      // Appended to the end of the schedule, which is where extra work
      // falls due -- it is finished after everything already planned.
      const { data: phases } = await admin
        .from("estimate_payments")
        .select("sort_order")
        .eq("estimate_id", estimate.parent_estimate_id)
        .order("sort_order", { ascending: false })
        .limit(1)
        .returns<{ sort_order: number }[]>();

      await admin.from("estimate_payments").insert({
        company_id: estimate.company_id,
        estimate_id: estimate.parent_estimate_id,
        sort_order: (phases?.[0]?.sort_order ?? -1) + 1,
        name: estimate.doc_number,
        description: estimate.title || "Approved change order",
        // Not clamped at zero, unlike the schedule editor: a credit is a
        // real change order, and forcing it positive would turn money
        // owed back to the customer into money owed by them.
        amount_cents: Math.round(estimate.total_cents),
      });

      revalidatePath(`/estimates/${estimate.parent_estimate_id}`);
      revalidatePath("/payments");
    } else {
      // Won work outranks a merely sent estimate as the lead's value.
      // Not for a change order: the lead's value is what the job sold
      // for, and overwriting it with the extra alone would report a
      // $5,000 job as a $1,200 one.
      await admin
        .from("leads")
        .update({ value: estimate.total_cents / 100 })
        .eq("id", estimate.lead_id);
    }

    // A signed contract is won work, whatever the board still says. Left
    // to a rep to update by hand, this is exactly the step that gets
    // missed -- and a won job sitting in "Appointment Scheduled" is
    // missing from the pipeline's won figure.
    await advanceStageOnEstimateSigned(admin, estimate.lead_id, estimate.company_id);

    try {
      await reportSignatureToRep(admin, estimate);
    } catch (e) {
      // Swallowed on purpose -- see reportSignatureToRep's doc comment.
      // The signature above has already been committed regardless. This
      // only catches an unexpected throw (e.g. the profiles lookup itself
      // erroring); notifyRepOfSignature's own outcomes are never thrown.
      console.error(`[estimate ${estimate.id}] rep sign-notification threw`, e);
    }
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
