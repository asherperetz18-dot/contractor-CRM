// Shared shapes and limits for AI action proposals. Kept out of the
// "use server" action file because those may only export async functions.

// Hard ceiling on how many records a single proposal may touch. The AI can
// ask for more; it just won't get a proposal it can apply. This is the
// backstop against one misread instruction rewriting the whole pipeline.
export const MAX_TARGETS_PER_PROPOSAL = 50;

export type AiActionType = "move_lead_stage" | "assign_leads" | "create_tasks";

export const AI_ACTION_TYPES: AiActionType[] = [
  "move_lead_stage",
  "assign_leads",
  "create_tasks",
];

export type ProposalStatus = "pending" | "applied" | "rejected" | "failed";

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
};
