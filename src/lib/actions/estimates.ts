"use server";

import { addDays } from "@/lib/company-clock";
import { companyToday } from "@/lib/data/company-today";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { collectSignatureEvidence } from "@/lib/portal/signature-evidence";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTwilioSms } from "@/lib/twilio-env";
import { getTwilioForCompany } from "@/lib/twilio-company";
import { getEmailForCompany } from "@/lib/email-company";
import { createLoginToken, portalAccessExpiry, portalBaseUrl } from "@/lib/portal/session";
import { getCurrentProfile } from "@/lib/data/profile";
import { advanceStageOnEstimateSent } from "@/lib/pipeline/advance-stage";
import { finalizeSignedEstimate } from "@/lib/estimate-signing";
import { fillContract, lateContractValues } from "@/lib/contracts/merge";
import { sendEmail, escapeHtml } from "@/lib/email-env";
import { resolveEstimateRecipients } from "@/lib/estimate-recipients";
import { closerHoldsSend, closerHoldMessage } from "@/lib/estimate-closer-gate";
import { approvalOnSend, approvalHoldMessage, selfApprovalNote } from "@/lib/estimate-approval-gate";
import { defaultEstimateNarrative, paragraphsToHtml } from "@/lib/estimate-email-copy";
import {
  balanceAfterDepositCents,
  canCreateEstimates,
  canSendEstimates,
  canDeleteEstimateStatus,
  canDeleteLeads,
  isAdminRole,
  canViewEstimates,
  leadAfterContractVoid,
  isStrictAdmin,
  depositCents,
  editWillRecallEstimate,
  estimateLocked,
  isPricelessKind,
  DEFAULT_PAYMENT_PHASES,
  splitEvenlyCents,
  computeEstimateTotals,
  lineTotalCents,
  parseQuantity,
  paidTotalCents,
  type EstimateStatus,
} from "@/lib/data/types";

type LeadRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  assigned_to: string | null;
  company_id: string;
};

type SettingsRow = {
  tax_rate_bp: number;
  estimate_expiry_days: number;
  estimate_terms: string | null;
};

type ItemsEstimateRow = {
  id: string;
  lead_id: string;
  status: EstimateStatus;
  version: number;
  tax_rate_bp: number;
  deposit_percent_bp: number;
  deposit_cap_cents: number;
  discount_type: string | null;
  discount_value: number;
  discount_label: string | null;
};

/** What the builder sends for the document-level discount. Null clears
 *  it; undefined leaves whatever is stored untouched. */
export type DiscountInput = {
  type: "percent" | "amount";
  value: number;
  label: string | null;
} | null;

function cleanDiscount(input: DiscountInput): DiscountInput {
  if (!input) return null;
  if (input.type !== "percent" && input.type !== "amount") return null;
  const value = Math.max(0, Math.round(Number(input.value) || 0));
  // A percent discount past 100% is a typo, not a strategy.
  if (input.type === "percent" && value > 10000) return { ...input, value: 10000, label: input.label };
  return { type: input.type, value, label: input.label?.trim().slice(0, 120) || null };
}

type SendToCustomerRow = {
  id: string;
  lead_id: string;
  company_id: string;
  status: EstimateStatus;
  total_cents: number;
  kind: string | null;
  doc_number: string;
  title: string;
};

type EstimateEmailCompany = {
  name: string;
  dba: string | null;
  address: string | null;
  website: string | null;
  licenseNumber: string | null;
};

/**
 * The customer-facing proposal email. Every value here can come from a
 * public lead form, a rep's free text, or a company's own settings --
 * none of it is system-generated except docNumber and the amount and
 * link this module builds itself -- so all of it is escaped for the HTML
 * version rather than picking and choosing which fields to trust.
 *
 * The wording is the client's own template, adjusted only where it
 * assumed a PDF attachment -- this app has no PDF generation, so the
 * customer's copy of record is the portal link, which is also where they
 * sign.
 */
function buildEstimateEmail(params: {
  customerName: string | null;
  company: EstimateEmailCompany;
  docNumber: string;
  title: string | null;
  projectAddress: string | null;
  totalCents: number;
  link: string;
  /** A rep's own message, replacing the default 3-paragraph narrative --
   *  the greeting, CTA link, sign-off, footer and disclaimer are never
   *  affected by this, so a customized message can't accidentally drop
   *  the link or the required footer/disclaimer. */
  narrative?: string;
}) {
  const { customerName, company, docNumber, title, projectAddress, totalCents, link } = params;
  const greeting = customerName || "there";
  const subject = `${company.name}: your proposal ${docNumber} is ready to review`;
  const narrative =
    params.narrative?.trim() ||
    defaultEstimateNarrative({ companyName: company.name, docNumber, title, projectAddress, totalCents });

  const safe = {
    greeting: escapeHtml(greeting),
    companyName: escapeHtml(company.name),
    link: escapeHtml(link),
    dba: company.dba ? escapeHtml(company.dba) : null,
    address: company.address ? escapeHtml(company.address) : null,
    website: company.website ? escapeHtml(company.website) : null,
    licenseNumber: company.licenseNumber ? escapeHtml(company.licenseNumber) : null,
  };

  const disclaimer =
    "This communication, including attachments, is for the exclusive use of the addressee and " +
    "may contain proprietary, confidential or privileged information. If you are not the intended " +
    "recipient, any use, copying, disclosure, dissemination or distribution is strictly prohibited. " +
    "If you are not the intended recipient, please notify the sender immediately by return email " +
    "and delete this communication and destroy all copies.";

  const textFooterLines = [
    company.name,
    ...(company.address ? [company.address] : []),
    ...(company.website ? [company.website] : []),
    ``,
    ...(company.dba ? [`• Dba: ${company.dba}`] : []),
    ...(company.licenseNumber ? [`• License: #${company.licenseNumber}`] : []),
  ];

  const htmlFooterLines = [
    ...(safe.address ? [`<p style="margin:0">${safe.address}</p>`] : []),
    ...(safe.website ? [`<p style="margin:0">${safe.website}</p>`] : []),
    ...(safe.dba || safe.licenseNumber
      ? [
          `<ul style="margin:10px 0 0;padding-left:18px;color:#444">`,
          ...(safe.dba ? [`<li>Dba: ${safe.dba}</li>`] : []),
          ...(safe.licenseNumber ? [`<li>License: #${safe.licenseNumber}</li>`] : []),
          `</ul>`,
        ]
      : []),
  ];

  return {
    subject,
    text: [
      `Hi ${greeting},`,
      ``,
      narrative,
      ``,
      `Review & Sign:`,
      link,
      ``,
      `If you have any questions about the proposal or would like to discuss any changes, please feel free to reach out.`,
      ``,
      `Thank you,`,
      ...textFooterLines,
      ``,
      disclaimer,
    ].join("\n"),
    // The CTA is a real button: its visible text is the fixed label
    // "Review & Sign", never the link itself. The secure, single-use
    // token lives only in href, where a customer forwarding or
    // screen-sharing this email won't read it off the page by accident.
    html: `
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;line-height:1.5;color:#1a1a1a">
      <p>Hi ${safe.greeting},</p>
      ${paragraphsToHtml(narrative)}
      <p><a href="${safe.link}" style="display:inline-block;background:#C2410C;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">Review &amp; Sign</a></p>
      <p>If you have any questions about the proposal or would like to discuss any changes, please feel free to reach out.</p>
      <p style="margin:16px 0 2px">Thank you,<br><strong>${safe.companyName}</strong></p>
      ${htmlFooterLines.join("\n      ")}
      <p style="color:#888;font-size:11px;margin-top:24px;border-top:1px solid #eee;padding-top:12px">${escapeHtml(disclaimer)}</p>
    </div>
  `,
  };
}

type PaymentEstimateRow = {
  id: string;
  status: EstimateStatus;
  version: number;
  total_cents: number;
  deposit_percent_bp: number;
  deposit_cap_cents: number;
};

type SendEstimateRow = {
  id: string;
  lead_id: string;
  status: EstimateStatus;
  total_cents: number;
  kind: string | null;
};

export type ItemInput = {
  /** The existing row, when this line is already saved. Carrying it is
   *  what stops a save from destroying anything that points at the line. */
  id?: string | null;
  name: string;
  description?: string | null;
  quantity: number;
  unit?: string | null;
  unit_price_cents: number;
  taxable: boolean;
  cost_cents?: number | null;
  group_id?: string | null;
  /** Offered as an add-on the customer ticks in the portal. */
  is_optional?: boolean;
};

async function requireEstimateEditor(): Promise<
  { error: string } | { companyId: string; userId: string }
> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canCreateEstimates(profile))
    return { error: "You don't have permission to create or edit estimates." };
  return { companyId: profile.company_id, userId: profile.id };
}

// The same message everywhere a drafts-only person tries to send. Not
// exported: a "use server" file may only export async functions.
const SEND_NOT_ALLOWED =
  "You can save this as a draft, but sending it is turned off for your account — ask the office to send it.";

/**
 * The closer's hold on a document leaving Draft. Null when this user
 * may send; otherwise the message to show them.
 *
 * Lives here, in the server actions, rather than as a trigger like the
 * approval gate (0136): the actual send updates status through the
 * service-role client, where auth.uid() is null and a trigger cannot
 * tell a rep from the closer. Every path out of Draft already runs
 * through these guards, so this is the choke point.
 */
async function closerHoldError(
  profile: NonNullable<Awaited<ReturnType<typeof getCurrentProfile>>>,
  estimateId: string
): Promise<string | null> {
  // Office and Admin are never held, and skipping the lookups keeps the
  // common case (the office sends) at zero extra queries.
  if (isAdminRole(profile)) return null;

  const supabase = await createClient();
  const { data: estimate } = await supabase
    .from("estimates")
    .select("id, lead_id, kind")
    .eq("id", estimateId)
    .eq("company_id", profile.company_id)
    .maybeSingle<{ id: string; lead_id: string | null; kind: string | null }>();
  if (!estimate?.lead_id) return null;

  const { data: lead } = await supabase
    .from("leads")
    .select("closer_id")
    .eq("id", estimate.lead_id)
    .maybeSingle<{ closer_id: string | null }>();

  const held = closerHoldsSend({
    closerId: lead?.closer_id ?? null,
    userId: profile.id,
    officeOrAdmin: false,
    kind: estimate.kind,
  });
  if (!held) return null;

  const { data: closer } = await supabase
    .from("profiles")
    .select("name, email")
    .eq("id", lead!.closer_id!)
    .maybeSingle<{ name: string | null; email: string | null }>();
  return closerHoldMessage(closer?.name || closer?.email || null);
}

/**
 * The approval gate on a document leaving Draft (0136). An error when
 * the document may not go; otherwise whether this send approves it in
 * the sender's name (Send Without Approval, 0179).
 *
 * The trigger enforces the same rule on the status change -- but the
 * send action emails or texts the customer BEFORE it changes the
 * status, so a refusal there arrives after the link is already in their
 * inbox: the message went out, the document stayed a Draft, the board
 * said "never sent", and the link the customer holds is turned away by
 * the portal. Asked here first, nothing goes out.
 */
async function approvalGate(
  companyId: string,
  estimateId: string,
  sender: { canApprove: boolean; sendsWithoutApproval: boolean }
): Promise<{ error: string } | { selfApprove: boolean }> {
  const admin = createAdminClient();
  const [{ data: company }, { data: doc }] = await Promise.all([
    admin
      .from("company_profile")
      .select("require_estimate_approval")
      .eq("company_id", companyId)
      .maybeSingle<{ require_estimate_approval: boolean | null }>(),
    admin
      .from("estimates")
      .select("doc_number, approved_at")
      .eq("id", estimateId)
      .eq("company_id", companyId)
      .maybeSingle<{ doc_number: string | null; approved_at: string | null }>(),
  ]);
  const decision = approvalOnSend({
    approvalRequired: company?.require_estimate_approval === true,
    approvedAt: doc?.approved_at ?? null,
    sendsWithoutApproval: sender.sendsWithoutApproval,
  });
  if (decision === "hold") {
    return { error: approvalHoldMessage(doc?.doc_number ?? null, { canApprove: sender.canApprove }) };
  }
  return { selfApprove: decision === "self-approve" };
}

/**
 * A trusted sender's send approves the document in their name, just
 * before its status changes -- the 0136 trigger lets a document out of
 * Draft once approved_at is set -- and says so on the contact, the same
 * record an admin's approval leaves.
 */
async function recordSelfApproval(input: {
  companyId: string;
  estimateId: string;
  leadId: string | null;
  docNumber: string | null;
  userId: string;
  senderName: string | null;
}): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("estimates")
    .update({ approved_at: new Date().toISOString(), approved_by: input.userId })
    .eq("id", input.estimateId)
    .eq("company_id", input.companyId)
    .eq("status", "Draft")
    .is("approved_at", null);
  if (input.leadId) {
    await admin.from("lead_notes").insert({
      company_id: input.companyId,
      lead_id: input.leadId,
      author_id: input.userId,
      body: selfApprovalNote(input.docNumber, input.senderName),
    });
  }
}

type EstimateSender = {
  companyId: string;
  userId: string;
  senderName: string | null;
  canApprove: boolean;
  sendsWithoutApproval: boolean;
};

// An editor who also holds the Send Estimates switch, and -- on a lead
// with a closer -- the closer themselves (or Office/Admin). Guards
// everything that takes a document out of Draft: texting or emailing it,
// marking it sent, recording a paper signature. The send itself happens
// here on the server, so this check -- not the hidden buttons -- is the
// permission.
async function requireEstimateSender(
  estimateId: string
): Promise<{ error: string } | EstimateSender> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canCreateEstimates(profile))
    return { error: "You don't have permission to create or edit estimates." };
  if (!canSendEstimates(profile)) return { error: SEND_NOT_ALLOWED };
  const hold = await closerHoldError(profile, estimateId);
  if (hold) return { error: hold };
  return {
    companyId: profile.company_id,
    userId: profile.id,
    senderName: profile.name || profile.email || null,
    canApprove: isStrictAdmin(profile),
    sendsWithoutApproval: profile.can_send_without_approval,
  };
}

// The detail route is /estimates/<estimate id>. Pipeline is refreshed too
// because sending an estimate rewrites the lead's value, which every
// money figure on that page is derived from.
function revalidateEstimates(estimateId?: string | null) {
  revalidatePath("/estimates");
  revalidatePath("/pipeline");
  if (estimateId) revalidatePath(`/estimates/${estimateId}`);
}

/** The rep's name for the contract's signature block. */
async function repDisplayName(
  supabase: Awaited<ReturnType<typeof createClient>>,
  profileId: string | null
): Promise<string> {
  if (!profileId) return "";
  const { data } = await supabase
    .from("profiles")
    .select("name, email")
    .eq("id", profileId)
    .maybeSingle<{ name: string | null; email: string | null }>();
  return data?.name || data?.email || "";
}

/**
 * Fills the money into a contract at the point it is sent.
 *
 * Price tokens cannot resolve when an estimate is created -- nothing has
 * been priced yet, so a total merged in then would read $0.00 on every
 * contract ever sent. fillContract leaves an unresolved token standing,
 * so the frozen text still carries {{contract_total}} until this runs and
 * replaces it with the figure the customer is actually agreeing to.
 */
async function fillContractMoney(estimateId: string, companyId: string): Promise<void> {
  // Its own client rather than the caller's: the two send paths use
  // different ones, and the caller has already established who may do
  // this. Scoped to the company on every statement regardless.
  const supabase = createAdminClient();
  const { data: est } = await supabase
    .from("estimates")
    .select(
      "terms, total_cents, deposit_cents, deposit_percent_bp, deposit_cap_cents, start_date, completion_date"
    )
    .eq("id", estimateId)
    .eq("company_id", companyId)
    .maybeSingle<{
      terms: string | null;
      total_cents: number;
      deposit_cents: number | null;
      deposit_percent_bp: number;
      deposit_cap_cents: number;
      start_date: string | null;
      completion_date: string | null;
    }>();
  if (!est?.terms) return;

  const filled = fillContract(est.terms, lateContractValues(est));
  if (filled === est.terms) return;

  await supabase
    .from("estimates")
    .update({ terms: filled })
    .eq("id", estimateId)
    .eq("company_id", companyId);
}

export async function createEstimate(
  leadId: string,
  title: string
): Promise<{ error?: string; id?: string }> {
  const guard = await requireEstimateEditor();
  if ("error" in guard) return guard;

  const supabase = await createClient();

  // The customer's own name seeds the signer list, so the rep is not
  // retyping what the lead record already knows.
  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("id, first_name, last_name, email, phone, address, assigned_to, company_id, second_contact_first_name, second_contact_last_name, second_contact_phone, second_contact_email")
    .eq("id", leadId)
    .eq("company_id", guard.companyId)
    .maybeSingle<LeadRow & { address: string | null }>();
  if (leadError) return { error: leadError.message };
  if (!lead) return { error: "Lead not found." };

  const { data: settings } = await supabase
    .from("company_profile")
    .select(
      "tax_rate_bp, estimate_expiry_days, estimate_terms, name, address, phone, email, license_number"
    )
    .eq("company_id", guard.companyId)
    .maybeSingle<
      SettingsRow & {
        name: string | null;
        address: string | null;
        phone: string | null;
        email: string | null;
        license_number: string | null;
      }
    >();

  // The default contract, frozen onto this estimate as it reads today.
  // Copied rather than referenced so that editing the template next year
  // cannot rewrite a contract signed this one -- the same reason
  // estimate_terms was already copied, extended to a real document.
  const { data: template } = await supabase
    .from("contract_templates")
    .select("id, body")
    .eq("company_id", guard.companyId)
    .eq("is_default", true)
    .maybeSingle<{ id: string; body: string }>();

  const { data: docNumber, error: numberError } = await supabase.rpc("next_estimate_number", {
    check_company_id: guard.companyId,
  });
  const docNumberText = docNumber as string | null;
  if (numberError) return { error: numberError.message };

  const expiryDays = settings?.estimate_expiry_days ?? 7;
  // On the company's calendar: sent after 5pm Pacific, "valid 7 days"
  // was landing on the eighth.
  const expiresAt = addDays(await companyToday(), expiryDays);

  const customerFullName = [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim();
  const repName = await repDisplayName(supabase, lead.assigned_to ?? guard.userId);
  // Money and dates are left out on purpose: nothing is priced yet at
  // creation, so a total merged in here would be $0.00 on every contract.
  // They fill in when the estimate is sent -- see fillContractMoney.
  const contractBody = template?.body
    ? fillContract(template.body, {
        contract_no: docNumberText ?? "",
        contract_date: new Date().toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        }),
        client_name: customerFullName,
        client_phone: lead.phone,
        client_email: lead.email,
        project_address: lead.address,
        rep_name: repName,
        project_title: title.trim(),
        company_name: settings?.name,
        company_address: settings?.address,
        company_phone: settings?.phone,
        company_email: settings?.email,
        license_no: settings?.license_number,
      })
    : (settings?.estimate_terms ?? null);

  const { data: created, error } = await supabase
    .from("estimates")
    .insert({
      company_id: guard.companyId,
      lead_id: leadId,
      doc_number: docNumberText,
      title: title.trim(),
      status: "Draft" as EstimateStatus,
      assigned_to: lead.assigned_to ?? guard.userId,
      tax_rate_bp: settings?.tax_rate_bp ?? 0,
      terms: contractBody,
      contract_template_id: template?.id ?? null,
      expires_at: expiresAt,
      created_by: guard.userId,
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (error) return { error: error.message };
  if (!created) return { error: "Could not create the estimate." };

  // Every owner signs. A second contact on the client card is a joint
  // owner, and a contract signed by one owner of two is not a signed
  // contract -- the portal already refuses to bind a document while any
  // customer signer is missing, so listing both here is what enforces
  // it. Change orders and completion certificates copy these rows, so
  // both names follow the job to its end.
  const customerName = [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim();
  const secondRow = lead as unknown as {
    second_contact_first_name: string | null;
    second_contact_last_name: string | null;
    second_contact_phone: string | null;
    second_contact_email: string | null;
  };
  const secondName = [secondRow.second_contact_first_name, secondRow.second_contact_last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  const signerRows = [];
  if (customerName) {
    signerRows.push({
      company_id: guard.companyId,
      estimate_id: created.id,
      party: "customer",
      name: customerName,
      email: lead.email,
      phone: lead.phone,
      sort_order: 0,
    });
  }
  if (secondName || secondRow.second_contact_email) {
    signerRows.push({
      company_id: guard.companyId,
      estimate_id: created.id,
      party: "customer",
      name: secondName || "Co-owner",
      email: secondRow.second_contact_email,
      phone: secondRow.second_contact_phone,
      sort_order: 1,
    });
  }
  if (signerRows.length) {
    await supabase.from("estimate_signers").insert(signerRows);
  }

  revalidateEstimates(created.id);
  return { id: created.id };
}

export async function updateEstimateDetails(
  estimateId: string,
  fields: {
    title?: string;
    expires_at?: string | null;
    start_date?: string | null;
    completion_date?: string | null;
    job_address?: string | null;
    customer_message?: string | null;
    terms?: string | null;
    notes?: string | null;
    deposit_cents?: number | null;
  }
): Promise<{ error?: string }> {
  const guard = await requireEstimateEditor();
  if ("error" in guard) return guard;

  const supabase = await createClient();
  // .select() so a row blocked by RLS surfaces as an error rather than
  // silently matching zero rows and reporting success.
  const { data, error } = await supabase
    .from("estimates")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", estimateId)
    .eq("company_id", guard.companyId)
    .select("id, lead_id")
    .returns<{ id: string; lead_id: string }[]>();
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Estimate not found, or you can't edit it." };

  revalidateEstimates(estimateId);
  return {};
}

// Replaces the whole item list and re-derives the stored totals. Totals are
// recomputed here rather than trusted from the client: the browser sends
// what the rep typed, not what the document is worth.
export async function saveEstimateItems(
  estimateId: string,
  items: ItemInput[],
  // undefined = keep the stored discount; null = remove it; object = set it.
  discount?: DiscountInput
): Promise<{ error?: string; totalCents?: number; recalled?: boolean }> {
  const guard = await requireEstimateEditor();
  if ("error" in guard) return guard;

  const supabase = await createClient();
  const { data: estimate, error: readError } = await supabase
    .from("estimates")
    .select(
      "id, lead_id, status, version, tax_rate_bp, deposit_percent_bp, deposit_cap_cents, discount_type, discount_value, discount_label"
    )
    .eq("id", estimateId)
    .eq("company_id", guard.companyId)
    .maybeSingle<ItemsEstimateRow>();
  if (readError) return { error: readError.message };
  if (!estimate) return { error: "Estimate not found." };
  const lock = await guardEstimateEdit(
    supabase, estimateId, guard.companyId, estimate.status, estimate.version
  );
  if (lock.locked) {
    return { error: "The customer has signed this estimate. Create a new version to change it." };
  }

  const clean = items
    .map((item) => ({ ...item, name: (item.name ?? "").trim() }))
    .filter((item) => item.name || item.unit_price_cents);

  // Lines that survive keep their id. This used to delete every row and
  // re-insert with fresh ones, which quietly destroyed anything pointing
  // at a line: a photo pinned to "Dry rot repair" vanished the next time
  // anybody saved the estimate, with no error and nothing to notice.
  // Rewriting a row's identity on every save is not a saving detail, it
  // is a promise to break every reference to it.
  const keptIds = clean.map((i) => i.id).filter((id): id is string => !!id);
  let removal = supabase.from("estimate_items").delete().eq("estimate_id", estimateId);
  if (keptIds.length) {
    removal = removal.not("id", "in", `(${keptIds.join(",")})`);
  }
  const { error: deleteError } = await removal;
  if (deleteError) return { error: deleteError.message };

  const toRow = (item: ItemInput, i: number) => ({
    company_id: guard.companyId,
    estimate_id: estimateId,
    sort_order: i,
    name: item.name,
    description: item.description ?? null,
    quantity: parseQuantity(item.quantity),
    unit: item.unit ?? null,
    unit_price_cents: item.unit_price_cents,
    line_total_cents: lineTotalCents(parseQuantity(item.quantity), item.unit_price_cents),
    taxable: item.taxable,
    cost_cents: item.cost_cents ?? null,
    group_id: item.group_id ?? null,
    is_optional: item.is_optional ?? false,
    // An office save rewrites the offer, so the customer's earlier tick
    // is cleared rather than carried onto numbers they never saw -- the
    // same reasoning as recalling a sent document deletes its signature.
    // The totals below assume exactly this, so the stored choice and the
    // stored money can never disagree.
    optional_selected: false,
  });

  // Two statements, not one per line. This looped an awaited write per
  // item, so a twenty-line remodel paid twenty sequential round trips to
  // the database and the rep watched "Saving…" for most of it. Kept rows
  // go up as one upsert keyed on their existing ids -- identity preserved,
  // same as before -- and new rows as one insert.
  const keptRows = clean
    .map((item, i) => ({ item, i }))
    .filter(({ item }) => item.id)
    .map(({ item, i }) => ({ id: item.id as string, ...toRow(item, i) }));
  const newRows = clean
    .map((item, i) => ({ item, i }))
    .filter(({ item }) => !item.id)
    .map(({ item, i }) => toRow(item, i));

  if (keptRows.length) {
    const { error } = await supabase
      .from("estimate_items")
      .upsert(keptRows, { onConflict: "id" });
    if (error) return { error: error.message };
  }
  if (newRows.length) {
    const { error } = await supabase.from("estimate_items").insert(newRows);
    if (error) return { error: error.message };
  }

  // undefined keeps what's stored, so callers that never heard of
  // discounts leave them exactly as they are.
  const effectiveDiscount =
    discount === undefined
      ? estimate.discount_type
        ? cleanDiscount({
            type: estimate.discount_type as "percent" | "amount",
            value: estimate.discount_value,
            label: estimate.discount_label,
          })
        : null
      : cleanDiscount(discount);

  const totals = computeEstimateTotals(
    clean,
    estimate.tax_rate_bp,
    effectiveDiscount ? { type: effectiveDiscount.type, value: effectiveDiscount.value } : null
  );
  const { error: totalsError } = await supabase
    .from("estimates")
    .update({
      subtotal_cents: totals.subtotalCents,
      discount_type: effectiveDiscount?.type ?? null,
      discount_value: effectiveDiscount?.value ?? 0,
      discount_label: effectiveDiscount?.label ?? null,
      discount_cents: totals.discountCents,
      tax_cents: totals.taxCents,
      total_cents: totals.totalCents,
      // Re-derived here as well as on the schedule save: changing a line
      // item changes the total, and a deposit left over from the previous
      // total is both wrong and, on a big job, potentially over the legal
      // ceiling.
      deposit_cents: depositCents(
        totals.totalCents,
        estimate.deposit_percent_bp,
        estimate.deposit_cap_cents
      ),
      updated_at: new Date().toISOString(),
    })
    .eq("id", estimateId);
  if (totalsError) return { error: totalsError.message };

  revalidateEstimates(estimateId);
  return { totalCents: totals.totalCents, recalled: lock.recalled };
}

// Copies the company's current sales-tax rate onto one estimate and
// re-derives its totals.
//
// The rate is snapshotted onto each estimate when it is created, so a
// company that had no rate set (the default) has every existing estimate
// frozen at 0% -- and setting the rate in Company Profile afterwards
// changes nothing on them. This is the one deliberate way to bring an
// estimate up to the company rate; a signed one stays locked as always.
export async function applyCompanyTaxRate(
  estimateId: string
): Promise<{ error?: string; taxRateBp?: number; totalCents?: number; recalled?: boolean }> {
  const guard = await requireEstimateEditor();
  if ("error" in guard) return guard;

  const supabase = await createClient();
  const { data: estimate, error: readError } = await supabase
    .from("estimates")
    .select(
      "id, lead_id, status, version, tax_rate_bp, deposit_percent_bp, deposit_cap_cents, discount_type, discount_value, discount_label"
    )
    .eq("id", estimateId)
    .eq("company_id", guard.companyId)
    .maybeSingle<ItemsEstimateRow>();
  if (readError) return { error: readError.message };
  if (!estimate) return { error: "Estimate not found." };

  const { data: settings } = await supabase
    .from("company_profile")
    .select("tax_rate_bp")
    .eq("company_id", guard.companyId)
    .maybeSingle<{ tax_rate_bp: number }>();
  const taxRateBp = Number(settings?.tax_rate_bp) || 0;
  if (taxRateBp <= 0) {
    return { error: "No sales tax rate set yet. Add one in Settings › Company Profile first." };
  }

  const lock = await guardEstimateEdit(
    supabase, estimateId, guard.companyId, estimate.status, estimate.version
  );
  if (lock.locked) {
    return { error: "The customer has signed this estimate. Create a new version to change it." };
  }

  const { data: items, error: itemsError } = await supabase
    .from("estimate_items")
    // The optional columns come along so an un-ticked add-on stays out
    // of the re-derived totals, exactly as it is everywhere else.
    .select("quantity, unit_price_cents, taxable, is_optional, optional_selected")
    .eq("estimate_id", estimateId)
    .returns<
      {
        quantity: number;
        unit_price_cents: number;
        taxable: boolean;
        is_optional: boolean;
        optional_selected: boolean;
      }[]
    >();
  if (itemsError) return { error: itemsError.message };

  const discount = estimate.discount_type
    ? { type: estimate.discount_type as "percent" | "amount", value: estimate.discount_value }
    : null;
  const totals = computeEstimateTotals(items ?? [], taxRateBp, discount);
  const { error: updateError } = await supabase
    .from("estimates")
    .update({
      tax_rate_bp: taxRateBp,
      subtotal_cents: totals.subtotalCents,
      discount_cents: totals.discountCents,
      tax_cents: totals.taxCents,
      total_cents: totals.totalCents,
      deposit_cents: depositCents(
        totals.totalCents,
        estimate.deposit_percent_bp,
        estimate.deposit_cap_cents
      ),
      updated_at: new Date().toISOString(),
    })
    .eq("id", estimateId);
  if (updateError) return { error: updateError.message };

  revalidateEstimates(estimateId);
  return { taxRateBp, totalCents: totals.totalCents, recalled: lock.recalled };
}

// Marks the estimate as issued and stamps its total onto the lead.
//
// This write-back is the point of the whole module: 1,122 of 1,128 open
// leads have no value recorded, so Pipeline Value, Avg Deal Size and the
// rep leaderboard are all computed over almost nothing. Nobody fills in a
// "value" field; everybody writes an estimate.
export async function markEstimateSent(estimateId: string): Promise<{ error?: string }> {
  const guard = await requireEstimateSender(estimateId);
  if ("error" in guard) return guard;

  const supabase = await createClient();
  const { data: estimate, error: readError } = await supabase
    .from("estimates")
    .select("id, lead_id, status, total_cents, kind, doc_number")
    .eq("id", estimateId)
    .eq("company_id", guard.companyId)
    .maybeSingle<SendEstimateRow & { doc_number: string | null }>();
  if (readError) return { error: readError.message };
  if (!estimate) return { error: "Estimate not found." };
  if (estimate.status !== "Draft") return { error: "This estimate has already been sent." };
  // A completion certificate is worth nothing on purpose -- it records
  // acceptance, not a price. This guard exists to stop an empty estimate
  // going out at $0.00, and it was catching every certificate too, so a
  // certificate could never be sent and therefore never signed.
  if (!estimate.total_cents && !isPricelessKind(estimate.kind)) {
    return { error: "Add at least one line item before sending." };
  }

  // The trigger would refuse the status change anyway; asking first
  // says what to do instead of naming a database error.
  const approval = await approvalGate(guard.companyId, estimateId, guard);
  if ("error" in approval) return approval;

  // Before the status flips, so the contract carries its price the first
  // time anyone can open it.
  await fillContractMoney(estimateId, guard.companyId);

  if (approval.selfApprove) {
    await recordSelfApproval({
      companyId: guard.companyId,
      estimateId,
      leadId: estimate.lead_id,
      docNumber: estimate.doc_number,
      userId: guard.userId,
      senderName: guard.senderName,
    });
  }

  const now = new Date().toISOString();
  const { data: updated, error } = await supabase
    .from("estimates")
    .update({ status: "Sent" as EstimateStatus, sent_at: now, issued_at: now, updated_at: now })
    .eq("id", estimateId)
    .eq("company_id", guard.companyId)
    .select("id")
    .returns<{ id: string }[]>();
  if (error) return { error: error.message };
  if (!updated?.length) return { error: "Could not send the estimate." };

  // A signed estimate outranks a merely sent one, so a later draft going
  // out must not overwrite the value of work already won.
  // Contracts only: an invoice (a permit fee billed back) is Signed too,
  // but it isn't what the job is worth.
  const { data: signed } = await supabase
    .from("estimates")
    .select("total_cents")
    .eq("lead_id", estimate.lead_id)
    .eq("status", "Signed")
    .or("kind.is.null,kind.eq.contract")
    .order("signed_at", { ascending: false })
    .limit(1)
    .returns<{ total_cents: number }[]>();

  const valueCents = signed?.length ? signed[0].total_cents : estimate.total_cents;
  await supabase
    .from("leads")
    .update({ value: valueCents / 100 })
    .eq("id", estimate.lead_id)
    .eq("company_id", guard.companyId);

  revalidateEstimates(estimateId);
  return {};
}

export async function deleteEstimate(estimateId: string): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  // Deleting priced work a customer may already have seen is gated the same
  // way lead deletion is, rather than by plain edit access.
  if (!canDeleteLeads(profile)) return { error: "You don't have permission to delete estimates." };

  const supabase = await createClient();

  // Status checked before the delete, not after. This check did not exist:
  // a Signed contract could be hard-deleted, and portal_payments cascades
  // on delete, so one click destroyed the agreement, the signatures, the
  // schedule and the record that the customer had paid -- leaving nothing
  // behind to say the document had ever existed.
  const { data: existing } = await supabase
    .from("estimates")
    .select("status, doc_number")
    .eq("id", estimateId)
    .eq("company_id", profile.company_id)
    .maybeSingle<{ status: EstimateStatus; doc_number: string }>();
  if (!existing) return { error: "Estimate not found, or you can't delete it." };
  if (!canDeleteEstimateStatus(existing.status)) {
    return {
      error:
        `${existing.doc_number} has been ${existing.status.toLowerCase()} — it can't be deleted. ` +
        `Void it instead, so the record and the reason survive.`,
    };
  }

  const { data, error } = await supabase
    .from("estimates")
    .delete()
    .eq("id", estimateId)
    .eq("company_id", profile.company_id)
    // Belt and braces: the status is re-checked in the delete itself, so
    // a document signed between the read above and this write cannot slip
    // through the gap.
    .eq("status", "Draft")
    .select("id, lead_id")
    .returns<{ id: string; lead_id: string }[]>();
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Estimate not found, or you can't delete it." };

  revalidateEstimates(null);
  return {};
}

/**
 * Cancels a document without destroying it.
 *
 * Admin only. Voiding a signed agreement cancels work the customer
 * committed to and can strand money already collected, which is not a
 * decision to leave with whoever happens to be looking at the screen.
 *
 * Payments are never touched. Refunds here are handled by hand, by card
 * or cheque, so a void that quietly reversed a payment row would put the
 * books out of step with the bank.
 */
export async function voidEstimate(
  estimateId: string,
  reason: string
): Promise<{ error?: string; cancelledPhases?: number; collectedCents?: number }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isStrictAdmin(profile)) {
    return { error: "Only an Admin can void a document." };
  }
  if (!reason?.trim()) {
    return { error: "Give a reason — it is what answers “why was this cancelled” later." };
  }

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("estimates")
    .select("id, status, doc_number, kind, lead_id")
    .eq("id", estimateId)
    .eq("company_id", profile.company_id)
    .maybeSingle<{
      id: string;
      status: EstimateStatus;
      doc_number: string;
      kind: string | null;
      lead_id: string | null;
    }>();
  if (!existing) return { error: "Document not found." };
  if (existing.status === "Void") return { error: "That document is already void." };

  const { data, error } = await supabase
    .from("estimates")
    .update({
      status: "Void",
      voided_at: new Date().toISOString(),
      voided_by: profile.id,
      void_reason: reason.trim(),
    })
    .eq("id", estimateId)
    .eq("company_id", profile.company_id)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "That document couldn't be voided." };

  // Unbilled phases stop being receivables. Billed ones stay: the request
  // genuinely went out, and erasing it would leave a payment arriving
  // later with nothing to settle against.
  const { data: cancelled } = await supabase
    .from("estimate_payments")
    .update({ cancelled_at: new Date().toISOString() })
    .eq("estimate_id", estimateId)
    .eq("company_id", profile.company_id)
    .is("requested_at", null)
    .is("cancelled_at", null)
    .select("id");

  // Reported, never reversed. Somebody is owed this back and only a human
  // can decide how it goes out.
  const { data: paidRows } = await supabase
    .from("portal_payments")
    .select("amount_cents, status")
    .eq("estimate_id", estimateId)
    .eq("company_id", profile.company_id)
    .returns<{ amount_cents: number; status: string }[]>();
  const collectedCents = (paidRows ?? [])
    .filter((p) => p.status === "succeeded")
    .reduce((s, p) => s + p.amount_cents, 0);

  // The mirror of signing. Signing writes the contract total onto the
  // lead and advances it to Won; without this, voiding left both behind,
  // and a cancelled $45,000 test contract kept its lead on the board as
  // Won $45,000 indefinitely. Recomputed from whatever remains signed.
  if (existing.status === "Signed" && (existing.kind ?? "contract") === "contract" && existing.lead_id) {
    const { data: remaining } = await supabase
      .from("estimates")
      .select("total_cents, signed_at, kind")
      .eq("lead_id", existing.lead_id)
      .eq("company_id", profile.company_id)
      .eq("status", "Signed");
    const contracts = (remaining ?? []).filter(
      (r) => ((r as { kind: string | null }).kind ?? "contract") === "contract"
    ) as { total_cents: number; signed_at: string | null }[];
    const after = leadAfterContractVoid(contracts);
    if (after.demote) {
      // Only ever out of Won, and only into a stage this company's
      // pipeline actually has -- a lead written into a stage no board
      // shows would simply disappear.
      const { data: stages } = await supabase
        .from("pipeline_stages")
        .select("name")
        .eq("company_id", profile.company_id);
      if ((stages ?? []).some((s) => (s as { name: string }).name === "Proposal Sent")) {
        await supabase
          .from("leads")
          .update({ stage: "Proposal Sent", won_at: null })
          .eq("id", existing.lead_id)
          .eq("company_id", profile.company_id)
          .eq("stage", "Won");
      }
    } else if (after.valueDollars !== null) {
      await supabase
        .from("leads")
        .update({ value: after.valueDollars })
        .eq("id", existing.lead_id)
        .eq("company_id", profile.company_id);
    }
    revalidatePath("/pipeline");
    revalidatePath("/contacts");
    revalidatePath("/marketing-analytics");
  }

  revalidateEstimates(null);
  revalidatePath("/projects");
  return { cancelledPhases: cancelled?.length ?? 0, collectedCents };
}

// Sends the estimate to the customer as a portal link, by text or email.
//
// Reuses the client portal rather than inventing a second customer-facing
// auth: the token, session, address challenge and access window all
// already exist and are already hardened. The link deep-links straight to
// the document instead of the portal home.
//
// One channel per call, not both like sendPortalLink: unlike a portal
// invite, this send has one-time side effects (the contractor "signs" at
// send time, the pipeline stage advances, the lead's value is written) that
// must not fire twice for a single click.
export type SendEstimateResult = {
  error?: string;
  sentTo?: string;
  channel?: "text" | "email" | "both";
  /** Any problem that didn't stop the send outright -- a channel that
   *  failed while something else went out. */
  warning?: string;
  /** Typed entries that weren't a valid email address, reported back
   *  per bucket rather than silently dropped. */
  invalidTo?: string[];
  invalidCc?: string[];
  invalidBcc?: string[];
};

export async function sendEstimateToCustomer(
  estimateId: string,
  channel: "text" | "email" | "both",
  /** Free-typed extra recipients (each a comma/semicolon/newline-separated
   *  string), on top of the lead's own email and its second-contact email.
   *  Parsed and validated here, not trusted pre-parsed from the client.
   *  `narrative`, when given, replaces the default 3-paragraph message body
   *  -- everything else in the email (link, footer, disclaimer) is fixed
   *  either way. */
  recipients?: { to?: string; cc?: string; bcc?: string; narrative?: string }
): Promise<SendEstimateResult> {
  const guard = await requireEstimateSender(estimateId);
  if ("error" in guard) return guard;

  const admin = createAdminClient();
  const { data: estimate } = await admin
    .from("estimates")
    .select("id, lead_id, company_id, status, total_cents, kind, doc_number, title")
    .eq("id", estimateId)
    .eq("company_id", guard.companyId)
    .maybeSingle<SendToCustomerRow>();
  if (!estimate) return { error: "Estimate not found." };
  if (estimate.status !== "Draft") return { error: "This estimate has already been sent." };
  // A completion certificate is worth nothing on purpose -- it records
  // acceptance, not a price. This guard exists to stop an empty estimate
  // going out at $0.00, and it was catching every certificate too, so a
  // certificate could never be sent and therefore never signed.
  if (!estimate.total_cents && !isPricelessKind(estimate.kind)) {
    return { error: "Add at least one line item before sending." };
  }

  // Before a single message goes out: with approval switched on, an
  // unapproved document must be refused here, not by the trigger after
  // the customer already has the link.
  const approval = await approvalGate(guard.companyId, estimateId, guard);
  if ("error" in approval) return approval;

  const { data: lead } = await admin
    .from("leads")
    .select("id, first_name, last_name, address, phone, email, company_id, second_contact_email")
    .eq("id", estimate.lead_id)
    .maybeSingle<{
      id: string;
      first_name: string | null;
      last_name: string | null;
      address: string | null;
      phone: string | null;
      email: string | null;
      company_id: string;
    }>();
  if (!lead) return { error: "Customer not found." };

  const wantsText = channel !== "email";
  const wantsEmail = channel !== "text";

  const twilioEnv = wantsText ? await getTwilioForCompany(guard.companyId) : null;

  // A single explicit channel is a hard requirement, same as before this
  // supported "both": asking to text a customer with no phone on file is
  // an error, not something to quietly skip. "both" is permissive instead,
  // the same way sendPortalLink is -- it sends whichever of the two the
  // customer actually has, rather than refusing both because one is short
  // a channel.
  // Any typed recipient counts as "has an email target" too -- a rep
  // filling in To/Cc/Bcc for a lead with no email on file (a referral
  // routed straight to a project manager, say) must not be blocked by a
  // check that only ever looked at the lead's own address.
  const hasEmailTarget = !!lead.email || !!(recipients?.to || recipients?.cc || recipients?.bcc);
  if (channel === "text") {
    if (!lead.phone) return { error: "This customer has no phone number on file." };
    if (!twilioEnv) return { error: "Texting isn't configured for this company yet." };
  } else if (channel === "email") {
    if (!hasEmailTarget) return { error: "This customer has no email address on file." };
  } else if (!lead.phone && !hasEmailTarget) {
    return { error: "This customer has no phone number or email address on file." };
  }

  const { data: companyRow } = await admin
    .from("company_profile")
    .select("name, dba, address, website, license_number")
    .eq("company_id", guard.companyId)
    .maybeSingle<{
      name: string | null;
      dba: string | null;
      address: string | null;
      website: string | null;
      license_number: string | null;
    }>();
  const companyName = companyRow?.name || "Your contractor";

  // Sending the link is the act of granting access, same as the existing
  // portal invite -- otherwise the customer gets a link that refuses them.
  await admin
    .from("leads")
    .update({ portal_access_expires_at: portalAccessExpiry() })
    .eq("id", lead.id);

  const { token, error: tokenError } = await createLoginToken(lead.id, lead.company_id);
  if (tokenError || !token) return { error: tokenError || "Could not create a sign-in link." };

  const next = encodeURIComponent(`/portal/estimates/${estimateId}`);
  const link = `${portalBaseUrl()}/portal/verify?token=${encodeURIComponent(token)}&next=${next}`;

  const sender = await getCurrentProfile();

  const canText = wantsText && !!lead.phone && !!twilioEnv;

  // Resolved above the email block: an extra recipient must still get a
  // copy even when the lead itself has no email on file (channel "both"
  // with only a phone) -- their invite isn't contingent on the customer's
  // own, and resolveEstimateRecipients promotes one of them into To when
  // that happens.
  const secondEmail = (lead as unknown as { second_contact_email?: string | null })
    .second_contact_email;
  const resolved = wantsEmail
    ? resolveEstimateRecipients({
        leadEmail: lead.email,
        secondContactEmail: secondEmail ?? null,
        toRaw: recipients?.to ?? "",
        ccRaw: recipients?.cc ?? "",
        bccRaw: recipients?.bcc ?? "",
      })
    : {
        to: [] as string[],
        cc: [] as string[],
        bcc: [] as string[],
        invalidTo: [] as string[],
        invalidCc: [] as string[],
        invalidBcc: [] as string[],
      };

  const sentTo: string[] = [];
  const problems: string[] = [];
  const logRows: {
    from_number: string;
    to_number: string;
    body: string;
    twilio_sid: string | null;
    channel: string;
  }[] = [];

  if (canText) {
    // Plain hyphens and no emoji: an em dash or emoji flips the message to
    // UCS-2 and cuts each segment from 160 characters to 70.
    const body = `${companyName}: your estimate ${estimate.doc_number} is ready to review and sign.\n${link}\n\nLink expires in 7 days.`;
    const sent = await sendTwilioSms(lead.phone!, body, twilioEnv!);
    if (sent.error) {
      problems.push(`Text failed (${sent.error})`);
    } else {
      sentTo.push(lead.phone!);
      logRows.push({
        from_number: twilioEnv!.phoneNumber,
        to_number: lead.phone!,
        body,
        twilio_sid: sent.sid || null,
        channel: "sms",
      });
    }
  } else if (wantsText && channel === "both") {
    problems.push(lead.phone ? "texting isn't configured for this company yet" : "no phone number on file");
  }

  if (wantsEmail && resolved.to.length > 0) {
    const customerName = [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim();
    const mail = buildEstimateEmail({
      customerName: customerName || null,
      company: {
        name: companyName,
        dba: companyRow?.dba ?? null,
        address: companyRow?.address ?? null,
        website: companyRow?.website ?? null,
        licenseNumber: companyRow?.license_number ?? null,
      },
      docNumber: estimate.doc_number,
      title: estimate.title,
      projectAddress: lead.address,
      totalCents: estimate.total_cents,
      link,
      narrative: recipients?.narrative,
    });
    const emailEnv = await getEmailForCompany(guard.companyId);

    // One real message with real To/Cc/Bcc headers -- everyone in To/Cc
    // sees each other's address, same as any other mail client; Bcc stays
    // hidden from all of them. Not a loop of private sends: that would
    // have meant nobody could see who else was included, which is
    // indistinguishable from everyone being Bcc'd.
    const sent = await sendEmail(resolved.to, mail.subject, mail.html, mail.text, {
      replyTo: sender?.email ?? undefined,
      env: emailEnv ?? undefined,
      cc: resolved.cc,
      bcc: resolved.bcc,
    });
    if (sent.error) {
      problems.push(`Email failed (${sent.error})`);
    } else {
      const allEmailed = [...resolved.to, ...resolved.cc, ...resolved.bcc];
      sentTo.push(...allEmailed);
      for (const addr of resolved.to) {
        logRows.push({
          from_number: "email",
          to_number: addr,
          body: `[Estimate emailed] ${mail.subject}`,
          twilio_sid: sent.id || null,
          channel: "email",
        });
      }
      for (const addr of resolved.cc) {
        logRows.push({
          from_number: "email",
          to_number: addr,
          body: `[Estimate emailed — cc] ${mail.subject}`,
          twilio_sid: sent.id || null,
          channel: "email",
        });
      }
      for (const addr of resolved.bcc) {
        logRows.push({
          from_number: "email",
          to_number: addr,
          body: `[Estimate emailed — bcc] ${mail.subject}`,
          twilio_sid: sent.id || null,
          channel: "email",
        });
      }
    }
  } else if (wantsEmail) {
    problems.push("no email address on file");
  }

  // Nothing went out at all -- report the failure and leave the estimate
  // untouched (still Draft), same as a single-channel send always has.
  if (sentTo.length === 0) {
    return { error: problems.join("; ") || "Could not send the estimate." };
  }

  // Logged in the same thread the team already watches, so "did they ever
  // get anything?" stays answerable from data. One row per channel that
  // actually went out -- written before the status changes, because it
  // records what happened regardless of what happens next.
  for (const logRow of logRows) {
    await admin.from("sms_messages").insert({
      lead_id: lead.id,
      direction: "outbound",
      sent_by: guard.userId,
      company_id: guard.companyId,
      ...logRow,
    });
  }

  await fillContractMoney(estimateId, guard.companyId);

  if (approval.selfApprove) {
    await recordSelfApproval({
      companyId: guard.companyId,
      estimateId,
      leadId: estimate.lead_id,
      docNumber: estimate.doc_number,
      userId: guard.userId,
      senderName: guard.senderName,
    });
  }

  const now = new Date().toISOString();
  // Checked, not fire-and-forget: the database can refuse this change
  // (the approval trigger, 0136), and a refusal that went unread here
  // is exactly how a document got emailed, signed for by the sender,
  // and left standing in Draft as if nobody had ever sent it.
  const { data: marked, error: markError } = await admin
    .from("estimates")
    .update({ status: "Sent", sent_at: now, issued_at: now, updated_at: now })
    .eq("id", estimateId)
    .select("id")
    .returns<{ id: string }[]>();
  if (markError || !marked?.length) {
    revalidateEstimates(estimateId);
    return {
      error:
        `The message went out to ${sentTo.join(" and ")}, but ${estimate.doc_number} could not be ` +
        `marked as sent${markError ? `: ${markError.message}` : "."}`,
    };
  }

  // The proposal is out, so the board should say so. Revives a lead
  // written off as Lost, since sending an estimate contradicts that.
  await advanceStageOnEstimateSent(admin, estimate.lead_id, guard.companyId);

  // The contractor signs too -- the reference product shows documents as
  // "1 of 2 signed" with the rep already on them. Recording it at send
  // time means the customer sees a document the contractor has stood
  // behind, not a blank pair of signature lines.
  if (sender) {
    // One contractor signature per document: whoever sends it is the one
    // standing behind these numbers. An earlier send-time signature --
    // a colleague's, or the sender's own from a send the database
    // refused -- is replaced, not joined; two "Contractor" lines on one
    // contract read as two people having signed it.
    await admin
      .from("estimate_signers")
      .delete()
      .eq("estimate_id", estimateId)
      .eq("party", "company");
    // Same evidence the customer's signature carries -- the contractor
    // signs from this very request, so record where and when from it.
    const evidence = collectSignatureEvidence(await headers(), now);
    await admin.from("estimate_signers").insert({
      company_id: guard.companyId,
      estimate_id: estimateId,
      party: "company",
      name: sender.name || sender.email || "Contractor",
      email: sender.email,
      sort_order: -1,
      signed_at: now,
      signature_name: sender.name || sender.email,
      signature_ip: evidence.ip,
      signature_user_agent: evidence.userAgent,
    });
  }

  await admin
    .from("leads")
    .update({ value: estimate.total_cents / 100 })
    .eq("id", lead.id);

  revalidateEstimates(estimateId);
  return {
    sentTo: sentTo.join(" and "),
    channel,
    // Not just "both" any more: on a "both" send, text and email now fail
    // independently of each other (one atomic email covering the whole
    // To/Cc/Bcc list, separate from the Twilio text), so that problem must
    // surface here too rather than only ever being visible on a "both" send.
    warning: problems.length ? problems.join("; ") : undefined,
    invalidTo: resolved.invalidTo.length ? resolved.invalidTo : undefined,
    invalidCc: resolved.invalidCc.length ? resolved.invalidCc : undefined,
    invalidBcc: resolved.invalidBcc.length ? resolved.invalidBcc : undefined,
  };
}

/**
 * Read-only: the subject and default message a send would use right now,
 * so the send drawer can show a rep the actual copy before they commit to
 * it -- rather than the email being entirely opaque until it lands in an
 * inbox. Mints no token and sends nothing; same guard as sending, since a
 * rep who can't send an estimate has no reason to preview one either.
 */
export async function previewEstimateEmail(
  estimateId: string
): Promise<{ error?: string; subject?: string; narrative?: string }> {
  const guard = await requireEstimateSender(estimateId);
  if ("error" in guard) return guard;

  const admin = createAdminClient();
  const { data: estimate } = await admin
    .from("estimates")
    .select("id, lead_id, company_id, doc_number, title, total_cents")
    .eq("id", estimateId)
    .eq("company_id", guard.companyId)
    .maybeSingle<{
      id: string;
      lead_id: string;
      company_id: string;
      doc_number: string;
      title: string | null;
      total_cents: number;
    }>();
  if (!estimate) return { error: "Estimate not found." };

  const { data: lead } = await admin
    .from("leads")
    .select("address")
    .eq("id", estimate.lead_id)
    .maybeSingle<{ address: string | null }>();

  const { data: companyRow } = await admin
    .from("company_profile")
    .select("name")
    .eq("company_id", guard.companyId)
    .maybeSingle<{ name: string | null }>();
  const companyName = companyRow?.name || "Your contractor";

  return {
    subject: `${companyName}: your proposal ${estimate.doc_number} is ready to review`,
    narrative: defaultEstimateNarrative({
      companyName,
      docNumber: estimate.doc_number,
      title: estimate.title,
      projectAddress: lead?.address ?? null,
      totalCents: estimate.total_cents,
    }),
  };
}

export type PaymentInput = { name: string; description?: string | null; amount_cents: number };

/**
 * Replaces the progress-payment schedule.
 *
 * The deposit is not one of these rows -- it is derived from the total by
 * policy and stored on the estimate, so a rep cannot type over the legal
 * ceiling by editing a line.
 */
export async function saveEstimatePayments(
  estimateId: string,
  payments: PaymentInput[]
): Promise<{ error?: string; scheduledCents?: number; recalled?: boolean }> {
  const guard = await requireEstimateEditor();
  if ("error" in guard) return guard;

  const supabase = await createClient();
  const { data: estimate, error: readError } = await supabase
    .from("estimates")
    .select("id, status, version, total_cents, deposit_percent_bp, deposit_cap_cents")
    .eq("id", estimateId)
    .eq("company_id", guard.companyId)
    .maybeSingle<PaymentEstimateRow>();
  if (readError) return { error: readError.message };
  if (!estimate) return { error: "Estimate not found." };
  const lock = await guardEstimateEdit(
    supabase, estimateId, guard.companyId, estimate.status, estimate.version
  );
  if (lock.locked) {
    return { error: "The customer has signed this estimate. Create a new version to change it." };
  }

  const clean = payments
    .map((p) => ({ ...p, name: (p.name ?? "").trim() }))
    .filter((p) => p.name || p.amount_cents);

  const { error: deleteError } = await supabase
    .from("estimate_payments")
    .delete()
    .eq("estimate_id", estimateId);
  if (deleteError) return { error: deleteError.message };

  if (clean.length) {
    const { error: insertError } = await supabase.from("estimate_payments").insert(
      clean.map((p, i) => ({
        company_id: guard.companyId,
        estimate_id: estimateId,
        sort_order: i,
        name: p.name,
        description: p.description ?? null,
        amount_cents: Math.max(0, Math.round(p.amount_cents)),
      }))
    );
    if (insertError) return { error: insertError.message };
  }

  // Deposit is re-derived on every save so it always reflects the current
  // total -- editing line items after setting the schedule must not leave
  // a stale deposit behind.
  const deposit = depositCents(
    estimate.total_cents,
    estimate.deposit_percent_bp,
    estimate.deposit_cap_cents
  );
  await supabase
    .from("estimates")
    .update({ deposit_cents: deposit, updated_at: new Date().toISOString() })
    .eq("id", estimateId);

  revalidateEstimates(estimateId);
  return { recalled: lock.recalled, scheduledCents: deposit + clean.reduce((s, p) => s + p.amount_cents, 0) };
}

/**
 * Seeds a schedule: the standard remodel phases, splitting the balance
 * after the deposit evenly and to the cent.
 */
/**
 * Builds the default payment schedule.
 *
 * Returns the phases it wrote. The panel used to rely on router.refresh()
 * handing it fresh props, which it does not do for this subtree -- so the
 * five phases landed in the database and the screen went on showing
 * whatever was there before, with no error. A button that silently
 * succeeds while looking dead is worse than one that fails.
 */
export async function generateEstimateSchedule(
  estimateId: string
): Promise<{ error?: string; phases?: { name: string; description: string; amount_cents: number }[] }> {
  const guard = await requireEstimateEditor();
  if ("error" in guard) return guard;

  const supabase = await createClient();
  const { data: estimate } = await supabase
    .from("estimates")
    .select("id, status, total_cents, deposit_percent_bp, deposit_cap_cents")
    .eq("id", estimateId)
    .eq("company_id", guard.companyId)
    .maybeSingle<PaymentEstimateRow>();
  if (!estimate) return { error: "Estimate not found." };
  if (!estimate.total_cents) return { error: "Add line items before building a payment schedule." };

  const deposit = depositCents(
    estimate.total_cents,
    estimate.deposit_percent_bp,
    estimate.deposit_cap_cents
  );
  const balance = balanceAfterDepositCents(estimate.total_cents, deposit);
  const amounts = splitEvenlyCents(balance, DEFAULT_PAYMENT_PHASES.length);

  const phases = DEFAULT_PAYMENT_PHASES.map((phase, i) => ({
    name: phase.name,
    description: phase.description,
    amount_cents: amounts[i] ?? 0,
  }));

  const saved = await saveEstimatePayments(estimateId, phases);
  if (saved.error) return { error: saved.error };
  return { phases };
}

type LockCheck = { locked: boolean; recalled: boolean };

/**
 * Shared gate for every write to an estimate's contents.
 *
 * Blocks only once a customer has signed. Below that line, editing a
 * document that is already out with the customer pulls it back to Draft
 * and bumps the version: they were sent a link to a specific set of
 * numbers, and letting those change under them means they could sign
 * something they never read. Reverting to Draft also makes the portal
 * page refuse it, so the stale link stops working immediately.
 */
async function guardEstimateEdit(
  supabase: Awaited<ReturnType<typeof createClient>>,
  estimateId: string,
  companyId: string,
  status: EstimateStatus,
  version: number
): Promise<LockCheck> {
  const { data: signers } = await supabase
    .from("estimate_signers")
    .select("id, party, signed_at")
    .eq("estimate_id", estimateId)
    .returns<{ id: string; party: "company" | "customer"; signed_at: string | null }[]>();

  if (estimateLocked(status, signers ?? [])) return { locked: true, recalled: false };
  if (!editWillRecallEstimate(status)) return { locked: false, recalled: false };

  await supabase
    .from("estimates")
    .update({
      status: "Draft" as EstimateStatus,
      version: version + 1,
      viewed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", estimateId)
    .eq("company_id", companyId);

  // The contractor signed at send time to stand behind those numbers.
  // Different numbers need a fresh signature, added again on the next
  // send rather than carried over.
  await supabase
    .from("estimate_signers")
    .delete()
    .eq("estimate_id", estimateId)
    .eq("party", "company");

  return { locked: false, recalled: true };
}

export type LeadEstimateSummary = {
  id: string;
  doc_number: string;
  title: string;
  status: EstimateStatus;
  total_cents: number;
};

export type LeadEstimatesResult = {
  estimates: LeadEstimateSummary[];
  canCreate: boolean;
  /**
   * Whether this person has estimate access at all.
   *
   * Separate from an empty list, which it used to be conflated with.
   * "You may not open estimates" and "this contact has none you can see"
   * are different facts, and collapsing them made the control disappear
   * without explanation -- read as the feature being missing.
   */
  canView: boolean;
  /** Settled money across every estimate on this lead. */
  paidCents: number;
};

/** Estimates on one lead, newest first, for the lead modal's button. */
export async function getEstimatesForLead(
  leadId: string
): Promise<LeadEstimatesResult> {
  const profile = await getCurrentProfile();
  if (!profile || !canViewEstimates(profile))
    return { estimates: [], canCreate: false, canView: false, paidCents: 0 };

  const supabase = await createClient();
  const { data: docs } = await supabase
    .from("estimates")
    .select("id, doc_number, title, status, total_cents, kind")
    .eq("lead_id", leadId)
    .eq("company_id", profile.company_id)
    .order("created_at", { ascending: false })
    .returns<(LeadEstimateSummary & { kind: string | null })[]>();
  // Invoices aren't estimates to open or start from -- a customer billed
  // only a permit fee still gets "+ Estimate" -- but money paid on them
  // is money in, so it stays in the paid figure.
  const data = (docs ?? [])
    .filter((e) => e.kind !== "invoice")
    .map(({ kind: _kind, ...e }) => e);

  const ids = (docs ?? []).map((e) => e.id);
  let paidCents = 0;
  if (ids.length) {
    const { data: paidRows } = await supabase
      .from("portal_payments")
      .select("amount_cents, status")
      .in("estimate_id", ids)
      .returns<{ amount_cents: number; status: string }[]>();
    paidCents = paidTotalCents((paidRows ?? []) as never);
  }

  return {
    estimates: data,
    canCreate: canCreateEstimates(profile),
    canView: true,
    paidCents,
  };
}

/**
 * One-click route from a lead to its estimate: opens the newest one, or
 * starts one if there is none.
 *
 * The lead's own project type seeds the title, so the rep is not naming
 * the same job twice -- and the scope library matches on that type, so a
 * titled estimate immediately draws the right examples.
 */
export async function openOrCreateEstimateForLead(
  leadId: string
): Promise<{ error?: string; id?: string; created?: boolean }> {
  const { estimates } = await getEstimatesForLead(leadId);
  if (estimates.length > 0) return { id: estimates[0].id };

  const guard = await requireEstimateEditor();
  if ("error" in guard) return guard;

  const supabase = await createClient();
  const { data: lead } = await supabase
    .from("leads")
    .select("project_type")
    .eq("id", leadId)
    .eq("company_id", guard.companyId)
    .maybeSingle<{ project_type: string | null }>();

  const res = await createEstimate(leadId, lead?.project_type || "Estimate");
  if (res.error) return { error: res.error };
  return { id: res.id, created: true };
}

export type LeadEstimateRow = {
  id: string;
  doc_number: string | null;
  title: string | null;
  status: string;
  kind: string | null;
  total_cents: number | null;
  signed_at: string | null;
  sent_at: string | null;
  created_at: string;
};

/**
 * The documents on one contact, for the Estimates tab of the lead window.
 *
 * Fetched on demand rather than loaded with every lead on the page: the
 * contacts list holds 1500 rows and almost none of them are being looked
 * at. Deliberately runs as the signed-in user, so RLS decides what comes
 * back -- a dispatcher gets the documents for leads that are theirs and
 * nothing else, exactly as on the Estimates page.
 */
export async function getLeadEstimates(
  leadId: string
): Promise<{ error?: string; estimates?: LeadEstimateRow[] }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canViewEstimates(profile)) return { estimates: [] };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("estimates")
    .select("id, doc_number, title, status, kind, total_cents, signed_at, sent_at, created_at")
    .eq("lead_id", leadId)
    .eq("company_id", profile.company_id)
    .order("created_at", { ascending: false });
  if (error) return { error: error.message };
  return { estimates: (data as LeadEstimateRow[]) ?? [] };
}

/**
 * The Save button's one round trip.
 *
 * Details and items used to go up as two separate server actions, and in
 * the App Router every action POST also re-renders this page on the
 * server -- so a single press of Save paid two full page renders plus
 * two auth checks before the button was released. Same work, one trip.
 */
export async function saveEstimateDraft(
  estimateId: string,
  details: {
    title: string;
    customer_message: string | null;
    terms: string | null;
    expires_at: string | null;
    start_date: string | null;
    completion_date: string | null;
    job_address?: string | null;
  },
  items: ItemInput[],
  discount?: DiscountInput
): Promise<{ error?: string; totalCents?: number; recalled?: boolean }> {
  const detail = await updateEstimateDetails(estimateId, details);
  if (detail.error) return { error: detail.error };
  return saveEstimateItems(estimateId, items, discount);
}

/**
 * Pause or resume a sold job on the Projects page.
 *
 * On Hold is the one project status that no document proves -- a
 * cancelled job has a voided contract and a finished one has a signed
 * completion certificate, but "the customer asked us to wait" exists
 * only in someone's head until it is written down. This is where it
 * gets written down.
 */
export async function setProjectHold(
  estimateId: string,
  onHold: boolean
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) {
    return { error: "Only Office or Admin can put a project on hold." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("estimates")
    .update({ project_on_hold: onHold })
    .eq("id", estimateId)
    .eq("company_id", profile.company_id)
    .eq("status", "Signed")
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) {
    // RLS refusals match zero rows without an error -- and a project
    // that is no longer a signed contract has a real status of its own.
    return { error: "Could not update that project." };
  }
  revalidatePath("/projects");
  return {};
}

/**
 * Records a document that was signed on paper, outside the system.
 *
 * The office builds the contract (or change order, or completion form)
 * with its payment stages exactly as usual, then marks it here: status,
 * signer row (signature_type 'paper' -- a staff member attesting to ink
 * on a page, never a fabricated e-signature), and every downstream
 * effect a portal signature has, via the same finalizeSignedEstimate the
 * portal calls -- so a paper contract behaves identically in Projects,
 * money, and checklists. Nothing is sent to the customer.
 *
 * Backdatable on purpose: the signed date drives stage due dates and
 * auto-checklist offsets, and the paper was signed when it was signed.
 */
export async function markSignedOnPaper(
  estimateId: string,
  input: { signerName: string; signedDate: string; scanFileName?: string | null }
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canCreateEstimates(profile)) {
    return { error: "You don't have access to record signatures." };
  }
  // A paper signature takes the document out of Draft without it ever
  // being sent -- the one way around "the office sends", so it needs the
  // same switch, and the same closer hold.
  if (!canSendEstimates(profile)) return { error: SEND_NOT_ALLOWED };
  const hold = await closerHoldError(profile, estimateId);
  if (hold) return { error: hold };

  const signerName = input.signerName.trim();
  if (!signerName) return { error: "Enter the name as it was signed." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.signedDate)) {
    return { error: "Pick the date it was signed." };
  }
  if (input.signedDate > (await companyToday())) {
    return { error: "The signing date can't be in the future." };
  }
  // Noon UTC: the paper knows the day, not the hour, and noon keeps the
  // date stable in every US timezone.
  const signedIso = `${input.signedDate}T12:00:00.000Z`;

  const supabase = await createClient();
  const { data: estimate } = await supabase
    .from("estimates")
    .select(
      "id, lead_id, company_id, status, total_cents, kind, parent_estimate_id, doc_number, title, assigned_to"
    )
    .eq("id", estimateId)
    .eq("company_id", profile.company_id)
    .maybeSingle<{
      id: string;
      lead_id: string;
      company_id: string;
      status: string;
      total_cents: number;
      kind: string | null;
      parent_estimate_id: string | null;
      doc_number: string;
      title: string | null;
      assigned_to: string | null;
    }>();
  if (!estimate) return { error: "That document couldn't be found." };
  if (estimate.status === "Signed") return { error: "This document is already signed." };
  if (estimate.status === "Void") {
    return { error: "This document was cancelled — un-cancel it before recording a signature." };
  }
  // A paper signature takes a Draft straight to Signed, which the
  // approval trigger refuses just the same -- asked here, before the
  // signer rows and the contact note are written for a status change
  // that then never happens.
  let selfApprove = false;
  if (estimate.status === "Draft") {
    const approval = await approvalGate(profile.company_id, estimateId, {
      canApprove: isStrictAdmin(profile),
      sendsWithoutApproval: profile.can_send_without_approval,
    });
    if ("error" in approval) return approval;
    selfApprove = approval.selfApprove;
  }

  const admin = createAdminClient();

  // The paper document carries every signature at once, so every
  // outstanding customer signer is marked from it. A document that
  // never had signer rows gets one, named as signed.
  const { data: signerRows } = await admin
    .from("estimate_signers")
    .select("id, party, signed_at")
    .eq("estimate_id", estimateId)
    .returns<{ id: string; party: string; signed_at: string | null }[]>();
  const unsigned = (signerRows ?? []).filter((s) => s.party === "customer" && !s.signed_at);
  if (unsigned.length) {
    await admin
      .from("estimate_signers")
      .update({
        signed_at: signedIso,
        signature_name: signerName,
        signature_type: "paper",
        signature_image: null,
      })
      .in("id", unsigned.map((s) => s.id));
  } else if (!(signerRows ?? []).some((s) => s.party === "customer")) {
    await admin.from("estimate_signers").insert({
      company_id: estimate.company_id,
      estimate_id: estimateId,
      party: "customer",
      name: signerName,
      sort_order: 0,
      signed_at: signedIso,
      signature_name: signerName,
      signature_type: "paper",
    });
  }

  if (selfApprove) {
    await recordSelfApproval({
      companyId: profile.company_id,
      estimateId,
      leadId: estimate.lead_id,
      docNumber: estimate.doc_number,
      userId: profile.id,
      senderName: profile.name || profile.email || null,
    });
  }

  await finalizeSignedEstimate(admin, estimate, signedIso);

  // The paper trail on the contact: who recorded it, who signed, when,
  // and whether the scan came along.
  await admin.from("lead_notes").insert({
    company_id: estimate.company_id,
    lead_id: estimate.lead_id,
    author_id: profile.id,
    body:
      `${estimate.doc_number} marked signed on paper by ${profile.name || profile.email || "staff"}. ` +
      `Signed by ${signerName} on ${input.signedDate}.` +
      (input.scanFileName ? ` Scan attached: ${input.scanFileName}.` : ""),
  });

  revalidatePath(`/estimates/${estimateId}`);
  revalidatePath("/estimates");
  return {};
}
