/**
 * The browser tab title -- and why two things care about it.
 *
 * Every browser names a saved PDF after document.title: Chrome, Edge,
 * Firefox and Safari all suggest "<tab title>.pdf" in the "Save as PDF"
 * dialog. So the title of a proposal or contract page IS the file name
 * the customer (and the rep) end up with. It used to be the app name on
 * every page, which is why every saved proposal was Contractor_CRM.pdf.
 *
 * The popup watcher also writes the title: it prefixes "(3) New alerts — "
 * while the CRM window is in the background. It used to remember the
 * title from the moment it mounted -- and since the app layout mounts
 * once and lives across every in-app navigation, that snapshot was the
 * app name forever, written back over whatever the page had set on every
 * 20-second poll. Now it derives the page's own title from the current
 * one by stripping its own badge, so a page title survives it.
 */

const BADGE = /^\(\d+\) New alerts — /;

/** The page's own title: the current one with the alert badge taken off. */
export function pageTitle(current: string): string {
  return current.replace(BADGE, "");
}

/**
 * What the tab should read right now: badged while the window is hidden
 * and something new is waiting, otherwise the page's own title. Idempotent
 * -- feeding it an already-badged title never stacks a second badge.
 */
export function tabTitle(current: string, hidden: boolean, waiting: number): string {
  const base = pageTitle(current);
  return hidden && waiting > 0 ? `(${waiting}) New alerts — ${base}` : base;
}

// What no file system accepts in a name. The browser would swap these
// itself, but each does it differently; one predictable rule here.
const UNSAFE = /[<>:"/\\|?*\u0000-\u001f]/g;

/**
 * The tab title for a proposal, contract or change order: its document
 * number ("EST-1048") and nothing else -- no spaces for Chrome to turn
 * into underscores, no customer name to truncate. The fallback is for a
 * document that has no number, or one the viewer may not see.
 */
export function documentTitle(docNumber: string | null | undefined, fallback = "Estimate"): string {
  const n = (docNumber ?? "").replace(UNSAFE, "-").trim();
  return n || fallback;
}
