/**
 * What changed in each version of the CRM, in the words a person on the
 * team reads on screen.
 *
 * Every pull request bumps `package.json`'s version AND adds an entry
 * here, newest first (`release-notes.test.ts` fails when the two drift).
 * The entry is what the update popup shows a stale tab ("a new version
 * is out -- here's what's in it") and what the What's new screen shows
 * once, to every browser, after it loads the new build. Write each note
 * as what a user sees differently, not what the code does.
 */

export type ReleaseNote = {
  /** The package.json version this entry describes, e.g. "1.132.0". */
  version: string;
  /** The day it shipped, YYYY-MM-DD. */
  date: string;
  /** One line per change, plain language, newest change first. */
  notes: string[];
};

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: "1.132.0",
    date: "2026-09-22",
    notes: [
      "Every update now announces itself: after a new version goes live, a What's new screen lists what changed the first time you open the CRM, and the update popup on older tabs shows the same list before you refresh.",
      "The version in the sidebar now changes with every update, so \"which version are you on?\" always has a real answer.",
    ],
  },
];

/** The newest entry -- the version this codebase is at. */
export function latestRelease(): ReleaseNote {
  return RELEASE_NOTES[0];
}

/** The entry for one version, or null when none was written for it. */
export function notesForVersion(version: string): ReleaseNote | null {
  return RELEASE_NOTES.find((r) => r.version === version) ?? null;
}

/**
 * Should the What's new screen open for the build this browser just
 * loaded? Once per version per browser: `seen` is the version the
 * person last pressed "Got it" on (null when they never have). A build
 * with no note written has nothing to announce.
 */
export function shouldShowWhatsNew(loaded: string, seen: string | null): boolean {
  if (!notesForVersion(loaded)) return false;
  return seen !== loaded;
}
