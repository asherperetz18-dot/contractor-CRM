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
    version: "1.138.0",
    date: "2026-09-22",
    notes: [
      "New Dispatch Dashboard, first in the Dispatch section of the sidebar: the desk's own overview of new leads coming in and appointments going out.",
      "It opens with what needs attention right now: new leads nobody has called or texted (and how long the oldest has waited), replies waiting, overdue follow-ups, today's appointments not yet confirmed, past appointments still missing a result, and the unclaimed pool. Every card opens the page that lists its rows.",
      "Below that, the period's pace with change against the previous period: new leads, how many were reached within an hour (and the typical time to first call or text), appointments booked, show rate, and dials with the connect rate.",
      "Then today's board with a confirmation pill per visit, the next seven days on the calendar, leads still waiting for a first appointment by age, call outcomes, and a per-dispatcher desk table with a booking rate.",
      "Dispatch users see it by default; other roles can be given it in Settings › Role Visibility. A dispatcher who is not a supervisor sees only their own numbers.",
    ],
  },
  {
    version: "1.137.0",
    date: "2026-09-22",
    notes: [
      "The appointment window's Estimates tab now has a \"Write estimate for …\" button: one tap creates the estimate for that customer and opens it ready to price -- no more leaving the appointment to go hunt for New Estimate.",
    ],
  },
  {
    version: "1.136.0",
    date: "2026-09-22",
    notes: [
      "The Reply Inbox is live: when a customer texts back (a YES, a question, anything), the open conversation updates by itself within about 20 seconds -- no more refreshing the page to see the reply. Your selected thread and a half-typed reply stay put while it updates.",
    ],
  },
  {
    version: "1.135.1",
    date: "2026-09-22",
    notes: [
      "Fixed: texting a contact for the first time from an appointment's Send SMS no longer says \"No phone number to send to\" -- the composer now keeps the contact's name and number, and it also finds a number saved under the second contact.",
    ],
  },
  {
    version: "1.135.0",
    date: "2026-09-22",
    notes: [
      "The sidebar's \"Dispatch (Leads Mgmt.)\" is now just \"Dispatch\", so the heading fits on one line next to the unread count.",
      "\"Appt. Setter Assignments\" reads \"Setter Assignments\" in the sidebar. Same page, same address; the page's own title is unchanged.",
      "The greyed \"Dispatch Dashboard · Soon\" row is gone from the sidebar until that page exists. It was the only row that did nothing when tapped.",
      "If you had arranged the menu in Settings › Menu Order, Dispatch stays where it was.",
    ],
  },
  {
    version: "1.134.0",
    date: "2026-09-22",
    notes: [
      "The sidebar's \"Your Sales Center\" is now called \"Call Center\": the Power Dialer and the call, text and appointment reports, named after the people who use them.",
      "Salespeople (the rep leaderboard) has its own new \"Staff\" section in the sidebar, right under Call Center. Same page, same address, just a home that fits.",
      "Every sidebar section now has its own color on its icon and left edge (Dispatch blue, Call Center teal, Staff rose, Production orange, Accounting gold), so you can spot a section without reading it.",
      "If you had arranged the menu in Settings › Menu Order, Call Center and Staff sit where Your Sales Center was. Nothing else moved.",
    ],
  },
  {
    version: "1.133.0",
    date: "2026-09-22",
    notes: [
      "The appointment and contact cards are now linked: save an appointment and its Assigned To / Second Assigned To fill the customer's empty Assigned Rep and Partner Rep seats automatically, with a note on the timeline saying so. A seat someone already holds is never overwritten, and the Closer never changes from an appointment.",
      "Booking is faster: new appointments start with the customer's own rep pre-picked, and an old appointment with an empty rep box gets a one-tap \"Use customer's rep\" button.",
      "Reminder texts have a safety net: a visit with nobody booked now texts the customer's rep instead of texting no one.",
    ],
  },
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
