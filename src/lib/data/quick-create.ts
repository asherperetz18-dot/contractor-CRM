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

/** Which window Quick Create's ?new= opens on /estimates: New Invoice
 *  sends ?new=invoice, New Estimate ?new=1. Same permission gate. */
export function quickCreateDialog(
  newParam: string | null,
  canCreate: boolean
): "estimate" | "invoice" | null {
  if (!shouldAutoOpenNewEstimate(newParam, canCreate)) return null;
  return newParam === "invoice" ? "invoice" : "estimate";
}
