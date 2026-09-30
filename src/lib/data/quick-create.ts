/**
 * Whether landing on a page with Quick Create's ?new= should open that
 * page's "new" form immediately. Gated on the same permission as the
 * page's own New button, so a deep link can't hand someone a form their
 * save would reject. Used by every Quick Create target (see
 * src/app/(app)/use-quick-create.ts and the estimates page).
 */
export function shouldOpenQuickCreate(newParam: string | null, canCreate: boolean): boolean {
  return canCreate && !!newParam;
}

/** Which window Quick Create's ?new= opens on /estimates: New Invoice
 *  sends ?new=invoice, New Estimate ?new=1. Same permission gate. */
export function quickCreateDialog(
  newParam: string | null,
  canCreate: boolean
): "estimate" | "invoice" | null {
  if (!shouldOpenQuickCreate(newParam, canCreate)) return null;
  return newParam === "invoice" ? "invoice" : "estimate";
}
