/**
 * Unsaved work held by an open window, for the ways out the window can't
 * see (DECISIONS #203). The contact and appointment windows ask before
 * their own buttons drop what's typed; a popup alert sits above them and
 * navigated away without a word, and a reload or closing the tab never
 * asked. While a window holds work here, an alert runs that window's own
 * leave check first, and the browser asks before unloading (its own
 * generic words: custom text is ignored, and iPhones never ask).
 *
 * Browser Back isn't covered: this Next.js has no way to stop it in the
 * App Router (TECH_DEBT).
 */

type Leave = () => boolean | Promise<boolean>;
type Target = {
  addEventListener(type: "beforeunload", listener: typeof unsavedBeforeUnload): void;
  removeEventListener(type: "beforeunload", listener: typeof unsavedBeforeUnload): void;
};

const holds = new Map<symbol, Leave>();

function browser(): Target | null {
  return typeof window === "undefined" ? null : window;
}

/** Holds a window's work until the returned release is called. */
export function holdUnsaved(leave: Leave, target: Target | null = browser()): () => void {
  const id = Symbol();
  holds.set(id, leave);
  // Only while something is held: an unload listener can keep a page out
  // of the browser's back/forward cache.
  if (holds.size === 1) target?.addEventListener("beforeunload", unsavedBeforeUnload);
  return () => {
    if (!holds.delete(id)) return;
    if (holds.size === 0) target?.removeEventListener("beforeunload", unsavedBeforeUnload);
  };
}

/** Each holding window's own check, in turn; the first "stay" stops it. */
export async function leaveUnsavedOk(): Promise<boolean> {
  for (const leave of [...holds.values()]) {
    if (!(await leave())) return false;
  }
  return true;
}

export function unsavedBeforeUnload(e: { preventDefault(): void; returnValue?: unknown }): void {
  if (holds.size === 0) return;
  e.preventDefault();
  // Older Chrome and Edge ask only when this is set.
  e.returnValue = true;
}
