/**
 * The opening of a void document's banner: when, by whom, and why. The
 * name comes from `voided_by`, which only a hand void (Admin) sets -- a
 * version superseded by a newer signature is voided by the system, so
 * it names nobody rather than guessing.
 */
export function voidBannerLead(input: {
  day: string | null;
  voidedByName: string | null;
  reason: string | null;
}): string {
  let line = "Voided";
  if (input.day) line += ` on ${input.day}`;
  if (input.voidedByName) line += ` by ${input.voidedByName}`;
  const reason = input.reason?.trim();
  if (reason) line += ` — ${reason}`;
  return line;
}
