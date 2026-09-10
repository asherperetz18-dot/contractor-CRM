/**
 * Whether landing on /estimates with Quick Create's ?new=1 should open
 * the create dialog immediately. Gated on the same permission as the
 * page's own New Estimate button, so a deep link can't hand someone a
 * form their save would reject.
 */
export function shouldAutoOpenNewEstimate(
  newParam: string | null,
  canCreate: boolean
): boolean {
  return canCreate && !!newParam;
}
