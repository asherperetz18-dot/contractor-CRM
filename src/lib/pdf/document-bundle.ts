import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { CompanyWords } from "@/lib/company-words";
import type { Estimate, EstimateGroup, EstimateItem, EstimatePayment, EstimateSigner } from "@/lib/data/types";
import type { DocumentPdfBundle } from "./document-pdf";

/**
 * Everything one document's PDF is drawn from, read with the service
 * role: the document, its lines, signers, live payment stages and
 * sections, the company's letterhead, the customer and the contract it
 * belongs to. Shared by the Drive backup and an emailed invoice's PDF
 * (DECISIONS #150), so both print the same thing. Null when the
 * document isn't this company's.
 */

type Admin = ReturnType<typeof createAdminClient>;

export type DocumentPdfLead = {
  contact_type: string | null;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
};

export async function loadDocumentPdfBundle(
  admin: Admin,
  companyId: string,
  estimateId: string,
  words: CompanyWords
): Promise<{ bundle: DocumentPdfBundle; lead: DocumentPdfLead | null } | null> {
  type EstimateRow = Estimate & { parent_estimate_id?: string | null };
  const [est, items, signers, payments, groups, companyRes] = await Promise.all([
    admin.from("estimates").select("*").eq("id", estimateId).eq("company_id", companyId).maybeSingle<EstimateRow>(),
    admin.from("estimate_items").select("*").eq("estimate_id", estimateId).order("sort_order").returns<EstimateItem[]>(),
    admin.from("estimate_signers").select("*").eq("estimate_id", estimateId).order("sort_order").returns<EstimateSigner[]>(),
    admin
      .from("estimate_payments")
      .select("*")
      .eq("estimate_id", estimateId)
      .order("sort_order")
      .returns<(EstimatePayment & { cancelled_at?: string | null })[]>(),
    admin.from("estimate_groups").select("*").eq("estimate_id", estimateId).order("sort_order").returns<EstimateGroup[]>(),
    admin
      .from("company_profile")
      .select("name, address, phone, email, website, logo_url, license_number, license_state, license_type, timezone")
      .eq("company_id", companyId)
      .maybeSingle<NonNullable<DocumentPdfBundle["company"]>>(),
  ]);
  const estimate = est.data;
  if (!estimate) return null;

  const [{ data: lead }, parent] = await Promise.all([
    admin
      .from("leads")
      .select("contact_type, first_name, last_name, company_name, address, phone, email")
      .eq("id", estimate.lead_id)
      .maybeSingle<DocumentPdfLead>(),
    estimate.parent_estimate_id
      ? admin
          .from("estimates")
          .select("doc_number, total_cents, signed_at")
          .eq("id", estimate.parent_estimate_id)
          .maybeSingle<{ doc_number: string; total_cents: number; signed_at: string | null }>()
          .then((r) => r.data)
      : Promise.resolve(null),
  ]);

  return {
    lead: lead ?? null,
    bundle: {
      estimate,
      items: items.data ?? [],
      signers: signers.data ?? [],
      payments: (payments.data ?? []).filter((p) => !p.cancelled_at),
      sections: groups.data ?? [],
      company: companyRes.data ?? null,
      customer: lead ?? null,
      parent: parent ?? null,
      words,
    },
  };
}
