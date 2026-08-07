import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import type { Estimate, EstimateItem, EstimateSigner } from "@/lib/data/types";
import {
  EstimateDocument,
  type DocumentCompany,
  type DocumentCustomer,
} from "@/components/estimate-document";
import { AutoPrint, PrintButton } from "@/components/print-button";

export const dynamic = "force-dynamic";

/**
 * "Preview as Customer" -- the rep sees the exact document the homeowner
 * will open, from the same component the portal renders, before anything
 * is sent.
 */
export default async function EstimatePreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ print?: string }>;
}) {
  const { id } = await params;
  const { print } = await searchParams;
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const supabase = await createClient();
  const { data: estimate } = await supabase
    .from("estimates")
    .select("*")
    .eq("id", id)
    .eq("company_id", profile.company_id)
    .maybeSingle<Estimate>();
  if (!estimate) notFound();

  const [{ data: items }, { data: signers }, { data: company }, { data: lead }] =
    await Promise.all([
      supabase.from("estimate_items").select("*").eq("estimate_id", id).order("sort_order"),
      supabase.from("estimate_signers").select("*").eq("estimate_id", id).order("sort_order"),
      supabase
        .from("company_profile")
        .select(
          "name, address, phone, email, website, logo_url, license_number, license_state, license_type"
        )
        .eq("company_id", profile.company_id)
        .maybeSingle<DocumentCompany>(),
      supabase
        .from("leads")
        .select("first_name, last_name, email, phone, address")
        .eq("id", estimate.lead_id)
        .maybeSingle<DocumentCustomer>(),
    ]);

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Customer preview</h1>
          <p className="module-sub">Exactly what {estimate.doc_number} looks like to them.</p>
        </div>
        <div className="est-header-actions">
          <Link className="btn-ghost" href={`/estimates/${id}`}>
            Back to editor
          </Link>
          <PrintButton />
        </div>
      </div>
      <AutoPrint enabled={print === "1"} />
      <div className="estdoc-preview-frame">
        <EstimateDocument
          estimate={estimate}
          items={(items ?? []) as EstimateItem[]}
          signers={(signers ?? []) as EstimateSigner[]}
          company={company ?? null}
          customer={lead ?? null}
        />
      </div>
    </div>
  );
}
