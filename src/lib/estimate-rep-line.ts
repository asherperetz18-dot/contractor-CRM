import { effectiveEstimateRepId } from "./data/types.ts";

/**
 * The rep named in an estimate's header. Same person the estimates list,
 * Estimate Status and the customer's copy name (effectiveEstimateRepId),
 * plus whether it still follows the lead -- so the header can say where
 * to change it: on the lead card while unsigned, nowhere once signed
 * (the Sales team panel carries pay from there).
 */
export function estimateRepLine(input: {
  status: string;
  estimateAssignedTo: string | null;
  leadAssignedTo: string | null | undefined;
}): { repId: string | null; followsLead: boolean } {
  return {
    repId: effectiveEstimateRepId(input),
    followsLead: input.status !== "Signed" && input.status !== "Void",
  };
}
