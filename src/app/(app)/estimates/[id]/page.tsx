import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { canCreateEstimates, canDeleteLeads, canManageCosts, canViewEstimates, isStrictAdmin, type Estimate, type EstimateItem, type EstimateSigner, type EstimatePayment, type PortalPayment } from "@/lib/data/types";
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

  return (
    <EstimateBuilder
      estimate={estimate}
      customerViews={customerViews}
      items={(items ?? []) as EstimateItem[]}
      signers={(signers ?? []) as EstimateSigner[]}
      payments={(payments ?? []) as EstimatePayment[]}
      paid={(paidRows ?? []) as PortalPayment[]}
      lead={lead ?? null}
      canEdit={canCreateEstimates(profile)}
      // Separate from canEdit on purpose. A bookkeeper records what the
      // job cost without being able to touch the contract it is recorded
      // against -- which is the whole reason the Bookkeeping role exists.
      canManageCosts={canManageCosts(profile)}
      canVoid={isStrictAdmin(profile)}
      canDelete={canDeleteLeads(profile)}
    />
  );
}
