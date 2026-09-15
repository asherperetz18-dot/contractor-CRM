import type { BoardAggregates } from "./pipeline-aggregates";
import type { Lead, LeadWarnings } from "./data/types";

/**
 * What travels between the pipeline board and its server actions.
 * Lives outside the "use server" module because an actions file may
 * only export async functions.
 */

/** The fields a board card (or a digest/breakdown row) renders --
 *  never the full 40-column Lead row, and never notes. */
export type BoardCard = {
  id: string;
  contact_type: Lead["contact_type"];
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  source: string | null;
  project_type: string | null;
  stage: string;
  value: number;
  assigned_to: string | null;
  dispatcher_id: string | null;
  date_received: string;
  has_appt: boolean;
  created_at: string;
};

export type PipelineBoardQuery = {
  statusFilter: "Open" | "Won" | "Lost";
  /** "All" | "unassigned" | a rep's profile id. */
  repFilter: string;
  /** ISO date bounds on date_received, computed in the browser so age
   *  filters mean the rep's calendar, not the server's UTC day. */
  receivedSince: string;
  receivedBefore: string;
  noApptOnly: boolean;
  sortBy: "Name" | "Days" | "Amount";
  sortDir: "asc" | "desc";
  /** Cards per column on first load. */
  window: number;
};

export type BoardColumn = { stage: string; cards: BoardCard[]; count: number };

export type BoardDigest = {
  followUpsDue: BoardCard[];
  followUpsDueCount: number;
  coldLeads: BoardCard[];
  coldLeadsCount: number;
  warnings: Record<string, LeadWarnings>;
  /** How many of the newest open leads the digest examined. */
  windowSize: number;
};

export type PipelineBoardData = {
  columns: BoardColumn[];
  aggregates: BoardAggregates;
  /** The biggest won deals, for the Won breakdown list (capped). */
  wonTop: BoardCard[];
  totalLeads: number;
  digest: BoardDigest;
};
