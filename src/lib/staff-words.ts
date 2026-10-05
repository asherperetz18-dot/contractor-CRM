import { STANDARD_WORDS, word, type CompanyWords, type WordKey } from "./company-words.ts";
import type { NavEntry } from "./data/types.ts";

/**
 * The staff screens in the company's own words (DECISIONS #125): menu
 * labels, page headings, the estimate list's cards and Quick Create. A
 * label changes only when a word in it was changed, so a company on the
 * standard words sees exactly what it always has ("Salespeople" stays
 * Salespeople rather than becoming "Reps"). Pure.
 */

const changed = (words: CompanyWords, ...keys: WordKey[]) =>
  keys.some((k) => words[k].one !== STANDARD_WORDS[k].one || words[k].many !== STANDARD_WORDS[k].many);

const many = (words: CompanyWords, key: WordKey) => word(words, key, { many: true });

/** The label for a staff page, by its address. */
export function staffPageLabel(href: string, fallback: string, words: CompanyWords): string {
  switch (href) {
    case "/estimates":
      return changed(words, "estimate", "contract") ? `${many(words, "estimate")} & ${many(words, "contract")}` : fallback;
    case "/estimate-status":
      return changed(words, "estimate") ? `${word(words, "estimate")} Status` : fallback;
    case "/estimate-approvals":
      return changed(words, "estimate") ? `${word(words, "estimate")} Approvals` : fallback;
    case "/projects":
      return changed(words, "project") ? many(words, "project") : fallback;
    case "/contracts":
      return changed(words, "contract") ? many(words, "contract") : fallback;
    case "/appointment-reports":
      return changed(words, "appointment") ? `${word(words, "appointment")} Reports` : fallback;
    case "/salespeople":
      return changed(words, "rep") ? many(words, "rep") : fallback;
    default:
      return fallback;
  }
}

/** The sidebar, relabelled. Group names stay: they are departments, and
 *  saved menu orders are keyed on them (navEntryKey). */
export function relabelNav(entries: NavEntry[], words: CompanyWords): NavEntry[] {
  return entries.map((e) =>
    e.type === "link"
      ? { ...e, label: staffPageLabel(e.href, e.label, words) }
      : { ...e, items: e.items.map((i) => ({ ...i, label: staffPageLabel(i.href, i.label, words) })) }
  );
}

/** The Estimates & Contracts page's count cards. */
export function estimatesCardLabel(key: string, fallback: string, words: CompanyWords): string {
  if (key === "sent" && changed(words, "estimate")) return many(words, "estimate");
  if (key === "signed" && changed(words, "contract")) return many(words, "contract");
  if (key === "co_pending" && changed(words, "change_order")) return many(words, "change_order");
  return fallback;
}

/** Quick Create's labels. */
export function quickCreateLabels(words: CompanyWords) {
  return {
    appointment: changed(words, "appointment") ? `New ${word(words, "appointment")}` : "New Appointment",
    // A production job: the company's word for a project, once it has one.
    job: changed(words, "project") ? `New ${word(words, "project")}` : "New Job",
    estimatesGroup: changed(words, "estimate") ? `${many(words, "estimate")} & Invoices` : "Estimates & Invoices",
    estimate: changed(words, "estimate") ? `New ${word(words, "estimate")}` : "New Estimate",
    contractsGroup: changed(words, "contract") ? many(words, "contract") : "Contracts",
    contract: changed(words, "contract") ? `New ${word(words, "contract")}` : "New Contract",
  };
}
