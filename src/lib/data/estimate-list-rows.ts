import type { Estimate, EstimateSigner } from "./types.ts";

/**
 * What the Estimates list reads of each document and signer (DECISIONS
 * #145) -- one list per table, the select and the type made from it, so
 * they can't drift apart.
 *
 * The list used to read every column: each contract's full terms, its
 * notes and messages, and every hand-drawn signature as a picture, none
 * of which it shows. Every document still comes -- the cards' counts and
 * totals and the search cover them all -- just without what it doesn't
 * draw. Typed on these rows, so a field the list starts reading without
 * being added here fails the build rather than reading as blank.
 */

const ESTIMATE_LIST_FIELDS = [
  "id",
  "lead_id",
  "doc_number",
  "title",
  "status",
  "kind",
  "assigned_to",
  "sales_rep_1",
  "sales_rep_2",
  "closer_id",
  "expires_at",
  "created_at",
  "total_cents",
  "job_address",
] as const satisfies readonly (keyof Estimate)[];

const ESTIMATE_LIST_SIGNER_FIELDS = [
  "id",
  "estimate_id",
  "name",
  "signed_at",
  "sort_order",
] as const satisfies readonly (keyof EstimateSigner)[];

export type EstimateListRow = Pick<Estimate, (typeof ESTIMATE_LIST_FIELDS)[number]>;
export type EstimateListSigner = Pick<EstimateSigner, (typeof ESTIMATE_LIST_SIGNER_FIELDS)[number]>;

export const ESTIMATE_LIST_COLUMNS = ESTIMATE_LIST_FIELDS.join(", ");
export const ESTIMATE_LIST_SIGNER_COLUMNS = ESTIMATE_LIST_SIGNER_FIELDS.join(", ");
