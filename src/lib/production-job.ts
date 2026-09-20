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

export function productionJobRow(
  estimate: JobSeedEstimate,
  lead: JobSeedLead | null,
  hasExistingJob: boolean
): ProductionJobInsert | null {
  // A change order adds to a job already on the board; a completion
  // certificate closes one. Neither is new work.
  if (estimate.kind === "change_order" || estimate.kind === "completion") return null;
  if (!estimate.lead_id || !lead) return null;
  // One job per lead, however many documents get signed — a revision
  // re-signed or a second contract on the same customer must not stack
  // duplicate cards (the hand-run pipeline convert also inserts here).
  if (hasExistingJob) return null;

  // Same shape the pipeline's "convert to job" gives a name, so a job
  // reads the same whichever door it came in through.
  const person = `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim();
  const name = person ? `${person} — Project` : estimate.title?.trim() || "New Project";
  return {
    lead_id: estimate.lead_id,
    company_id: estimate.company_id,
    name,
    address: lead.address || null,
    status: "Not Started",
  };
}
