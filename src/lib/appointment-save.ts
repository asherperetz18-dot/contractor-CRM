import type { EventStatus } from "./data/types.ts";

/**
 * Saving the Edit Appointment window (DECISIONS #188).
 *
 * The window holds three kinds of unsaved work -- the appointment's own
 * fields, a result picked on the Result tab, and a task typed on the
 * Tasks tab -- and its Save used to write only the first and close,
 * dropping the other two without a word.
 */

/**
 * What a save call that never got an answer looks like on screen. A
 * dropped signal, or an action the server no longer recognises after an
 * update, rejects instead of returning an error -- which used to leave
 * the button greyed out with nothing said.
 */
export const SAVE_UNREACHABLE =
  "Couldn't reach the CRM to save this. Check your connection and try again; if it keeps failing, refresh the page.";

/**
 * `partly`: part of the step landed before the refusal (a result's
 * outcome saved, its stage move didn't), and the error says which.
 */
export type StepResult = { error?: string; partly?: boolean } | void | null | undefined;

/** Runs one save call, turning a throw into a message the window can show. */
export async function attempt(fn: () => Promise<StepResult>): Promise<{ error?: string; partly?: boolean }> {
  try {
    const result = await fn();
    if (!result?.error) return {};
    return result.partly ? { error: result.error, partly: true } : { error: result.error };
  } catch {
    return { error: SAVE_UNREACHABLE };
  }
}

export type SaveStep = "appointment" | "result" | "task";

// The appointment first: it's what the window is for, and the result
// rewrites its status, so the result has to land after it, not under it.
const ORDER: SaveStep[] = ["appointment", "result", "task"];
const PART: Record<SaveStep, string> = { appointment: "appointment", result: "result", task: "new task" };

/**
 * Commits whatever is pending, in order, stopping at the first refusal.
 * When more than one thing was waiting, the message says which saved,
 * which didn't and why, and which never got its turn -- the window stays
 * open on all of it.
 */
export async function commitPending(
  steps: Partial<Record<SaveStep, () => Promise<StepResult>>>
): Promise<{ error?: string; failedAt?: SaveStep; done: SaveStep[]; partly?: boolean }> {
  const pending = ORDER.filter((step) => steps[step]);
  const done: SaveStep[] = [];
  for (const step of pending) {
    const { error, partly } = await attempt(steps[step]!);
    if (!error) {
      done.push(step);
      continue;
    }
    const failed = partly ? { failedAt: step, done, partly } : { failedAt: step, done };
    if (pending.length === 1) return { error, ...failed };
    const waiting = pending.slice(pending.indexOf(step) + 1).map((s) => `the ${PART[s]}`);
    const message = [
      done.length ? `Saved the ${done.map((s) => PART[s]).join(" and ")}.` : "",
      // A step that half-landed already says what did.
      partly ? error : `The ${PART[step]} didn't save: ${error}`,
      waiting.length ? `Not saved yet: ${waiting.join(" and ")}.` : "",
    ];
    return { error: message.filter(Boolean).join(" "), ...failed };
  }
  return { done };
}

/**
 * Which save button the footer shows.
 *
 * Save Result commits the Result tab alone and keeps the window open, so
 * it is offered only while nothing but the result is waiting. Once an
 * appointment field or a typed task is pending too, two buttons that
 * each save part of the screen is a coin toss -- the footer offers Save,
 * which commits all of it. While Save is working (`saving`) it stays
 * Save: the appointment lands first and stops counting as an edit, and
 * swapping in Save Result then would offer to send the result twice.
 */
export function appointmentFooter(s: {
  tab: string;
  readOnly: boolean;
  formDirty: boolean;
  resultDirty: boolean;
  taskPending: boolean;
  saving: boolean;
}): { save: boolean; saveResult: boolean; dirty: boolean } {
  if (s.readOnly) return { save: false, saveResult: false, dirty: false };
  const dirty = s.formDirty || s.resultDirty || s.taskPending;
  if (s.tab === "Result" && !s.formDirty && !s.taskPending && !s.saving) {
    return { save: false, saveResult: true, dirty };
  }
  // Texts and Photos commit as they go: nothing there for Save to do
  // unless something elsewhere in the window is waiting.
  const selfSaving = s.tab === "Texts" || s.tab === "Photos";
  return { save: !(selfSaving && !dirty), saveResult: false, dirty };
}

type LiveFields = { customer_confirmed: boolean; rep_confirmed: boolean; status: EventStatus };

/**
 * Lays the server's latest confirmations and status over a copy of the
 * appointment. The form keeps any field the person has touched; the saved
 * baseline (no `keep`) takes all of it, so a rep's YES that arrived after
 * the page loaded reads as saved rather than as an edit.
 */
export function applyLiveState<T extends LiveFields>(
  record: T,
  live: LiveFields,
  keep: { customer: boolean; rep: boolean; status: boolean } = { customer: false, rep: false, status: false }
): T {
  return {
    ...record,
    customer_confirmed: keep.customer ? record.customer_confirmed : live.customer_confirmed,
    rep_confirmed: keep.rep ? record.rep_confirmed : live.rep_confirmed,
    status: keep.status ? record.status : live.status,
  };
}
