"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTwilioSms } from "@/lib/twilio-env";
import { getTwilioForCompany } from "@/lib/twilio-company";
import { createLoginToken, portalAccessExpiry, portalBaseUrl } from "@/lib/portal/session";
import { getCurrentProfile } from "@/lib/data/profile";
import { advanceStageOnEstimateSent } from "@/lib/pipeline/advance-stage";
import { fillContract, lateContractValues } from "@/lib/contracts/merge";
import { sendEmail, escapeHtml } from "@/lib/email-env";
import {
  balanceAfterDepositCents,
  canCreateEstimates,
  canDeleteEstimateStatus,
  canDeleteLeads,
  canViewEstimates,
  isStrictAdmin,
  depositCents,
  editWillRecallEstimate,
  estimateLocked,
  isPricelessKind,
  DEFAULT_PAYMENT_PHASES,
  splitEvenlyCents,
  computeEstimateTotals,
  lineTotalCents,
  moneyCents,
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
};

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
}) {
  const { customerName, company, docNumber, title, projectAddress, totalCents, link } = params;
  const greeting = customerName || "there";
  const amount = moneyCents(totalCents);
  const subject = `${company.name}: your proposal ${docNumber} is ready to review`;

  const safe = {
    greeting: escapeHtml(greeting),
    companyName: escapeHtml(company.name),
    docNumber: escapeHtml(docNumber),
    title: title ? escapeHtml(title) : null,
    projectAddress: projectAddress ? escapeHtml(projectAddress) : null,
    amount: escapeHtml(amount),
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

  // "on your {title} project" / "at {address}" are each dropped whole
  // rather than left with a blank behind them -- an estimate with no
  // title or a lead with no address must still read as a complete
  // sentence, not one with a hole in it.
  const onProjectClause = title ? ` on your ${title} project` : "";
  const atAddressClause = projectAddress ? ` at ${projectAddress}` : "";
  const safeOnProjectClause = safe.title ? ` on your ${safe.title} project` : "";
  const safeAtAddressClause = safe.projectAddress ? ` at ${safe.projectAddress}` : "";

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
      `Thank you for the opportunity to work with you${onProjectClause}.`,
      ``,
      `${company.name} has prepared proposal #${docNumber} for your project${atAddressClause}. The grand total of the proposal is ${amount}.`,
      ``,
      `Please use the link below to review the full proposal, including the scope of work and pricing. If everything looks good, you can also accept and sign the proposal directly online.`,
      ``,
      `View Proposal:`,
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
    // "View Proposal", never the link itself. The secure, single-use
    // token lives only in href, where a customer forwarding or
    // screen-sharing this email won't read it off the page by accident.
    html: `
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;line-height:1.5;color:#1a1a1a">
      <p>Hi ${safe.greeting},</p>
      <p>Thank you for the opportunity to work with you${safeOnProjectClause}.</p>
      <p>${safe.companyName} has prepared proposal #${safe.docNumber} for your project${safeAtAddressClause}. The grand total of the proposal is <strong>${safe.amount}</strong>.</p>
      <p>Please use the link below to review the full proposal, including the scope of work and pricing. If everything looks good, you can also accept and sign the proposal directly online.</p>
      <p><a href="${safe.link}" style="display:inline-block;background:#C2410C;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">View Proposal</a></p>
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
    .select("id, first_name, last_name, email, phone, address, assigned_to, company_id")
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
  const expires = new Date();
  expires.setDate(expires.getDate() + expiryDays);

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
      expires_at: expires.toISOString().slice(0, 10),
      created_by: guard.userId,
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (error) return { error: error.message };
  if (!created) return { error: "Could not create the estimate." };

  const customerName = [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim();
  if (customerName) {
    await supabase.from("estimate_signers").insert({
      company_id: guard.companyId,
      estimate_id: created.id,
      party: "customer",
      name: customerName,
      email: lead.email,
      phone: lead.phone,
      sort_order: 0,
    });
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
  items: ItemInput[]
): Promise<{ error?: string; totalCents?: number; recalled?: boolean }> {
  const guard = await requireEstimateEditor();
  if ("error" in guard) return guard;

  const supabase = await createClient();
  const { data: estimate, error: readError } = await supabase
    .from("estimates")
    .select("id, lead_id, status, version, tax_rate_bp, deposit_percent_bp, deposit_cap_cents")
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
  });

  for (const [i, item] of clean.entries()) {
    if (item.id) {
      const { error } = await supabase
        .from("estimate_items")
        .update(toRow(item, i))
        .eq("id", item.id)
        .eq("estimate_id", estimateId)
        .eq("company_id", guard.companyId);
      if (error) return { error: error.message };
    } else {
      const { error } = await supabase.from("estimate_items").insert(toRow(item, i));
      if (error) return { error: error.message };
    }
  }

  const totals = computeEstimateTotals(clean, estimate.tax_rate_bp);
  const { error: totalsError } = await supabase
    .from("estimates")
    .update({
      subtotal_cents: totals.subtotalCents,
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

// Marks the estimate as issued and stamps its total onto the lead.
//
// This write-back is the point of the whole module: 1,122 of 1,128 open
// leads have no value recorded, so Pipeline Value, Avg Deal Size and the
// rep leaderboard are all computed over almost nothing. Nobody fills in a
// "value" field; everybody writes an estimate.
export async function markEstimateSent(estimateId: string): Promise<{ error?: string }> {
  const guard = await requireEstimateEditor();
  if ("error" in guard) return guard;

  const supabase = await createClient();
  const { data: estimate, error: readError } = await supabase
    .from("estimates")
    .select("id, lead_id, status, total_cents, kind")
    .eq("id", estimateId)
    .eq("company_id", guard.companyId)
    .maybeSingle<SendEstimateRow>();
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

  // Before the status flips, so the contract carries its price the first
  // time anyone can open it.
  await fillContractMoney(estimateId, guard.companyId);

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
  const { data: signed } = await supabase
    .from("estimates")
    .select("total_cents")
    .eq("lead_id", estimate.lead_id)
    .eq("status", "Signed")
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
    .select("id, status, doc_number")
    .eq("id", estimateId)
    .eq("company_id", profile.company_id)
    .maybeSingle<{ id: string; status: EstimateStatus; doc_number: string }>();
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
export async function sendEstimateToCustomer(
  estimateId: string,
  channel: "text" | "email" | "both"
): Promise<{
  error?: string;
  sentTo?: string;
  channel?: "text" | "email" | "both";
  /** Set on a "both" send where one of the two channels didn't go out. */
  warning?: string;
}> {
  const guard = await requireEstimateEditor();
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

  const { data: lead } = await admin
    .from("leads")
    .select("id, first_name, last_name, address, phone, email, company_id")
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
  if (channel === "text") {
    if (!lead.phone) return { error: "This customer has no phone number on file." };
    if (!twilioEnv) return { error: "Texting isn't configured for this company yet." };
  } else if (channel === "email") {
    if (!lead.email) return { error: "This customer has no email address on file." };
  } else if (!lead.phone && !lead.email) {
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
  const canEmail = wantsEmail && !!lead.email;

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

  if (canEmail) {
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
    });
    const sent = await sendEmail(lead.email!, mail.subject, mail.html, mail.text, {
      replyTo: sender?.email ?? undefined,
    });
    if (sent.error) {
      problems.push(`Email failed (${sent.error})`);
    } else {
      sentTo.push(lead.email!);
      logRows.push({
        from_number: "email",
        to_number: lead.email!,
        body: `[Estimate emailed] ${mail.subject}`,
        twilio_sid: sent.id || null,
        channel: "email",
      });
    }
  } else if (wantsEmail && channel === "both" && !lead.email) {
    problems.push("no email address on file");
  }

  // Nothing went out at all -- report the failure and leave the estimate
  // untouched (still Draft), same as a single-channel send always has.
  if (sentTo.length === 0) {
    return { error: problems.join("; ") || "Could not send the estimate." };
  }

  await fillContractMoney(estimateId, guard.companyId);

  const now = new Date().toISOString();
  await admin
    .from("estimates")
    .update({ status: "Sent", sent_at: now, issued_at: now, updated_at: now })
    .eq("id", estimateId);

  // The proposal is out, so the board should say so. Revives a lead
  // written off as Lost, since sending an estimate contradicts that.
  await advanceStageOnEstimateSent(admin, estimate.lead_id, guard.companyId);

  // The contractor signs too -- the reference product shows documents as
  // "1 of 2 signed" with the rep already on them. Recording it at send
  // time means the customer sees a document the contractor has stood
  // behind, not a blank pair of signature lines.
  if (sender) {
    await admin.from("estimate_signers").insert({
      company_id: guard.companyId,
      estimate_id: estimateId,
      party: "company",
      name: sender.name || sender.email || "Contractor",
      email: sender.email,
      sort_order: -1,
      signed_at: now,
      signature_name: sender.name || sender.email,
    });
  }

  // Logged in the same thread the team already watches, so "did they ever
  // get anything?" stays answerable from data. One row per channel that
  // actually went out.
  for (const logRow of logRows) {
    await admin.from("sms_messages").insert({
      lead_id: lead.id,
      direction: "outbound",
      sent_by: guard.userId,
      company_id: guard.companyId,
      ...logRow,
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
    // Only on "both": a single explicit channel either already errored
    // above or fully succeeded, so it never has a partial problem to show.
    warning: channel === "both" && problems.length ? problems.join("; ") : undefined,
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
  /** Settled money across every estimate on this lead. */
  paidCents: number;
};

/** Estimates on one lead, newest first, for the lead modal's button. */
export async function getEstimatesForLead(
  leadId: string
): Promise<LeadEstimatesResult> {
  const profile = await getCurrentProfile();
  if (!profile || !canViewEstimates(profile)) return { estimates: [], canCreate: false, paidCents: 0 };

  const supabase = await createClient();
  const { data } = await supabase
    .from("estimates")
    .select("id, doc_number, title, status, total_cents")
    .eq("lead_id", leadId)
    .eq("company_id", profile.company_id)
    .order("created_at", { ascending: false })
    .returns<LeadEstimateSummary[]>();

  const ids = (data ?? []).map((e) => e.id);
  let paidCents = 0;
  if (ids.length) {
    const { data: paidRows } = await supabase
      .from("portal_payments")
      .select("amount_cents, status")
      .in("estimate_id", ids)
      .returns<{ amount_cents: number; status: string }[]>();
    paidCents = paidTotalCents((paidRows ?? []) as never);
  }

  return { estimates: data ?? [], canCreate: canCreateEstimates(profile), paidCents };
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
