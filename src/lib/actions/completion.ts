"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { canCreateEstimates, moneyCents, type EstimateStatus } from "@/lib/data/types";
import { fillContract } from "@/lib/contracts/merge";
import { DEFAULT_COMPLETION_CERTIFICATE } from "@/lib/contracts/completion";

type ContractRow = {
  id: string;
  company_id: string;
  lead_id: string;
  doc_number: string;
  status: EstimateStatus;
  total_cents: number;
  assigned_to: string | null;
  kind: string;
};

/**
 * Raises the completion certificate for a finished job.
 *
 * One per contract: a second would leave two documents each claiming to
 * be the moment the warranty started. Reopens the existing one instead if
 * it has not been signed.
 */
export async function createCompletionCertificate(
  contractId: string,
  completedOn: string,
  outstanding: string
): Promise<{ error?: string; id?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canCreateEstimates(profile))
    return { error: "You don't have permission to do that." };

  const supabase = await createClient();
  const { data: contract } = await supabase
    .from("estimates")
    .select("id, company_id, lead_id, doc_number, status, total_cents, assigned_to, kind")
    .eq("id", contractId)
    .eq("company_id", profile.company_id)
    .maybeSingle<ContractRow>();
  if (!contract) return { error: "Contract not found." };
  if (contract.kind !== "contract")
    return { error: "A completion certificate belongs to a contract." };
  if (contract.status !== "Signed")
    return { error: "This contract isn't signed yet." };

  const { data: existing } = await supabase
    .from("estimates")
    .select("id, status")
    .eq("parent_estimate_id", contractId)
    .eq("kind", "completion")
    .maybeSingle<{ id: string; status: EstimateStatus }>();
  if (existing) {
    if (existing.status === "Signed")
      return { error: "This job already has a signed completion certificate." };
    return { id: existing.id };
  }

  // The company's own wording if they have edited one, otherwise the
  // default -- seeded rather than hard-coded so it can be changed.
  const { data: template } = await supabase
    .from("contract_templates")
    .select("body")
    .eq("company_id", profile.company_id)
    .eq("kind", "completion")
    .eq("is_default", true)
    .maybeSingle<{ body: string }>();

  const [{ data: lead }, { data: settings }, { data: changes }] = await Promise.all([
    supabase
      .from("leads")
      .select("first_name, last_name, address")
      .eq("id", contract.lead_id)
      .maybeSingle<{ first_name: string | null; last_name: string | null; address: string | null }>(),
    supabase
      .from("company_profile")
      .select("name, address, phone, email, license_number")
      .eq("company_id", profile.company_id)
      .maybeSingle<{
        name: string | null;
        address: string | null;
        phone: string | null;
        email: string | null;
        license_number: string | null;
      }>(),
    // "Complete per contract" has to mean the amended scope, so the
    // signed change orders are named on the certificate itself.
    supabase
      .from("estimates")
      .select("doc_number, title, total_cents")
      .eq("parent_estimate_id", contractId)
      .eq("kind", "change_order")
      .eq("status", "Signed")
      .returns<{ doc_number: string; title: string; total_cents: number }[]>(),
  ]);

  const day = (d: string) =>
    new Date(`${d}T00:00:00`).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

  let body = fillContract(template?.body || DEFAULT_COMPLETION_CERTIFICATE, {
    contract_no: contract.doc_number,
    contract_date: day(completedOn),
    completion_date: day(completedOn),
    client_name: [lead?.first_name, lead?.last_name].filter(Boolean).join(" ").trim(),
    project_address: lead?.address,
    contract_total: moneyCents(contract.total_cents),
    company_name: settings?.name,
    company_address: settings?.address,
    company_phone: settings?.phone,
    company_email: settings?.email,
    license_no: settings?.license_number,
  });

  if (changes?.length) {
    body +=
      "\n\nChange orders included in this completion:\n" +
      changes
        .map((c) => `- ${c.doc_number}: ${c.title} (${moneyCents(c.total_cents)})`)
        .join("\n");
  }
  if (outstanding.trim()) {
    body += `\n\nOutstanding items:\n${outstanding.trim()}`;
  } else {
    body += "\n\nOutstanding items: none. The Owner accepts the work in full.";
  }

  const { count } = await supabase
    .from("estimates")
    .select("id", { count: "exact", head: true })
    .eq("parent_estimate_id", contractId);

  const { data: created, error } = await supabase
    .from("estimates")
    .insert({
      company_id: profile.company_id,
      lead_id: contract.lead_id,
      parent_estimate_id: contract.id,
      kind: "completion",
      doc_number: `${contract.doc_number}-COMP`,
      title: "Certificate of Completion",
      status: "Draft" as EstimateStatus,
      assigned_to: contract.assigned_to ?? profile.id,
      // No money on this document at all -- it records acceptance, not a
      // price, and a total here would be a second figure for one job.
      tax_rate_bp: 0,
      subtotal_cents: 0,
      tax_cents: 0,
      total_cents: 0,
      deposit_percent_bp: 0,
      deposit_cap_cents: 0,
      deposit_cents: 0,
      terms: body,
      completed_on: completedOn,
      completion_notes: outstanding.trim() || null,
      created_by: profile.id,
    })
    .select("id")
    .returns<{ id: string }[]>();
  if (error) return { error: error.message };
  if (!created?.length) return { error: "Couldn't create the certificate." };
  void count;

  const { data: signers } = await supabase
    .from("estimate_signers")
    .select("party, name, email, phone, sort_order")
    .eq("estimate_id", contract.id)
    .eq("party", "customer")
    .returns<
      { party: string; name: string; email: string | null; phone: string | null; sort_order: number }[]
    >();
  if (signers?.length) {
    await supabase.from("estimate_signers").insert(
      signers.map((s) => ({
        company_id: profile.company_id,
        estimate_id: created[0].id,
        party: s.party,
        name: s.name,
        email: s.email,
        phone: s.phone,
        sort_order: s.sort_order,
      }))
    );
  }

  revalidatePath(`/estimates/${contractId}`);
  return { id: created[0].id };
}

export type CompletionRow = {
  id: string;
  doc_number: string;
  status: EstimateStatus;
  completed_on: string | null;
  completion_notes: string | null;
};

export async function getCompletionCertificate(
  contractId: string
): Promise<{ error?: string; certificate?: CompletionRow | null }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("estimates")
    .select("id, doc_number, status, completed_on, completion_notes")
    .eq("parent_estimate_id", contractId)
    .eq("kind", "completion")
    .maybeSingle<CompletionRow>();
  if (error) return { error: error.message };
  return { certificate: data ?? null };
}
