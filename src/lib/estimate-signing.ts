import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { portalBaseUrl } from "@/lib/portal/session";
import { notifyRepOfSignature } from "@/lib/portal/rep-signed-notification";
import { advanceStageOnEstimateSigned } from "@/lib/pipeline/advance-stage";
import { applyAutoChecklist } from "@/lib/checklist-auto";
import { sendEmail } from "@/lib/email-env";
import { getEmailForCompany } from "@/lib/email-company";
import type { EstimateStatus } from "@/lib/data/types";

export type SignableEstimate = {
  id: string;
  lead_id: string;
  company_id: string;
  total_cents: number;
  kind: string | null;
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
export async function reportSignatureToRep(
  admin: ReturnType<typeof createAdminClient>,
  estimate: SignableEstimate
): Promise<void> {
  const emailEnv = await getEmailForCompany(estimate.company_id);
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
    sendEmail: (to, subject, html, text) =>
      sendEmail(to, subject, html, text, { env: emailEnv ?? undefined }),
    docNumber: estimate.doc_number,
    kind: estimate.kind ?? "contract",
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
 * Everything that happens the moment a document becomes fully signed --
 * shared verbatim between the portal's e-signature and the staff
 * "signed on paper" action, so a paper contract can never behave
 * differently from a portal one downstream.
 *
 * signedAtIso is the legal signing moment (backdated for paper);
 * operational stamps -- when the remaining balance was requested --
 * stay at now(), because billing happened today even if the ink didn't.
 */
export async function finalizeSignedEstimate(
  admin: ReturnType<typeof createAdminClient>,
  estimate: SignableEstimate,
  signedAtIso: string
): Promise<void> {
  const now = new Date().toISOString();
  await admin
    .from("estimates")
    .update({ status: "Signed" as EstimateStatus, signed_at: signedAtIso })
    .eq("id", estimate.id);

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

    // The company's auto-apply checklist lands on the fresh contract,
    // its offset steps dated off the signature -- "file for permit in 3
    // days" exists before anyone opens the job. For a backdated paper
    // signature the offsets run from the paper date, which is when the
    // clock actually started. Never throws.
    await applyAutoChecklist(admin, estimate.company_id, estimate.id, signedAtIso);
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

  revalidatePath("/estimates");
  revalidatePath("/pipeline");
}
