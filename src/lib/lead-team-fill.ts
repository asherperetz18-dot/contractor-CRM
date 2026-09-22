/** The contact's paid seats, as they stand before the appointment saves. */
export type LeadTeamSeats = {
  assigned_to: string | null;
  partner_rep_id: string | null;
  closer_id: string | null;
};

/** The visit seats being saved on the appointment. */
export type VisitSeats = {
  assigned_to: string | null;
  second_assigned_to: string | null;
};

/**
 * What saving an appointment writes onto the contact's team: linked
 * cards, with the safety rule the owner approved on the mockup.
 *
 * Assigned To fills an EMPTY Assigned Rep; Second Assigned To fills an
 * EMPTY Partner Rep. A held seat is never overwritten -- a helper sent
 * to one visit must not quietly take the sale and its commission; the
 * customer changes hands only on the contact card, on purpose.
 *
 * The partner seat keeps the pickers' own rules: never the same person
 * as the rep (a solo sale is not a partnership with yourself), and
 * never the closer -- partner and closer are mutually exclusive seats
 * (decision #050). The closer seat is never written here at all.
 */
export function leadTeamFills(
  lead: LeadTeamSeats,
  visit: VisitSeats
): { assigned_to?: string; partner_rep_id?: string } {
  const fills: { assigned_to?: string; partner_rep_id?: string } = {};

  if (visit.assigned_to && !lead.assigned_to) {
    fills.assigned_to = visit.assigned_to;
  }

  // The rep the contact will have once this save lands -- the second
  // chair is measured against them, not against a seat mid-fill.
  const effectiveRep = lead.assigned_to ?? fills.assigned_to ?? null;

  if (
    visit.second_assigned_to &&
    !lead.partner_rep_id &&
    visit.second_assigned_to !== effectiveRep &&
    visit.second_assigned_to !== lead.closer_id
  ) {
    fills.partner_rep_id = visit.second_assigned_to;
  }

  return fills;
}
