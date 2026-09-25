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
    version: "1.155.1",
    date: "2026-09-25",
    notes: [
      "The client portal's browser tab now shows your company logo, the same one at the top of the page, instead of the old AI Build Pros icon.",
    ],
  },
  {
    version: "1.155.0",
    date: "2026-09-25",
    notes: [
      "The client portal has a fresh, more colourful look: your customers now land on a dark branded banner with their name, and each section has its own colour and icon.",
      "Project status shows a progress bar and \"Step 3 of 5\", and the estimate shows coloured tags (Signed, Deposit paid, deposit due) so customers see where things stand at a glance.",
      "With nothing booked, customers get a one-tap Call button; licences and insurance show as tiles; social links wear each network's own colour, and the review stars are now gold.",
    ],
  },
  {
    version: "1.154.0",
    date: "2026-09-24",
    notes: [
      "Settings → Facebook Lead Ads has a Connect with Facebook button: sign in with the account that runs your business Page (Business Manager is fine), pick the Page, and its lead-form leads start arriving in Contacts & Leads. No developer app or tokens to copy.",
      "The same page now tells you when Facebook stops accepting the connection, with a Reconnect button, instead of leads quietly stopping.",
      "Switch Page or Disconnect from the same card. The old manual setup is still there under Advanced for anyone already using it.",
    ],
  },
  {
    version: "1.153.0",
    date: "2026-09-24",
    notes: [
      "New Settings → PrimeCall Phone System: connect your PrimeCall office phones, and every call in or out shows up in Call Reports and on the caller's contact card, with the recording to play.",
      "Someone who calls your PrimeCall number and isn't in the CRM yet becomes a new lead in Unsorted, and the office gets the usual new-lead text.",
      "Each call is credited to the person whose email matches their PrimeCall extension. The settings page shows which extension belongs to whom.",
    ],
  },
  {
    version: "1.152.0",
    date: "2026-09-24",
    notes: [
      "+ Add bill now asks \"Paid?\": Not paid yet, Paid in part, or Paid in full. For each payment, pick how it was paid (Check, Card, Cash, Zelle, ACH, Wire or Other), the account it came from, the check or reference number, and the date. You can add as many payments as needed, for example $800 on the card and $300 by check. Whatever isn't paid yet waits in Bills to Pay.",
      "New Settings → Payment Accounts: list the bank accounts, cards and cash you pay vendors from. They appear as \"Paid from\" when you add a bill, and in Bills to Pay's Pay window.",
      "In Bills to Pay you can now edit a bill that's already paid or part paid (vendor, job, what it was for, or a larger total). The job's costs update to match.",
      "Bills are now recorded the way QuickBooks records them (one bill, with a payment for each payment), so they'll be ready when QuickBooks sync is added.",
    ],
  },
  {
    version: "1.151.0",
    date: "2026-09-24",
    notes: [
      "A project's 🧾 Bills window now shows which contract each paid bill counts toward, when the customer has more than one contract. Bills not assigned to any contract get a yellow warning, because sales commission doesn't count them. Click \"Assign all to EST-…\", or the button on one row, to put them on that project's contract.",
      "The bottom of that window also shows how much is counted on this project's contract (the figure its commission uses) next to the total across all contracts.",
    ],
  },
  {
    version: "1.150.0",
    date: "2026-09-24",
    notes: [
      "Commission statement: a new Job picker shows one job's commission on its own. It lists the contract, lead cost, every bill, net profit, the commission pool and each salesperson's share. It also shows what's still needed before it can be paid, the customer's payments, and what's already been paid out. Click any job name on the statement to open the same view.",
      "When a customer has more than one contract, + Add bill and ✎ Edit now ask \"Which contract?\". From a project row, it's picked for you. Before this, those bills counted toward none of the customer's contracts, so the commission said \"Job costs not recorded yet\".",
      "Bills already saved without a contract are now flagged on the commission statement, with a link to assign them.",
    ],
  },
  {
    version: "1.149.0",
    date: "2026-09-24",
    notes: [
      "Bills you saved as \"Already paid\" now have an ✎ Edit button, both in Bills to Pay → Paid and in a project's 🧾 Bills window. Fix the job, vendor, what it was for, the amount, the date paid or the receipt, or delete the bill.",
      "Paid bills saved without a receipt show a 📎 Attach button. Click it or drop the photo or PDF on it.",
      "Bills synced from QuickBooks stay locked, because the next sync would undo an edit.",
      "The count on the selected tab (for example Paid) is readable again. It was white on white.",
    ],
  },
  {
    version: "1.148.0",
    date: "2026-09-23",
    notes: [
      "Bills to Pay → Paid now also lists the bills you saved on a project with \"Already paid\" switched on, under \"Paid on entry\", with the receipt, vendor, job, date paid and amount. They show there read-only; change or remove one from the project's Bills.",
    ],
  },
  {
    version: "1.147.1",
    date: "2026-09-23",
    notes: [
      "Customer deposits now always go into your company's own Stripe account, connected under Settings → Portal Payments. A company that hasn't connected one doesn't show an online Pay button, instead of falling back to the AI Build Pros account.",
    ],
  },
  {
    version: "1.147.0",
    date: "2026-09-23",
    notes: [
      "New Settings → Subscription page: Office and Admin users can update the card the AI Build Pro plan is paid with, download invoices, or cancel.",
      "If a card payment for the subscription fails, a yellow notice across the top says so while Stripe retries. If the subscription ends, the CRM locks and shows a page to renew it. Nothing is deleted, and everything comes back the moment it's renewed.",
    ],
  },
  {
    version: "1.146.0",
    date: "2026-09-23",
    notes: [
      "Every estimate now shows its rep at the top, next to the customer's name and address. Until it's signed, the rep is whoever holds the lead, and a link opens the lead card to change it. A signed contract shows the rep who sold it.",
    ],
  },
  {
    version: "1.145.2",
    date: "2026-09-23",
    notes: [
      "Estimate Status now shows an unsigned estimate under the rep who holds the customer today. Before, it stayed under whoever held the lead when the estimate was made, so filtering by rep showed estimates that had since been handed to someone else. Signed contracts still stay with the rep who sold them.",
    ],
  },
  {
    version: "1.145.1",
    date: "2026-09-23",
    notes: [
      "The CRM phone app now carries the AI Build Pros logo on its icon and its opening screen, instead of a placeholder.",
    ],
  },
  {
    version: "1.145.0",
    date: "2026-09-23",
    notes: [
      "The CRM is getting its own phone app. Clocked in from the app, your location keeps being shared with your phone locked or in your pocket, so arrivals at jobs are logged without opening the CRM. On Android an \"On the clock\" notification shows while it's sharing. Sharing still stops the moment you clock out.",
      "If location is blocked for the app, the \"On the clock\" pill turns orange with an Open settings button.",
    ],
  },
  {
    version: "1.144.0",
    date: "2026-09-23",
    notes: [
      "New Time Clock (Staff menu): clock in, take a break and clock out from your phone. While you're on the clock the CRM shares your location and logs your arrival at each appointment automatically. Sharing stops when you clock out.",
      "New Team Map for the office: everyone on the clock, live — at a job, driving, stopped somewhere else, or location off.",
      "New Timesheets for the office: weekly hours per person, time on site, late arrivals, overtime and missed clock-outs, with a Fix button that keeps a permanent history of every change, and a CSV export for payroll.",
      "Settings › Time Clock & Tracking: choose who clocks in, the job-zone size, overtime and late rules, the office address, and how long location trails are kept.",
    ],
  },
  {
    version: "1.143.0",
    date: "2026-09-23",
    notes: [
      "The sidebar's standard order is now Dashboard, Marketing Analytics, Dispatch Dashboard, Calendar, Schedule, Estimates & Contracts, Production, Accounting, Dispatch, Call Center, Staff, Estimate Status, Estimate Approvals — and \"Reset to standard order\" on Settings › Menu Order goes back to exactly that.",
    ],
  },
  {
    version: "1.142.0",
    date: "2026-09-23",
    notes: [
      "Estimate Status shows who's on each document: Closer, Rep 1 and Rep 2 columns sit between the document and the customer, so the table fills the screen instead of leaving a gap.",
      "A new Client view column says whether the customer has opened the document (and when), or that it was sent and not opened yet, with a Preview link that opens what the customer sees.",
      "Filters above the table: Status, Closer, Rep (matches either seat) and a customer search, with an 'N of M in flight' count and a Clear button. Closer and Rep lists only offer people who have documents on the board.",
    ],
  },
  {
    version: "1.141.1",
    date: "2026-09-23",
    notes: [
      "Settings › Google Calendar is easier to read: the two connection cards match the rest of Settings, the text is normal size instead of small italics, and the Connect button sits inside its card instead of hanging off the bottom edge.",
    ],
  },
  {
    version: "1.141.0",
    date: "2026-09-23",
    notes: [
      "Google Calendar sync, both ways. Open Settings › Google Calendar (or the 📆 Google Calendar button on the Calendar page) and connect your own Google account: your appointments appear on your Google Calendar with the client, address, notes and a link back to the CRM.",
      "Move or resize an appointment in Google and the CRM follows; delete it in Google and the CRM marks it Cancelled. Cancelled and No-show appointments come off Google, and reassigning one moves it to the new rep's calendar.",
      "Office and Admin users can also connect one company-wide Google Calendar that receives every appointment.",
      "Syncs run every 15 minutes, with a Sync now button for right away. Events you create yourself in Google are never copied into the CRM.",
      "Requires a Google OAuth client on the deployment and migration 0173 in Supabase; until then the page says what's missing.",
    ],
  },
  {
    version: "1.140.0",
    date: "2026-09-22",
    notes: [
      "Platform Admin has a new Invite History card under Invite a Business: every setup link ever sent, paid or by hand, newest first, with the email, the company it became, who sent it, when, and a status chip — Set up, Pending (with the day it expires), Expired, or Send failed.",
      "Tabs narrow the list by status and a search box finds an invite by email or company name.",
      "Resend on a Pending, Expired or Send failed invite puts a fresh link in the same inbox (the old link stops working); Open company on a Set up invite jumps straight into that company.",
      "Manual invites now record which admin sent them (after migration 0172 is run in Supabase; until then the Sent by column shows a dash).",
    ],
  },
  {
    version: "1.139.0",
    date: "2026-09-22",
    notes: [
      "Dispatch Dashboard is now its own item in the sidebar, right under Dashboard, instead of a row inside the Dispatch section. Like every top-level item, an admin can move it in Settings › Menu Order.",
      "If your company has a saved menu order, the new item appears at the bottom of the menu once; drag it where you want it in Settings › Menu Order.",
    ],
  },
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
