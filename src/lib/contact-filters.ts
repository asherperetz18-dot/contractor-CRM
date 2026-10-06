/**
 * The Contacts page's Source / Assigned Rep / Stage filters.
 *
 * Each group is a multi-select; an empty group is no filter. Ticks
 * within a group OR together, groups AND together. The filtering runs
 * server-side like the search does (DECISIONS #019/#020) -- the book is
 * never on the page to filter -- so a group becomes one PostgREST
 * `or` clause, and every clause lands on the same query.
 */

export type ContactFilters = {
  sources: string[];
  reps: string[];
  stages: string[];
  /** Real leads only -- not a bought list, not blank (DECISIONS #156).
   *  Present only when on; the server resolves it to a source filter. */
  leadsOnly?: true;
};

/** The tick for "No source" / "Unassigned". Not a value a lead can hold. */
export const NO_VALUE = "__none";

/** Ticks kept per group. Far past any real list; stops a crafted
 *  request from building a query-string the size of the book. */
const MAX_TICKS = 100;

const PARAM = { sources: "source", reps: "rep", stages: "stage" } as const;
const GROUPS = ["sources", "reps", "stages"] as const;
const LEADS_PARAM = "leads";

export function hasContactFilters(f: ContactFilters): boolean {
  return f.leadsOnly === true || GROUPS.some((g) => f[g].length > 0);
}

/** A PostgREST list value, double-quoted so commas, parentheses and
 *  quotes inside a source name stay part of the name. */
function quote(v: string): string {
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function groupClause(column: string, ticks: string[], none: string[] | null): string | null {
  const values = ticks.filter((v) => v !== NO_VALUE);
  const parts: string[] = [];
  if (values.length) parts.push(`${column}.in.(${values.map(quote).join(",")})`);
  if (none && ticks.includes(NO_VALUE)) parts.push(...none);
  return parts.length ? parts.join(",") : null;
}

/** One `.or()` clause per ticked group. */
export function contactFilterClauses(f: ContactFilters): string[] {
  return [
    groupClause("source", f.sources, ["source.is.null", 'source.eq.""']),
    groupClause("assigned_to", f.reps, ["assigned_to.is.null"]),
    groupClause("stage", f.stages, null),
  ].filter((c): c is string => c !== null);
}

function ticks(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [raw];
  const out: string[] = [];
  for (const v of list) {
    if (typeof v === "string" && v !== "" && !out.includes(v)) out.push(v);
    if (out.length === MAX_TICKS) break;
  }
  return out;
}

/**
 * Filters from the URL (Next's `searchParams`, keyed source/rep/stage)
 * or from a server action's input -- both come from the browser, so
 * anything that isn't a list of strings is dropped.
 */
export function parseContactFilters(raw: unknown): ContactFilters {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  // A ContactFilters object passes through; a searchParams record is
  // read by its URL keys.
  const read = (g: (typeof GROUPS)[number]) => ticks(g in r ? r[g] : r[PARAM[g]]);
  const out: ContactFilters = { sources: read("sources"), reps: read("reps"), stages: read("stages") };
  if (r.leadsOnly === true || r[LEADS_PARAM] === "1") out.leadsOnly = true;
  return out;
}

/** The filters as a query string, "" when none are ticked. */
export function contactFiltersQuery(f: ContactFilters): string {
  const p = new URLSearchParams();
  for (const g of GROUPS) for (const v of f[g]) p.append(PARAM[g], v);
  if (f.leadsOnly) p.append(LEADS_PARAM, "1");
  return p.toString();
}

/**
 * A dropdown's options: the configured list in its own order (lead
 * sources, pipeline stages), then values that only exist on contacts
 * -- an import's "Vicidial", a retired stage -- A-Z. A contact whose
 * value is in neither would be unreachable by the filter.
 */
export function mergeFilterOptions(configured: string[], extra: Iterable<string>): string[] {
  const out = [...new Set(configured.filter(Boolean))];
  const seen = new Set(out);
  const rest = [...new Set(extra)].filter((v) => v && !seen.has(v)).sort((a, b) => a.localeCompare(b));
  return [...out, ...rest];
}

/**
 * The "With Open Leads" tile's click: the stage ticks that itemize its
 * number -- the current ticks (or every stage, when none) minus the
 * closed ones (closedStageNames: won, lost, not interested and
 * do-not-contact, under this company's names -- DECISIONS #120).
 */
export function openStageSelection(stageOptions: string[], current: string[], closedNames: string[]): string[] {
  return (current.length ? current : stageOptions).filter((s) => !closedNames.includes(s));
}
