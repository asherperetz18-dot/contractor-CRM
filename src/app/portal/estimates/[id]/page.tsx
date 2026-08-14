import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortalViewer } from "@/lib/portal/session";
import { estimateExpired, type Estimate, type EstimateItem, type EstimateSigner, type EstimatePayment, type EstimateGroup, type EstimatePhoto, type PortalPayment } from "@/lib/data/types";
import { getEstimateTeam } from "@/lib/estimate-team";
import { getParentContract } from "@/lib/actions/change-orders";
import {
  EstimateDocument,
  type DocumentCompany,
} from "@/components/estimate-document";
import { PrintButton } from "@/components/print-button";
import { markEstimateViewed } from "@/lib/actions/portal-estimates";
import { PortalEstimateActions } from "./portal-estimate-actions";
import { DepositPayment } from "./deposit-payment";
import { PhasePayments } from "./phase-payments";
import { getDepositState, getPortalPhases } from "@/lib/actions/portal-payments";

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

  const [{ data: items }, { data: signers }, { data: payments }, { data: paidRows }, { data: company }, { data: photoRows }, { data: sectionRows }] = await Promise.all([
    admin.from("estimate_items").select("*").eq("estimate_id", id).order("sort_order"),
    admin.from("estimate_signers").select("*").eq("estimate_id", id).order("sort_order"),
    admin.from("estimate_payments").select("*").eq("estimate_id", id).order("sort_order"),
    admin.from("portal_payments").select("id, estimate_id, estimate_payment_id, kind, amount_cents, status, method, paid_at, created_at").eq("estimate_id", id),
    admin
      .from("company_profile")
      .select(
        "name, dba, address, phone, email, website, logo_url, license_number, license_state, license_type"
      )
      .eq("company_id", estimate.company_id)
      .maybeSingle<DocumentCompany>(),
    // Scoped to this document, not to the lead. Only what somebody
    // deliberately attached reaches the customer -- the rest of the job's
    // photos stay internal.
    admin
      .from("estimate_files")
      .select("id, estimate_id, estimate_item_id, lead_file_id, caption, sort_order, lead_files ( file_name, file_url, content_type )")
      .eq("estimate_id", id)
      .order("sort_order")
      .returns<
        {
          id: string;
          estimate_id: string;
          estimate_item_id: string | null;
          lead_file_id: string;
          caption: string | null;
          sort_order: number;
          lead_files: { file_name: string; file_url: string; content_type: string | null } | null;
        }[]
      >(),
    // Sections, read here rather than through the staff action: the
    // portal has a customer session, not a CRM profile.
    admin
      .from("estimate_groups")
      .select("id, estimate_id, name, description, sort_order")
      .eq("estimate_id", id)
      .order("sort_order")
      .returns<EstimateGroup[]>(),
  ]);

  const photos: EstimatePhoto[] = (photoRows ?? []).map((r) => ({
    id: r.id,
    estimate_id: r.estimate_id,
    estimate_item_id: r.estimate_item_id,
    lead_file_id: r.lead_file_id,
    caption: r.caption,
    sort_order: r.sort_order,
    file_name: r.lead_files?.file_name ?? "Photo",
    file_url: r.lead_files?.file_url ?? "",
    content_type: r.lead_files?.content_type ?? null,
  }));

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
        photos={photos}
        sections={sectionRows ?? []}
        company={company ?? null}
        customer={viewer.lead}
        team={await getEstimateTeam(id, estimate.lead_id, estimate.assigned_to, estimate.status)}
        parent={await getParentContract(estimate.parent_estimate_id)}
      />
      <DepositPayment
        estimateId={id}
        state={await getDepositState(id)}
        justPaid={paid === "1"}
      />
      {/* Progress payments sit below the deposit: the deposit comes first
          in time, so it comes first on the page. */}
      <PhasePayments phases={await getPortalPhases(id)} />
      <PortalEstimateActions
        estimateId={id}
        status={estimate.status}
        expired={isExpired}
        canSign={!!mine}
        signerName={mine?.name ?? ""}
        parentContract={
          estimate.parent_estimate_id
            ? {
                id: estimate.parent_estimate_id,
                doc_number:
                  (await getParentContract(estimate.parent_estimate_id))?.doc_number ?? "your contract",
              }
            : null
        }
        kind={estimate.kind}
      />
    </main>
  );
}
