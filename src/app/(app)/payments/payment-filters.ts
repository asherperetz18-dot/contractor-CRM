/**
 * The Payments page's client/rep scoping, as a pure function — the same
 * filters Money to Collect has, applied to all three tables at once.
 *
 * A row that has no lead or no rep (an old import, a contract whose lead
 * was deleted) never matches an active filter: under "this client" or
 * "this rep" an unattributed payment is not theirs.
 */

export type ClientRepFilter = {
  /** Selected lead id, or "" for all clients. */
  clientId: string;
  /** Selected rep display name, or "" for all reps. */
  rep: string;
};

export type ClientRepRow = {
  leadId: string | null;
  rep: string | null;
};

export function matchesClientRep(filter: ClientRepFilter, row: ClientRepRow): boolean {
  return (
    (!filter.clientId || row.leadId === filter.clientId) &&
    (!filter.rep || row.rep === filter.rep)
  );
}

export type PaymentsSummary = {
  collectedCents: number;
  overdueCents: number;
  billedCents: number;
  outstandingCents: number;
  awaitingDepositCents: number;
  clearingCents: number;
};

/**
 * The six stat cards, recomputed under the client/rep scope — derived
 * from the rows the tables render so the cards and the rows can never
 * disagree.
 * Collected counts only succeeded payments and clearing only pending.
 * Billed-Unpaid and Overdue sum each phase's owedCents — the per-phase
 * remainder Projects' "Owed to you" and Money to Collect count
 * (phaseOwedCents), so the two pages always say the same number. A
 * partly paid phase keeps its remainder on the cards instead of
 * vanishing, and a remainder still clearing counts until the money
 * lands (the Clearing card says how much of it is in flight).
 * Outstanding is signed contract value minus collected, clamped at
 * zero for contracts revised below what landed.
 */
export function paymentsSummary(
  filter: ClientRepFilter,
  rows: {
    contracts: (ClientRepRow & { totalCents: number })[];
    billed: (ClientRepRow & { state: string; owedCents: number })[];
    chase: (ClientRepRow & { depositCents: number })[];
    history: (ClientRepRow & { status: string; amountCents: number })[];
  }
): PaymentsSummary {
  const keep = <T extends ClientRepRow>(list: T[]) =>
    list.filter((r) => matchesClientRep(filter, r));
  const contracts = keep(rows.contracts);
  const billed = keep(rows.billed);
  const history = keep(rows.history);

  const sum = (list: { amountCents: number }[]) =>
    list.reduce((s, r) => s + (r.amountCents || 0), 0);
  // owedCents is already zero on paid rows and untouched by pending
  // money, so every billed row can just be summed.
  const owed = (list: { owedCents: number }[]) =>
    list.reduce((s, r) => s + (r.owedCents || 0), 0);

  const collectedCents = sum(history.filter((r) => r.status === "succeeded"));
  const contractValueCents = contracts.reduce((s, c) => s + (c.totalCents || 0), 0);
  return {
    collectedCents,
    overdueCents: owed(billed.filter((r) => r.state === "overdue")),
    billedCents: owed(billed),
    outstandingCents: Math.max(0, contractValueCents - collectedCents),
    awaitingDepositCents: keep(rows.chase).reduce((s, r) => s + (r.depositCents || 0), 0),
    clearingCents: sum(history.filter((r) => r.status === "pending")),
  };
}
