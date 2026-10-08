/**
 * Reports whose period rides in the address -- the Schedule, Text
 * Reports, Appointment Reports -- keep the period being picked in state
 * and ask the router for it; the server then loads that period. They
 * also follow an address they never asked for: a link, such as a Daily
 * Brief tile tapped while the brief sits over the open report.
 *
 * Should the report ask for the period being picked (`wanted`)? `sent` is
 * the last address it asked for, `pending` whether that request is still
 * on its way. Going back to the period already loaded while another is on
 * its way still asks: a newer request is what makes the router drop the
 * older one, which would otherwise land and be taken for a link.
 */
export function requestsAddress(s: { wanted: string; loaded: string; sent: string; pending: boolean }): boolean {
  if (s.wanted === s.sent) return false;
  return s.wanted !== s.loaded || s.pending;
}
