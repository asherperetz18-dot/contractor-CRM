import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortalViewer } from "@/lib/portal/session";
import { estimateExpired, type Estimate, type EstimateItem, type EstimateSigner, type EstimatePayment, type PortalPayment } from "@/lib/data/types";
import {
  EstimateDocument,
  type DocumentCompany,
} from "@/components/estimate-document";
import { PrintButton } from "@/components/print-button";
import { markEstimateViewed } from "@/lib/actions/portal-estimates";
import { PortalEstimateActions } from "./portal-estimate-actions";
import { DepositPayment } from "./deposit-payment";
import { getDepositState } from "@/lib/actions/portal-payments";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your estimate" };

export default async function PortalEstimatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ paid?: string }>;
}) {
  const { id } = await params;
  const { paid } = await searchParams;
  const viewer = await getPortalViewer();
  if (!viewer) redirect("/portal");

  const admin = createAdminClient();
  const { data: estimate } = await admin
    .from("estimates")
    .select("*")
    .eq("id", id)
    .maybeSingle<Estimate>();

  // The portal runs on the service role, so RLS is not what separates one
  // customer's documents from another's -- this check is.
  if (!estimate || estimate.lead_id !== viewer.lead.id) redirect("/portal/home");

  // A draft has never been sent; it must not be readable just because
  // somebody guessed at the id.
  if (estimate.status === "Draft") redirect("/portal/home");

  await markEstimateViewed(id);

  const [{ data: items }, { data: signers }, { data: payments }, { data: paidRows }, { data: company }] = await Promise.all([
    admin.from("estimate_items").select("*").eq("estimate_id", id).order("sort_order"),
    admin.from("estimate_signers").select("*").eq("estimate_id", id).order("sort_order"),
    admin.from("estimate_payments").select("*").eq("estimate_id", id).order("sort_order"),
    admin.from("portal_payments").select("id, estimate_id, kind, amount_cents, status, method, paid_at, created_at").eq("estimate_id", id),
    admin
      .from("company_profile")
      .select(
        "name, address, phone, email, website, logo_url, license_number, license_state, license_type"
      )
      .eq("company_id", estimate.company_id)
      .maybeSingle<DocumentCompany>(),
  ]);

  const signerRows = (signers ?? []) as EstimateSigner[];
  const mine = signerRows.find((s) => s.party === "customer" && !s.signed_at);
  const isExpired = estimateExpired(estimate);

  return (
    <main className="portal-shell">
      {/* Customers ask for a copy for their records, their lender, or
          their spouse -- so the print control is on their view too, not
          only the office's. */}
      <div className="estdoc-print-bar">
        <PrintButton label="Print / Save as PDF" />
      </div>
      <EstimateDocument
        estimate={estimate}
        items={(items ?? []) as EstimateItem[]}
        signers={signerRows}
        payments={(payments ?? []) as EstimatePayment[]}
        paid={(paidRows ?? []) as PortalPayment[]}
        company={company ?? null}
        customer={viewer.lead}
      />
      <DepositPayment
        estimateId={id}
        state={await getDepositState(id)}
        justPaid={paid === "1"}
      />
      <PortalEstimateActions
        estimateId={id}
        status={estimate.status}
        expired={isExpired}
        canSign={!!mine}
        signerName={mine?.name ?? ""}
      />
    </main>
  );
}
