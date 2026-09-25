import { clientName } from "./data/client-name.ts";

/**
 * A signed contract is the moment work becomes real, so it puts the job
 * on the Production Board by itself — left to a hand-run "convert to
 * job", the board starves while Projects fills up (which is exactly
 * what happened). Pure: the caller supplies what exists and inserts
 * what this returns.
 */

export type JobSeedEstimate = {
  kind: string | null;
  lead_id: string | null;
  company_id: string;
  title: string | null;
};

export type JobSeedLead = {
  contact_type?: string | null;
  company_name?: string | null;
  first_name: string | null;
  last_name: string | null;
  address: string | null;
};

export type ProductionJobInsert = {
  lead_id: string;
  company_id: string;
  name: string;
  address: string | null;
  status: "Not Started";
};

export type SignedContractSeed = {
  id: string;
  lead_id: string | null;
  kind: string | null;
  title: string | null;
  signed_at: string | null;
};

/**
 * The one-click backfill for contracts signed before auto-create
 * shipped: one seed per lead still missing a job, the latest signature
 * naming it (same winner as the board's "Open project" link). The
 * caller pairs each seed with its lead row and inserts what
 * productionJobRow returns — so the backfilled job and the
 * signed-yesterday job can never be shaped differently.
 */
export function backfillSeeds(
  signed: readonly SignedContractSeed[],
  existingJobLeadIds: ReadonlySet<string>
): SignedContractSeed[] {
  const byLead = new Map<string, SignedContractSeed>();
  for (const doc of signed) {
    // Only a contract is a job -- not a change order, a completion
    // certificate or an invoice (an allow-list, so a new kind stays out).
    if ((doc.kind ?? "contract") !== "contract") continue;
    if (!doc.lead_id || existingJobLeadIds.has(doc.lead_id)) continue;
    const held = byLead.get(doc.lead_id);
    if (!held || (doc.signed_at ?? "") > (held.signed_at ?? "")) byLead.set(doc.lead_id, doc);
  }
  return [...byLead.values()];
}

export function productionJobRow(
  estimate: JobSeedEstimate,
  lead: JobSeedLead | null,
  hasExistingJob: boolean
): ProductionJobInsert | null {
  // A change order adds to a job already on the board; a completion
  // certificate closes one; an invoice bills an extra on it. None is
  // new work.
  if ((estimate.kind ?? "contract") !== "contract") return null;
  if (!estimate.lead_id || !lead) return null;
  // One job per lead, however many documents get signed — a revision
  // re-signed or a second contract on the same customer must not stack
  // duplicate cards (the hand-run pipeline convert also inserts here).
  if (hasExistingJob) return null;

  // Same shape the pipeline's "convert to job" gives a name, so a job
  // reads the same whichever door it came in through.
  const client = clientName(lead);
  const name = client ? `${client} — Project` : estimate.title?.trim() || "New Project";
  return {
    lead_id: estimate.lead_id,
    company_id: estimate.company_id,
    name,
    address: lead.address || null,
    status: "Not Started",
  };
}
