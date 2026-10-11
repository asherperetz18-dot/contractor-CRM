import { formatTimeRange, type EventStatus, type TimeFormat } from "./data/types.ts";

/**
 * Saving the Edit Appointment window (DECISIONS #188, #190).
 *
 * The window holds the appointment's own fields, a result picked on the
 * Result tab, a task typed on the Tasks tab, a note typed in Activity &
 * Notes and a text typed on the Texts tab. Its Save used to write only
 * the first and close, dropping the rest without a word. It now commits
 * all but the text, which it never sends.
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
 * The same for a text. One that never came back may still have gone out,
 * so this says to look before sending it again rather than "try again".
 */
export const SEND_UNREACHABLE =
  "Couldn't reach the CRM to send this. Check your connection, and check the thread before sending it again.";

/**
 * `partly`: part of the step landed before the refusal (a result's
 * outcome saved, its stage move didn't), and the error says which.
 */
export type StepResult = { error?: string; partly?: boolean } | void | null | undefined;

/** Runs one save call, turning a throw into a message the window can show. */
export async function attempt(
  fn: () => Promise<StepResult>,
  unreachable: string = SAVE_UNREACHABLE
): Promise<{ error?: string; partly?: boolean }> {
  try {
    const result = await fn();
    if (!result?.error) return {};
    return result.partly ? { error: result.error, partly: true } : { error: result.error };
  } catch {
    return { error: unreachable };
  }
}

export type SaveStep = "appointment" | "result" | "task" | "note";

// The appointment first: it's what the window is for, and the result
// rewrites its status, so the result has to land after it, not under it.
// A typed task, then a typed note (DECISIONS #190), come last.
const ORDER: SaveStep[] = ["appointment", "result", "task", "note"];
const PART: Record<SaveStep, string> = {
  appointment: "appointment",
  result: "result",
  task: "new task",
  note: "new note",
};

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
 * it is offered only while nothing else Save could commit is waiting.
 * Once an appointment field, a typed task or a typed note is pending too,
 * two buttons that each save part of the screen is a coin toss -- the
 * footer offers Save, which commits all of it. While Save is working (`saving`) it stays
 * Save: the appointment lands first and stops counting as an edit, and
 * swapping in Save Result then would offer to send the result twice.
 *
 * A typed text (`textPending`) is unsaved work -- closing asks -- but
 * nothing Save may commit: sending a text is never a side effect of
 * saving, so a text never brings Save up on its own. A typed note counts even in a read-only window, where notes can
 * still be allowed; Add Note saves it there.
 */
export function appointmentFooter(s: {
  tab: string;
  readOnly: boolean;
  formDirty: boolean;
  resultDirty: boolean;
  taskPending: boolean;
  notePending: boolean;
  textPending: boolean;
  saving: boolean;
}): { save: boolean; saveResult: boolean; dirty: boolean } {
  const drafts = s.notePending || s.textPending;
  if (s.readOnly) return { save: false, saveResult: false, dirty: drafts };
  const committable = s.formDirty || s.resultDirty || s.taskPending || s.notePending;
  const dirty = committable || drafts;
  if (s.tab === "Result" && !s.formDirty && !s.taskPending && !s.notePending && !s.saving) {
    return { save: false, saveResult: true, dirty };
  }
  // Texts and Photos commit as they go: nothing there for Save to do
  // unless something it can commit is waiting elsewhere in the window.
  const selfSaving = s.tab === "Texts" || s.tab === "Photos";
  return { save: !(selfSaving && !committable), saveResult: false, dirty };
}

/**
 * Why Save left the window open on a typed text: it saves, it never
 * sends, and closing would drop the text without a word.
 */
export function unsentTextNote(savedSomething: boolean): string {
  const note =
    "The text you typed on the Texts tab hasn't been sent: Save never sends a text. Send it or clear it there.";
  return savedSomething ? `Saved. ${note}` : note;
}

/**
 * The question the window's Delete asks (DECISIONS #200). An appointment
 * has no trash -- a delete is for good -- and it used to go on one click
 * when nothing was unsaved. Cancelled is offered as the way to keep it on
 * record.
 */
export function appointmentDeleteConfirm(a: {
  eventType: string;
  who: string | null;
  date: string;
  time: string | null;
  endTime: string | null;
  status: EventStatus;
  /** Text in the window's Appointment Notes box: the appointment's own
   *  field, so it goes with it, unlike its timeline notes and photos. */
  hasNotes: boolean;
  dirty: boolean;
  timeFormat?: TimeFormat;
}): string {
  // Noon, so the day reads the same on every machine.
  const day = new Date(`${a.date}T12:00:00`);
  const dayLabel = isNaN(day.getTime())
    ? a.date
    : day.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const times = formatTimeRange(a.time, a.endTime, a.timeFormat);
  const when = `on ${dayLabel}${times ? ` at ${times}` : ""}`;
  const what = a.who ? `the ${a.eventType} appointment with ${a.who}` : `this ${a.eventType} appointment`;
  return [
    `Delete ${what} ${when}?`,
    "This can't be undone. It leaves the calendar, the reports and any Google Calendar copy." +
      (a.hasNotes ? " What's written in Appointment Notes is deleted with it." : "") +
      (a.who ? ` Notes and photos added to ${a.who}'s contact stay there.` : ""),
    a.status === "Cancelled" ? "" : "If it just isn't happening, set Status to Cancelled instead: that keeps it on record.",
    a.dirty ? "Your unsaved changes to it are discarded too." : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * A typed job value, to the cent: `leads.value` is numeric(12,2), and an
 * unrounded figure never equalled the stored one, so the window kept it
 * as an unsaved edit forever. Not a number stays NaN for the caller to
 * refuse.
 */
export function parseJobValue(text: string): number {
  return Math.round(Number(text.replace(/[^0-9.]/g, "")) * 100) / 100;
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
