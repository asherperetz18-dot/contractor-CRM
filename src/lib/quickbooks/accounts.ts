/**
 * Matching the CRM's accounts to QuickBooks' (DECISIONS #172). A bill
 * payment goes to QuickBooks from the bank or card account it was paid
 * from, and its cost lands in an expense account, so before anything is
 * sent each company says which QuickBooks account is which. Pure.
 */

export type QbAccount = { id: string; name: string; type: string };

/** QuickBooks account types money is paid from. */
export const PAID_FROM_TYPES = ["Bank", "Credit Card"];
/** QuickBooks account types a job cost lands in. */
export const EXPENSE_TYPES = ["Cost of Goods Sold", "Expense", "Other Expense"];

/** The active accounts in a QuickBooks Account query's answer. */
export function parseQbAccounts(json: unknown): QbAccount[] {
  const rows = (json as { QueryResponse?: { Account?: unknown[] } } | null)?.QueryResponse?.Account;
  if (!Array.isArray(rows)) return [];
  const out: QbAccount[] = [];
  for (const r of rows as { Id?: unknown; Name?: unknown; FullyQualifiedName?: unknown; AccountType?: unknown; Active?: unknown }[]) {
    if (r.Active === false || typeof r.Id !== "string" || typeof r.AccountType !== "string") continue;
    const name = typeof r.FullyQualifiedName === "string" ? r.FullyQualifiedName : typeof r.Name === "string" ? r.Name : "";
    if (name) out.push({ id: r.Id, name, type: r.AccountType });
  }
  return out;
}

/** The accounts that can be picked for one side, by name. */
export function accountChoices(accounts: QbAccount[], kind: "paid_from" | "expense"): QbAccount[] {
  const types = kind === "paid_from" ? PAID_FROM_TYPES : EXPENSE_TYPES;
  return accounts.filter((a) => types.includes(a.type)).sort((a, b) => a.name.localeCompare(b.name));
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * The QuickBooks account a "paid from" account clearly is, or null: the
 * same name, or the only one of the right type whose name carries its
 * last four digits. A card only ever matches a credit card account; a
 * bank account or cash, a bank account. Never a guess between two.
 */
export function suggestPaymentMatch(
  account: { name: string; kind: string; last4: string | null },
  accounts: QbAccount[]
): string | null {
  const type = account.kind === "credit_card" ? "Credit Card" : "Bank";
  const fits = accounts.filter((a) => a.type === type);
  const byName = fits.filter((a) => norm(a.name) === norm(account.name));
  if (byName.length === 1) return byName[0].id;
  const last4 = account.last4?.trim();
  if (last4 && /^\d{4}$/.test(last4)) {
    const byDigits = fits.filter((a) => a.name.includes(last4));
    if (byDigits.length === 1) return byDigits[0].id;
  }
  return null;
}

/** The key a cost category is matched by: case and spacing don't count. */
export function categoryKey(category: string): string {
  return norm(category);
}

/** The cost categories a company uses, each once, by name. */
export function costCategories(values: (string | null | undefined)[]): string[] {
  const seen = new Map<string, string>();
  for (const v of values) {
    const t = v?.trim();
    if (t && !seen.has(categoryKey(t))) seen.set(categoryKey(t), t);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
