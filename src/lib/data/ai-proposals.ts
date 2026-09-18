// Shared shapes and limits for AI action proposals. Kept out of the
// "use server" action file because those may only export async functions.

// Hard ceiling on how many records a single proposal may touch. The AI can
// ask for more; it just won't get a proposal it can apply. This is the
// backstop against one misread instruction rewriting the whole pipeline.
export const MAX_TARGETS_PER_PROPOSAL = 50;

/** Steps per add-checklist proposal. Same backstop idea as the target
 *  cap: the AI can ask for more, it just won't get an applicable card. */
export const MAX_CHECKLIST_ITEMS_PER_PROPOSAL = 20;

/** Mirrors MAX_LABEL in the checklist actions, so a label the AI wrote
 *  can never be longer than one a person could type. */
const MAX_CHECKLIST_LABEL = 200;

export type AiActionType =
  | "move_lead_stage"
  | "assign_leads"
  | "create_tasks"
  | "add_checklist_items"
  | "check_checklist_items";

export const AI_ACTION_TYPES: AiActionType[] = [
  "move_lead_stage",
  "assign_leads",
  "create_tasks",
  "add_checklist_items",
  "check_checklist_items",
];

export type ProposalStatus = "pending" | "applied" | "rejected" | "failed";

// A suggestion nobody acted on goes stale: the reasoning behind it is
// forgotten, and the data it was based on has moved on. Targets are always
// re-checked at apply time so an old one can't hit the wrong records, but
// it shouldn't stay one click from being applied indefinitely.
export const PROPOSAL_STALE_DAYS = 7;

export function proposalIsStale(createdAt: string): boolean {
  return Date.now() - new Date(createdAt).getTime() > PROPOSAL_STALE_DAYS * 86400000;
}

export type ProposalRow = {
  id: string;
  action_type: string;
  params: Record<string, unknown>;
  summary: string;
  target_count: number;
  status: ProposalStatus;
  result: { changed?: number; skipped?: number } | null;
  error: string | null;
  created_at: string;
  decided_at: string | null;
};

export const AI_ACTION_LABEL: Record<string, string> = {
  move_lead_stage: "Move pipeline stage",
  assign_leads: "Assign to rep",
  create_tasks: "Create follow-up tasks",
  add_checklist_items: "Add checklist steps",
  check_checklist_items: "Check off checklist steps",
};

// ── Checklist proposal params ────────────────────────────────────────
// The AI's params are untrusted JSON, parsed once when the suggestion
// is stored and again when a human applies it. Only clean targets pass.

export type ChecklistAddParams = {
  estimateId: string;
  items: { label: string; dueDate: string | null }[];
};

export function parseChecklistAddParams(
  params: Record<string, unknown> | null | undefined
): ChecklistAddParams | null {
  const estimateId =
    typeof params?.project_id === "string" && params.project_id ? params.project_id : "";
  if (!estimateId) return null;
  const raw = params?.items;
  if (!Array.isArray(raw) || raw.length > MAX_CHECKLIST_ITEMS_PER_PROPOSAL) return null;

  const items: ChecklistAddParams["items"] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const label =
      typeof (entry as { label?: unknown }).label === "string"
        ? ((entry as { label: string }).label).trim().slice(0, MAX_CHECKLIST_LABEL)
        : "";
    if (!label) continue;
    const due = (entry as { due_date?: unknown }).due_date;
    items.push({
      // A due date the model wrote in prose is no date, not a failure.
      label,
      dueDate: typeof due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null,
    });
  }
  return items.length > 0 ? { estimateId, items } : null;
}

export type ChecklistCheckParams = { itemIds: string[] };

export function parseChecklistCheckParams(
  params: Record<string, unknown> | null | undefined
): ChecklistCheckParams | null {
  const raw = params?.item_ids;
  if (!Array.isArray(raw)) return null;
  const itemIds = [...new Set(raw.filter((v): v is string => typeof v === "string" && v !== ""))];
  if (itemIds.length === 0 || itemIds.length > MAX_TARGETS_PER_PROPOSAL) return null;
  return { itemIds };
}
