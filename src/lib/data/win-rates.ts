/** One win rate: signed contracts out of `of`; no rate while `of` is 0. */
export type WinRate = { rate: number | null; signed: number; of: number };

/** The funnel counts both rollups expose on the window's lead cohort. */
export type WinRateFunnel = { leads: number; withAppt: number; signed: number };

/**
 * The two rates the Dashboard's Win rate card and Marketing Analytics'
 * Win rate tile show: signed contracts out of the period's leads, and
 * out of the ones that got an appointment set (the funnel's has_appt
 * step). Same cohort and the same signed count on both, so "from
 * appointments" is always the higher of the two -- of the leads we got
 * in front of, this many closed. The period's appointment *count* is
 * deliberately not the denominator: it dates appointments, not leads,
 * and one lead can hold several.
 */
export function winRates(f: WinRateFunnel): { fromLeads: WinRate; fromAppts: WinRate } {
  const signed = f.signed;
  const rate = (of: number): WinRate => ({ rate: of > 0 ? (signed / of) * 100 : null, signed, of });
  return { fromLeads: rate(f.leads), fromAppts: rate(f.withAppt) };
}
