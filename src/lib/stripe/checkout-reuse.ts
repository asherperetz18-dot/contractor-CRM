/**
 * What to do with a checkout the customer opened for a phase and left
 * without paying, when they click Pay on that phase again.
 *
 * Reusing the open session rather than starting a second one is what
 * keeps a customer with two tabs from paying the same phase twice.
 */
export function leftoverCheckoutAction(
  session: { status: string | null; amount_total: number | null },
  chargeCents: number
): "reuse" | "expire" | "in-flight" | "cancel" {
  if (session.status === "complete") return "in-flight";
  if (session.status === "open") {
    // What's due changed since -- the phase was re-priced, or part of it
    // was paid another way: the old page would charge the old amount, so
    // it is closed rather than handed back.
    return session.amount_total === chargeCents ? "reuse" : "expire";
  }
  return "cancel";
}
