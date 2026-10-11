import { attempt, type StepResult } from "./appointment-save.ts";

/**
 * The contact window's autosave (DECISIONS #202). It saves a second after
 * the last edit, and closing the window used to cancel that second: a
 * field changed just before closing was dropped, and so was one that
 * couldn't be saved, without a word. A save still waiting could also land
 * after ✕ Lost, Create Job or booking and write the old stage back. Every
 * way out of the window now settles the save first.
 */

type SecondContact = {
  second_contact_first_name: string;
  second_contact_last_name: string;
  second_contact_phone: string;
  second_contact_email: string;
};

/** What a save writes: a removed second contact goes as blanks. */
export function contactPayload<F extends SecondContact>(form: F, hasSecondContact: boolean): F {
  if (hasSecondContact) return form;
  return {
    ...form,
    second_contact_first_name: "",
    second_contact_last_name: "",
    second_contact_phone: "",
    second_contact_email: "",
  };
}

/**
 * Two payloads with the same fields save the same. Comparing these, not
 * the form object, also counts removing the second contact as a change.
 */
export function contactSaveKey(payload: object): string {
  return JSON.stringify(payload);
}

/** What leaving the window does with the fields' unsaved change. */
export function closeStep(s: { editable: boolean; dirty: boolean; valid: boolean }): "close" | "save" | "ask-incomplete" {
  if (!s.editable || !s.dirty) return "close";
  return s.valid ? "save" : "ask-incomplete";
}

/** The footer's word on the fields. A failed save isn't "Saving…": nothing is. */
export function contactSaveStatus(s: { valid: boolean; dirty: boolean; failed: boolean }): string {
  if (!s.valid) return "Not saved — fill in required fields (marked *)";
  if (!s.dirty) return "✓ Saved";
  return s.failed ? "Not saved — see the message above" : "Saving…";
}

export const INCOMPLETE_CLOSE_QUESTION =
  "This contact is missing a required field (marked *), so your latest changes can't be saved. Close this contact without them?";

export function failedCloseQuestion(error: string): string {
  return `Your latest changes aren't saved: ${error}\n\nClose this contact without them?`;
}

/** How long leaving waits on a save before asking (DECISIONS #202). */
export const SAVE_WAIT_MS = 15_000;
export const SAVE_SLOW =
  "The save is taking too long; the connection may be slow or down. It may still go through.";

/**
 * A save that never answers would hold the window shut, so leaving gives
 * up waiting after `ms` and asks. The save itself isn't stopped.
 */
export function withinWait(save: Promise<{ error?: string }>, ms: number = SAVE_WAIT_MS): Promise<{ error?: string }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ error: SAVE_SLOW }), ms);
    void save.then((result) => {
      clearTimeout(timer);
      resolve(result);
    });
  });
}

/**
 * Sends the window's saves one after another, in the order they were
 * made, never the same fields twice at once and never fields already
 * saved. A save that fails is tried again on the next send.
 *
 * `hold` keeps the latest valid payload for `flushHeld`, which the window
 * calls when it goes away by a route it doesn't control (another contact
 * opening, a link elsewhere on the page): it sends without waiting, as
 * nobody is left to tell. `abandon` drops the held change: a person
 * choosing to close without it, or the contact being deleted.
 *
 * `savedPayload` is what the contact holds as far as the window knows,
 * for an action that must not act on values that never saved.
 */
export function createContactSaver<P extends object>(save: (payload: P) => Promise<StepResult>, opening: P) {
  let saved = contactSaveKey(opening);
  let savedValue = opening;
  let tail: Promise<unknown> = Promise.resolve();
  let last: { key: string; promise: Promise<{ error?: string }> } | null = null;
  let held: P | null = null;

  function send(payload: P): Promise<{ error?: string }> {
    const key = contactSaveKey(payload);
    if (last?.key === key) return last.promise;
    const promise = tail.then(async (): Promise<{ error?: string }> => {
      if (key === saved) return {};
      const { error } = await attempt(() => save(payload));
      if (error) return { error };
      saved = key;
      savedValue = payload;
      return {};
    });
    const entry = { key, promise };
    last = entry;
    tail = promise;
    void promise.then(() => {
      if (last === entry) last = null;
    });
    return promise;
  }

  return {
    send,
    savedKey: () => saved,
    savedPayload: () => savedValue,
    // A save still out with other fields counts too: an edit undone while
    // it's out matches what was saved before, but not what's on its way.
    dirty: (payload: P) => {
      const key = contactSaveKey(payload);
      return key !== saved || (last !== null && last.key !== key);
    },
    hold(payload: P | null) {
      held = payload;
    },
    flushHeld() {
      if (held) void send(held);
    },
    abandon() {
      held = null;
    },
  };
}
