import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { canCreateEstimates, canDeleteLeads, canManageBills, canManageCosts, canSendEstimates, canViewEstimates, isAdminRole, isStrictAdmin, type Estimate, type EstimateItem, type EstimateSigner, type EstimatePayment, type PortalPayment } from "@/lib/data/types";
import { paidTotalCents } from "@/lib/data/types";
import { closerHoldsSend, closerHoldMessage } from "@/lib/estimate-closer-gate";
import { approvalOnSend, approvalHoldMessage } from "@/lib/estimate-approval-gate";
import type { ChangeOrderBilling } from "@/lib/data/change-order-rollup";
import { EstimateBuilder, type BuilderLead } from "./estimate-builder";
import { estimateRepLine } from "@/lib/estimate-rep-line";
import { CompletionEditor } from "./completion-editor";
import { InvoiceView, type InvoiceLineCost } from "./invoice-view";

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
      .select("id, estimate_id, estimate_payment_id, kind, amount_cents, status, method, paid_at, created_at")
      .eq("estimate_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("leads")
      .select("id, first_name, last_name, email, phone, address, second_contact_email, assigned_to")
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
          name:
            [lead?.first_name, lead?.last_name].filter(Boolean).join(" ").trim() ||
            "Unnamed lead",
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
    return (
      <InvoiceView
        invoice={estimate}
        items={lines}
        phase={((payments ?? []) as EstimatePayment[])[0] ?? null}
        paid={(paidRows ?? []) as PortalPayment[]}
        customer={{
          id: estimate.lead_id,
          name: [lead?.first_name, lead?.last_name].filter(Boolean).join(" ").trim() || "Customer",
          phone: lead?.phone ?? null,
        }}
        parent={parentRow ?? null}
        costs={Object.fromEntries((costRows ?? []).map((c) => [c.id, c]))}
        canBill={canCreateEstimates(profile)}
        canRecord={canManageBills(profile)}
      />
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

  return (
    <EstimateBuilder
      estimate={estimate}
      customerViews={customerViews}
      items={(items ?? []) as EstimateItem[]}
      signers={(signers ?? []) as EstimateSigner[]}
      payments={(payments ?? []) as EstimatePayment[]}
      paid={(paidRows ?? []) as PortalPayment[]}
      changeOrderBilling={changeOrderBilling}
      lead={lead ?? null}
      rep={{
        name: repLine.repId ? rep?.name || rep?.email || "Unnamed" : null,
        followsLead: repLine.followsLead,
      }}
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
  );
}
