import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { canCreateEstimates, canDeleteLeads, canManageBills, canManageCosts, canSendEstimates, canViewEstimates, isStrictAdmin, type Estimate, type EstimateItem, type EstimateSigner, type EstimatePayment, type PortalPayment } from "@/lib/data/types";
import { paidTotalCents } from "@/lib/data/types";
import type { ChangeOrderBilling } from "@/lib/data/change-order-rollup";
import { EstimateBuilder, type BuilderLead } from "./estimate-builder";
import { CompletionEditor } from "./completion-editor";

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
      .select("id, first_name, last_name, email, phone, address")
      .eq("id", estimate.lead_id)
      .maybeSingle<BuilderLead>(),
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
        }}
        canEdit={canCreateEstimates(profile)}
        canSend={canSendEstimates(profile)}
        canDelete={canDeleteLeads(profile)}
      />
    );
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
      canEdit={canCreateEstimates(profile)}
      // Drafts only when off: the Users & Roles "Send Estimates" switch.
      canSend={canSendEstimates(profile)}
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
