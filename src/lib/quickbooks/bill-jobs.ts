import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * Which job each bill belongs to, for tagging its line in QuickBooks
 * (DECISIONS #184): the contract of the stage it's filed to (a change
 * order's or an invoice's contract), else the customer's only signed
 * contract, else just the customer. A bill moved to another job keeps its
 * old stage, so a stage on someone else's job doesn't count. A stage on a
 * voided contract: its signed revision (same number), else the customer.
 */

type Admin = ReturnType<typeof createAdminClient>;
type Read = PromiseLike<{ data: unknown; error: { message: string } | null }>;

const IN_CHUNK = 100;

async function inChunks<T>(ids: string[], read: (chunk: string[]) => Read): Promise<T[]> {
  const out: T[] = [];
  const unique = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < unique.length; i += IN_CHUNK) {
    const { data, error } = await read(unique.slice(i, i + IN_CHUNK));
    if (error) throw new Error(error.message);
    out.push(...((data as T[] | null) ?? []));
  }
  return out;
}

export type BillJobLink = { leadId: string; contractId: string | null };

export async function billJobLinks(
  admin: Admin,
  companyId: string,
  bills: { id: string; lead_id: string | null; estimate_payment_id: string | null }[]
): Promise<Map<string, BillJobLink>> {
  const onJob = bills.filter((b) => !!b.lead_id);
  const phases = await inChunks<{ id: string; estimate_id: string }>(
    onJob.map((b) => b.estimate_payment_id ?? ""),
    (chunk) => admin.from("estimate_payments").select("id, estimate_id").eq("company_id", companyId).in("id", chunk)
  );
  type Doc = { id: string; lead_id: string; kind: string | null; status: string; doc_number: string; parent_estimate_id: string | null };
  const docs = await inChunks<Doc>(
    phases.map((p) => p.estimate_id),
    (chunk) => admin.from("estimates").select("id, lead_id, kind, status, doc_number, parent_estimate_id").eq("company_id", companyId).in("id", chunk)
  );
  // A change order's or an invoice's contract, for its status and number.
  const parents = await inChunks<Doc>(
    docs.map((d) => (d.kind === "contract" ? "" : d.parent_estimate_id ?? "")),
    (chunk) => admin.from("estimates").select("id, lead_id, kind, status, doc_number, parent_estimate_id").eq("company_id", companyId).in("id", chunk)
  );
  const signed = await inChunks<{ id: string; lead_id: string; doc_number: string }>(
    onJob.map((b) => b.lead_id ?? ""),
    (chunk) =>
      admin
        .from("estimates")
        .select("id, lead_id, doc_number")
        .eq("company_id", companyId)
        .eq("kind", "contract")
        .eq("status", "Signed")
        .in("lead_id", chunk)
  );
  const docOfPhase = new Map(phases.map((p) => [p.id, p.estimate_id]));
  const docById = new Map([...docs, ...parents].map((d) => [d.id, d]));
  const contractsOf = new Map<string, { id: string; doc_number: string }[]>();
  for (const s of signed) contractsOf.set(s.lead_id, [...(contractsOf.get(s.lead_id) ?? []), s]);

  const out = new Map<string, BillJobLink>();
  for (const b of onJob) {
    const leadId = b.lead_id!;
    const doc = b.estimate_payment_id ? docById.get(docOfPhase.get(b.estimate_payment_id) ?? "") : undefined;
    const signedHere = contractsOf.get(leadId) ?? [];
    let contractId: string | null = null;
    if (doc && doc.lead_id === leadId) {
      const contract = doc.kind === "contract" ? doc : docById.get(doc.parent_estimate_id ?? "");
      if (contract?.status === "Signed") contractId = contract.id;
      else if (contract) {
        // Voided: replaced by a signed revision (same number), or cancelled -- then the customer.
        contractId = signedHere.find((c) => c.doc_number === contract.doc_number)?.id ?? null;
        out.set(b.id, { leadId, contractId });
        continue;
      }
    }
    if (!contractId) contractId = signedHere.length === 1 ? signedHere[0].id : null;
    out.set(b.id, { leadId, contractId });
  }
  return out;
}
