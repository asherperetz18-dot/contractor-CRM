import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { canCreateEstimates, canDeleteLeads, canManageBills, canManageCosts, canSendEstimates, canViewEstimates, isAdminRole, isStrictAdmin, type Estimate, type EstimateItem, type EstimateSigner, type EstimatePayment, type PortalPayment } from "@/lib/data/types";
import { depositCents, paidTotalCents, type BillCreditRow } from "@/lib/data/types";
import { estimateLender, financingOffered, readFinancing } from "@/lib/financing";
import { openPaymentChange, type PaymentChangeRow } from "@/lib/payment-change";
import { isMissingSchemaError } from "@/lib/schema-drift";
import type { FinancingPanelData, FinancingStep } from "./financing-panel";
import { closerHoldsSend, closerHoldMessage } from "@/lib/estimate-closer-gate";
import { approvalOnSend, approvalHoldMessage } from "@/lib/estimate-approval-gate";
import type { ChangeOrderBilling } from "@/lib/data/change-order-rollup";
import { EstimateBuilder, type BuilderLead } from "./estimate-builder";
import { estimateRepLine } from "@/lib/estimate-rep-line";
import { clientName } from "@/lib/data/client-name";
import { CompletionEditor } from "./completion-editor";
import { InvoiceView, type InvoiceLineCost } from "./invoice-view";
import { InvoiceDraftEditor } from "./invoice-draft-editor";
import { BillRemindersProvider, type SentReminder } from "@/components/invoices/reminders-toggle";

export const dynamic = "force-dynamic";

export default async function EstimateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await getCurrentProfile();
  if (!profile) return null;
  if (!canViewEstimates(profile)) notFound();

  const supabase = await createClient();
  const { data: estimate } = await supabase
    .from("estimates")
    .select("*")
    .eq("id", id)
    .eq("company_id", profile.company_id)
    .maybeSingle<Estimate>();
  if (!estimate) notFound();

  const [{ data: items }, { data: signers }, { data: payments }, { data: paidRows }, { data: lead }] = await Promise.all([
    supabase
      .from("estimate_items")
      .select("*")
      .eq("estimate_id", id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("estimate_signers")
      .select("*")
      .eq("estimate_id", id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("estimate_payments")
      .select("*")
      .eq("estimate_id", id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("portal_payments")
      .select("id, estimate_id, estimate_payment_id, kind, amount_cents, status, method, paid_at, created_at, stripe_session_id, stripe_payment_intent_id")
      .eq("estimate_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("leads")
      .select("id, contact_type, company_name, first_name, last_name, email, phone, address, second_contact_email, assigned_to")
      .eq("id", estimate.lead_id)
      .maybeSingle<BuilderLead & { assigned_to: string | null }>(),
  ]);

  // A completion certificate has no prices, so it does not get the
  // pricing editor. Branching here rather than hiding controls inside the
  // builder: half a builder with the money taken out still reads as an
  // estimate, and every one of those controls would need its own guard.
  if (estimate.kind === "completion") {
    return (
      <CompletionEditor
        estimate={estimate}
        signers={(signers ?? []) as EstimateSigner[]}
        customer={{
          name: clientName(lead) || "Unnamed lead",
          address: lead?.address ?? null,
          email: lead?.email ?? null,
          secondContactEmail: lead?.second_contact_email ?? null,
        }}
        canEdit={canCreateEstimates(profile)}
        canSend={canSendEstimates(profile)}
        canDelete={canDeleteLeads(profile)}
      />
    );
  }

  // Automatic payment reminders (0208, DECISIONS #152): whether the
  // company has them on, and which went on this document's bills. Their
  // own reads, so a database without 0208 just shows none.
  const stageIds = ((payments ?? []) as EstimatePayment[]).map((p) => p.id);
  const [{ data: reminderSetting }, { data: sentReminders }] = await Promise.all([
    supabase
      .from("company_profile")
      .select("bill_reminders_enabled")
      .eq("company_id", profile.company_id)
      .maybeSingle<{ bill_reminders_enabled: boolean | null }>(),
    stageIds.length
      ? supabase
          .from("bill_reminders")
          .select("estimate_payment_id, kind, sent_at")
          .eq("company_id", profile.company_id)
          .in("estimate_payment_id", stageIds)
          .returns<SentReminder[]>()
      : Promise.resolve({ data: [] as SentReminder[] }),
  ]);
  const remindersOn = reminderSetting?.bill_reminders_enabled === true;
  const remindersSent = sentReminders ?? [];

  // Credits given on this document's bills (0209, DECISIONS #154): their
  // own read, so a database without 0209 just shows none. Read whole, so
  // the removal columns (0213, #160) are there once it has run -- removed
  // credits included, for the office to see.
  const { data: creditRows } = await supabase
    .from("bill_credits")
    .select("*")
    .eq("company_id", profile.company_id)
    .eq("estimate_id", estimate.id)
    .order("created_at")
    .returns<BillCreditRow[]>();
  const credits = creditRows ?? [];

  // An invoice (a permit fee billed back) has nothing to build or send
  // for signature: its page is what was billed, what's come in, and the
  // Pay link / Record payment / Cancel that act on it.
  if (estimate.kind === "invoice") {
    const lines = (items ?? []) as (EstimateItem & { source_expense_id?: string | null })[];
    const costIds = lines.map((i) => i.source_expense_id).filter((id): id is string => !!id);
    const [{ data: costRows }, { data: parentRow }] = await Promise.all([
      costIds.length
        ? supabase
            .from("job_expenses")
            .select("id, receipt_url, receipt_path, spent_on, amount_cents")
            .eq("company_id", profile.company_id)
            .in("id", costIds)
            .returns<InvoiceLineCost[]>()
        : Promise.resolve({ data: [] as InvoiceLineCost[] }),
      estimate.parent_estimate_id
        ? supabase
            .from("estimates")
            .select("id, doc_number")
            .eq("id", estimate.parent_estimate_id)
            .eq("company_id", profile.company_id)
            .maybeSingle<{ id: string; doc_number: string }>()
        : Promise.resolve({ data: null }),
    ]);
    const customer = {
      id: estimate.lead_id,
      name: clientName(lead) || "Customer",
      phone: lead?.phone ?? null,
      email: lead?.email || lead?.second_contact_email || null,
    };
    const costs = Object.fromEntries((costRows ?? []).map((c) => [c.id, c]));
    // A draft is still being written (DECISIONS #149); once issued it's a record.
    if (estimate.status === "Draft") {
      return (
        <InvoiceDraftEditor
          invoice={estimate}
          items={lines}
          customer={customer}
          parent={parentRow ?? null}
          costs={costs}
          canEdit={canCreateEstimates(profile)}
        />
      );
    }
    return (
      <BillRemindersProvider on={remindersOn} sent={remindersSent}>
        <InvoiceView
          invoice={estimate}
          items={lines}
          phase={((payments ?? []) as EstimatePayment[])[0] ?? null}
          paid={(paidRows ?? []) as PortalPayment[]}
          customer={customer}
          parent={parentRow ?? null}
          costs={costs}
          canBill={canCreateEstimates(profile)}
          canRecord={canManageBills(profile)}
          credits={credits}
        />
      </BillRemindersProvider>
    );
  }

  // The holds on sending, in the order a real send meets them: the
  // approval switch (0136) first, then the closer's. Resolved here so
  // the page can hide the send buttons and say what happens instead --
  // the server actions refuse a held send anyway; this stops the click
  // happening. Drafts only for the approval hold: a document already
  // out has passed the gate, whatever the switch says today.
  let sendHold: string | null = null;
  // True when the hold is the approval gate AND this viewer is an Admin:
  // the note then carries its own Approve button instead of sending them
  // to the Approvals screen.
  let sendHoldApprovable = false;
  if (canSendEstimates(profile) && estimate.status === "Draft") {
    const { data: gate } = await supabase
      .from("company_profile")
      .select("require_estimate_approval")
      .eq("company_id", profile.company_id)
      .maybeSingle<{ require_estimate_approval: boolean | null }>();
    // "self-approve" is not a hold: a person trusted to send without
    // approval keeps their Send button, and the send records it.
    const held =
      approvalOnSend({
        approvalRequired: gate?.require_estimate_approval === true,
        approvedAt: estimate.approved_at,
        sendsWithoutApproval: profile.can_send_without_approval,
      }) === "hold";
    if (held) {
      sendHoldApprovable = isStrictAdmin(profile);
      sendHold = approvalHoldMessage(estimate.doc_number, { canApprove: sendHoldApprovable });
    }
  }
  if (!sendHold && estimate.lead_id && canSendEstimates(profile) && !isAdminRole(profile)) {
    const { data: leadCloser } = await supabase
      .from("leads")
      .select("closer_id")
      .eq("id", estimate.lead_id)
      .maybeSingle<{ closer_id: string | null }>();
    const held = closerHoldsSend({
      closerId: leadCloser?.closer_id ?? null,
      userId: profile.id,
      officeOrAdmin: false,
      kind: estimate.kind,
    });
    if (held) {
      const { data: closer } = await supabase
        .from("profiles")
        .select("name, email")
        .eq("id", leadCloser!.closer_id!)
        .maybeSingle<{ name: string | null; email: string | null }>();
      sendHold = closerHoldMessage(closer?.name || closer?.email || null);
    }
  }

  // When the customer looked, newest first -- for the trail line under
  // the document header.
  const { data: viewRows } = await supabase
    .from("estimate_views")
    .select("viewed_at")
    .eq("estimate_id", id)
    .eq("company_id", profile.company_id)
    .order("viewed_at", { ascending: false })
    .limit(50);
  const customerViews = ((viewRows ?? []) as { viewed_at: string }[]).map((v) => v.viewed_at);

  // What each signed change order has collected on its own schedule. A
  // signed change order is one mirror row on this contract's schedule,
  // but its money usually lands against the change order's own phases --
  // without this the mirror row reads "Not billed" over cash in hand.
  let changeOrderBilling: ChangeOrderBilling[] = [];
  if (estimate.kind === "contract") {
    const { data: children } = await supabase
      .from("estimates")
      .select("id, doc_number")
      .eq("parent_estimate_id", id)
      .eq("company_id", profile.company_id)
      .eq("kind", "change_order")
      .returns<{ id: string; doc_number: string }[]>();
    if (children?.length) {
      const { data: coPayments } = await supabase
        .from("portal_payments")
        .select("estimate_id, status, amount_cents")
        .in("estimate_id", children.map((c) => c.id))
        .returns<Pick<PortalPayment, "estimate_id" | "status" | "amount_cents">[]>();
      changeOrderBilling = children.map((c) => {
        const on = (coPayments ?? []).filter((p) => p.estimate_id === c.id);
        return {
          doc_number: c.doc_number,
          paid_cents: paidTotalCents(on),
          pending_cents: on
            .filter((p) => p.status === "pending")
            .reduce((sum, p) => sum + (p.amount_cents || 0), 0),
        };
      });
    }
  }

  // The rep for the header: the same person every list names, read by
  // id from the whole roster so a past rep still shows by name.
  const repLine = estimateRepLine({
    status: estimate.status,
    estimateAssignedTo: estimate.assigned_to,
    leadAssignedTo: lead?.assigned_to,
  });
  const { data: rep } = repLine.repId
    ? await supabase
        .from("profiles")
        .select("name, email")
        .eq("id", repLine.repId)
        .maybeSingle<{ name: string | null; email: string | null }>()
    : { data: null };

  // Who voided it, read from the whole roster like the rep. Only a hand
  // void sets voided_by; a superseded version leaves it empty.
  // Financing on it (DECISIONS #161, #162): the company's lender and the
  // steps so far, each read on its own -- before 0214 or 0215 has run
  // there's simply nothing to show. Only on an estimate or contract
  // that's out, and only when there's a lender or a step to show.
  let financingPanel: FinancingPanelData | null = null;
  if (
    (estimate.kind === "contract" || estimate.kind === "change_order" || !estimate.kind) &&
    !["Draft", "Void", "Declined"].includes(estimate.status)
  ) {
    const [
      { data: financingRow },
      { data: stepRows, error: stepError },
      { error: followUpError },
      { data: changeRows, error: changeError },
    ] = await Promise.all([
      // Every column: the offer default and the lender's fee (0219, #169)
      // where they exist.
      supabase
        .from("company_profile")
        .select("*")
        .eq("company_id", profile.company_id)
        .maybeSingle<{
          financing_provider: string | null;
          financing_url: string | null;
          financing_offer_default?: boolean | null;
          financing_fee_bp?: number | null;
        }>(),
      supabase
        .from("estimate_financing_events")
        .select("*")
        .eq("company_id", profile.company_id)
        .eq("estimate_id", estimate.id)
        .order("created_at")
        .returns<(FinancingStep & { created_by: string | null; follow_up_task_id?: string | null; lender?: string | null })[]>(),
      // Follow-up reminders (DECISIONS #164) need 0216.
      supabase.from("estimate_financing_events").select("follow_up_task_id").limit(0),
      // Switched to financing after signing (0217, DECISIONS #166).
      supabase
        .from("contract_payment_changes")
        .select("*")
        .eq("company_id", profile.company_id)
        .eq("estimate_id", estimate.id)
        .order("created_at")
        .returns<PaymentChangeRow[]>(),
    ]);
    const companyLender = readFinancing(financingRow);
    // Who is financing this job (0218, DECISIONS #168): the company's
    // lender unless the estimate says the customer's own, or none.
    const choiceRow = estimate as typeof estimate & { financing_source?: string | null; financing_lender?: string | null };
    const choiceReady = "financing_source" in choiceRow;
    const lender = estimateLender(
      { source: choiceRow.financing_source ?? null, lender: choiceRow.financing_lender ?? null },
      companyLender
    );
    const steps = stepRows ?? [];
    const openChange = openPaymentChange(changeRows ?? []);
    // Always there once 0218 has run, so the customer's own lender can be
    // picked even when the company has none; before it, as before.
    if (choiceReady || lender || steps.length || openChange) {
      const ids = [...new Set(steps.map((s) => s.created_by).filter((x): x is string => !!x))];
      const { data: people } = ids.length
        ? await supabase.from("profiles").select("id, name, email").in("id", ids).returns<{ id: string; name: string | null; email: string | null }[]>()
        : { data: [] as { id: string; name: string | null; email: string | null }[] };
      const nameOf = (id: string | null) => {
        const p = (people ?? []).find((x) => x.id === id);
        return p ? p.name || p.email || null : null;
      };
      // The follow-up tasks steps put on someone's list, to show when
      // they're due and whether they're done.
      const taskIds = steps.map((s) => s.follow_up_task_id).filter((x): x is string => !!x);
      const { data: tasks } = taskIds.length
        ? await supabase
            .from("lead_tasks")
            .select("id, due_date, completed_at")
            .in("id", taskIds)
            .returns<{ id: string; due_date: string; completed_at: string | null }[]>()
        : { data: [] as { id: string; due_date: string; completed_at: string | null }[] };
      const followUpOf = (id: string | null | undefined) => {
        const t = id ? (tasks ?? []).find((x) => x.id === id) : null;
        return t ? { due: t.due_date, done: !!t.completed_at } : null;
      };
      financingPanel = {
        provider: lender?.name ?? null,
        own: !!lender?.own,
        choice: {
          source: (["company", "customer", "none"] as const).find((x) => x === choiceRow.financing_source) ?? null,
          lender: choiceRow.financing_lender ?? null,
          ready: choiceReady,
        },
        company: { name: financingRow?.financing_provider?.trim() || null, ready: !!companyLender },
        // Offering it to this customer, and what it would cost (#169).
        offer: {
          ready: "financing_offered" in choiceRow,
          offered: financingOffered(
            (choiceRow as { financing_offered?: boolean | null }).financing_offered,
            financingRow?.financing_offer_default
          ),
          feeBp: typeof financingRow?.financing_fee_bp === "number" ? financingRow.financing_fee_bp : null,
          totalCents: estimate.total_cents,
        },
        steps: steps.map((s) => ({
          id: s.id,
          status: s.status,
          amount_cents: s.amount_cents,
          note: s.note,
          created_at: s.created_at,
          channel: s.channel,
          by: nameOf(s.created_by),
          followUp: followUpOf(s.follow_up_task_id),
          lender: s.lender ?? null,
        })),
        ready: !isMissingSchemaError(stepError),
        followUpsReady: !followUpError,
        canWork: canCreateEstimates(profile) || canManageBills(profile),
        hasPhone: !!lead?.phone,
        hasEmail: !!lead?.email,
        // Funded can also record the payout (DECISIONS #163): for the people
        // who record payments, on a signed contract.
        canRecordPayment: canManageBills(profile) && estimate.status === "Signed",
        // A signed contract the customer would rather finance (#166).
        paymentChange: {
          ready: !changeError,
          canSwitch: estimate.status === "Signed" && (estimate.kind ?? "contract") === "contract" && !!lender,
          change: openChange
            ? {
                status: openChange.status as "sent" | "signed",
                lender: openChange.lender,
                financeCents: openChange.finance_cents,
                sentAt: openChange.created_at,
                signedName: openChange.signed_name,
                signedAt: openChange.signed_at,
              }
            : null,
        },
        loan:
          estimate.status === "Signed"
            ? {
                depositDueCents: depositCents(estimate.total_cents, estimate.deposit_percent_bp, estimate.deposit_cap_cents),
                stages: ((payments ?? []) as EstimatePayment[]).map((p) => ({
                  id: p.id,
                  name: p.name,
                  sort_order: p.sort_order,
                  amount_cents: p.amount_cents,
                  credit_cents: p.credit_cents ?? 0,
                  cancelled_at: (p as EstimatePayment & { cancelled_at?: string | null }).cancelled_at ?? null,
                  requested_at: p.requested_at ?? null,
                })),
                // With the Stripe ids, so a checkout opened and left counts
                // for nothing here too, as it does when it's recorded.
                payments: ((paidRows ?? []) as PortalPayment[]).map((p) => ({
                  estimate_payment_id: p.estimate_payment_id ?? null,
                  kind: p.kind,
                  status: p.status,
                  amount_cents: p.amount_cents,
                  stripe_session_id: p.stripe_session_id ?? null,
                  stripe_payment_intent_id: p.stripe_payment_intent_id ?? null,
                })),
              }
            : null,
      };
    }
  }

  const { data: voider } = estimate.voided_by
    ? await supabase
        .from("profiles")
        .select("name, email")
        .eq("id", estimate.voided_by)
        .maybeSingle<{ name: string | null; email: string | null }>()
    : { data: null };

  return (
    <BillRemindersProvider on={remindersOn} sent={remindersSent}>
      <EstimateBuilder
        estimate={estimate}
        customerViews={customerViews}
        items={(items ?? []) as EstimateItem[]}
        signers={(signers ?? []) as EstimateSigner[]}
        payments={(payments ?? []) as EstimatePayment[]}
        paid={(paidRows ?? []) as PortalPayment[]}
        changeOrderBilling={changeOrderBilling}
        credits={credits}
        financing={financingPanel}
        lead={lead ?? null}
        rep={{
          name: repLine.repId ? rep?.name || rep?.email || "Unnamed" : null,
          followsLead: repLine.followsLead,
        }}
        voidedByName={estimate.voided_by ? voider?.name || voider?.email || "Unnamed" : null}
        canEdit={canCreateEstimates(profile)}
        // Drafts only when off: the Users & Roles "Send Estimates" switch,
        // the approval gate while it waits on an admin, and the closer's
        // hold on a closer-led lead.
        canSend={canSendEstimates(profile) && !sendHold}
        sendHoldNote={sendHold}
        sendHoldApprovable={sendHoldApprovable}
        // Separate from canEdit on purpose. A bookkeeper records what the
        // job cost without being able to touch the contract it is recorded
        // against -- which is the whole reason the Bookkeeping role exists.
        canManageCosts={canManageCosts(profile)}
        canManageBills={canManageBills(profile)}
        canVoid={isStrictAdmin(profile)}
        canDelete={canDeleteLeads(profile)}
      />
    </BillRemindersProvider>
  );
}
