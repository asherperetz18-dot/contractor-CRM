import { effectiveEstimateRepId, type Estimate } from "./types.ts";

/**
 * Everyone on a document's sales team: the salesperson the list names,
 * then whoever else the contract's Sales team panel seats -- a second
 * salesperson, a closer.
 *
 * The Estimates filter read only the first of those, so a closer picking
 * their own name never found the jobs they closed for somebody else
 * (EST-1068: Rafi's contract, Simon closing). The filter answers "which
 * documents is this person on", so it reads the whole team. Who a sale
 * is *credited* to is a different question, answered by sale-credit.ts
 * -- the closer follows a sale there and never holds it.
 *
 * Which team, by the panel's own rule (getSalesTeam): a signed or void
 * document reads the seats stamped on it at signature, and falls back
 * to the lead's people only when nothing was ever stamped; a live one
 * follows the lead, exactly as its salesperson column already does.
 */

export type SeatRole = "Salesperson" | "Second salesperson" | "Closer";
export type DocSeat = { id: string; role: SeatRole };

export type SeatDoc = Pick<Estimate, "status" | "assigned_to" | "sales_rep_1" | "sales_rep_2" | "closer_id">;
export type SeatLead = {
  assigned_to: string | null;
  partner_rep_id?: string | null;
  closer_id?: string | null;
};

export function estimateSeats(e: SeatDoc, lead: SeatLead | undefined): DocSeat[] {
  const frozen = e.status === "Signed" || e.status === "Void";
  const seeded = !!(e.sales_rep_1 || e.sales_rep_2 || e.closer_id);
  const [one, two, closer] =
    frozen && seeded
      ? [e.sales_rep_1, e.sales_rep_2, e.closer_id]
      : [lead?.assigned_to, lead?.partner_rep_id, lead?.closer_id];

  const seats: DocSeat[] = [];
  const add = (id: string | null | undefined, role: SeatRole) => {
    if (id && !seats.some((s) => s.id === id)) seats.push({ id, role });
  };
  add(
    effectiveEstimateRepId({
      status: e.status,
      estimateAssignedTo: e.assigned_to,
      leadAssignedTo: lead?.assigned_to,
    }),
    "Salesperson"
  );
  add(one, "Salesperson");
  add(two, "Second salesperson");
  add(closer, "Closer");
  return seats;
}
