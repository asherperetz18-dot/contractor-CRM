export type ContactType = "Individual" | "Company";

export type AppRole =
  | "Office"
  | "Field"
  | "Admin"
  | "Sales"
  | "Call Center"
  | "Dispatch"
  | "Bookkeeping";
export const APP_ROLES: AppRole[] = [
  "Office",
  "Field",
  "Admin",
  "Sales",
  "Call Center",
  "Dispatch",
  "Bookkeeping",
];

export type UserStatus = "Active" | "Archived";

export type Profile = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  roles: AppRole[];
  status: UserStatus;
  can_delete_leads: boolean;
  can_view_estimates: boolean;
  can_create_estimates: boolean;
  // A dispatcher who runs the desk: sees every lead, enters new ones,
  // adds sources, assigns dispatchers. Only meaningful alongside the
  // Dispatch role; set per member in Users & Roles like the flags above.
  is_dispatch_supervisor?: boolean;
  // Break-glass flag set in the database, not through the UI. Grants
  // Admin in every company and makes the account undemotable in-app.
  is_super_admin?: boolean;
  created_at: string;
};

// Admin Settings (company profile, users & roles): Office or Admin.
export function isAdminRole(profile: Pick<Profile, "roles"> | null) {
  if (!profile) return false;
  return profile.roles.includes("Office") || profile.roles.includes("Admin");
}

// The Admin role on its own, deliberately excluding Office. For pages
// that expose people rather than configuration -- Team Activity reports
// how long each named person spent on which screen, which is the
// owner's business and not every Office user's.
export function isStrictAdmin(profile: Pick<Profile, "roles" | "is_super_admin"> | null) {
  if (!profile) return false;
  return profile.is_super_admin === true || profile.roles.includes("Admin");
}

/** Cannot be demoted, archived or removed through the app, by anyone. */
export function isSuperAdmin(profile: Pick<Profile, "is_super_admin"> | null) {
  return profile?.is_super_admin === true;
}

// Dispatch section (Pipeline, Contacts, Appt. Setter Assignments): Office
// or Sales can create/edit; delete on leads is a separate, narrower check.
// Admin is included throughout -- it is the full-access role, and omitting
// it here meant an Admin-only user silently couldn't save a contact.
export function canEditDispatch(profile: Pick<Profile, "roles"> | null) {
  if (!profile) return false;
  return (
    profile.roles.includes("Office") ||
    profile.roles.includes("Admin") ||
    profile.roles.includes("Sales") ||
    // Assigning leads and moving them along is the entire job of the
    // Dispatch role -- it is named after this section.
    profile.roles.includes("Dispatch")
  );
}

/**
 * Who may write a note on a customer they can already see.
 *
 * Everyone signed in. Writing down what a customer said is not an
 * administrative act -- it is the job -- and the database already draws
 * the only boundary that matters: a Sales-only rep can reach their own
 * leads and no one else's, so "any role" still means "their own
 * customers".
 *
 * Separate from canEditSchedule on purpose. The appointment modal was
 * gating its Notes tab on that, which excludes Sales, so a rep could
 * open the appointment, read the history and have no way to add to it.
 * Rescheduling somebody's visit and recording what they told you on the
 * phone are different rights.
 */
export function canWriteLeadNotes(profile: Pick<Profile, "roles"> | null) {
  return !!profile;
}

export function canDeleteLeads(profile: Pick<Profile, "roles" | "can_delete_leads"> | null) {
  if (!profile) return false;
  if (profile.roles.includes("Office") || profile.roles.includes("Admin")) return true;
  return profile.roles.includes("Sales") && profile.can_delete_leads;
}

// Estimates carry prices, margins and signed dollar commitments, so who
// can open one and who can write one are granted per person rather than
// inherited from a role. Office and Admin always hold both -- an owner
// must not be able to switch themselves out of their own money.
export function canViewEstimates(
  profile: Pick<Profile, "roles" | "can_view_estimates"> | null
) {
  if (!profile) return false;
  if (profile.roles.includes("Office") || profile.roles.includes("Admin")) return true;
  // Bookkeeping has to open a contract to file a cost against the right
  // phase. Reading one is the job; editing one is not -- canCreateEstimates
  // deliberately does not follow.
  if (profile.roles.includes("Bookkeeping")) return true;
  return profile.can_view_estimates;
}

/**
 * Who may record what a job cost.
 *
 * Its own capability rather than a lean on canCreateEstimates. Before
 * this, the only way to let a bookkeeper enter a receipt was to let them
 * create and edit estimates -- putting a person hired to file paperwork
 * one click from editing a signed contract.
 */
export function canManageCosts(profile: Pick<Profile, "roles"> | null) {
  if (!profile) return false;
  return (
    profile.roles.includes("Bookkeeping") ||
    profile.roles.includes("Office") ||
    profile.roles.includes("Admin")
  );
}

export function canCreateEstimates(
  profile: Pick<Profile, "roles" | "can_view_estimates" | "can_create_estimates"> | null
) {
  if (!profile) return false;
  if (profile.roles.includes("Office") || profile.roles.includes("Admin")) return true;
  // Writing an estimate you are not allowed to open is incoherent, so
  // create is meaningless without view and does not stand on its own.
  return profile.can_create_estimates && profile.can_view_estimates;
}

// Calendar, Schedule and Production: who can book, edit, drag and
// complete work. Field crews need this alongside Office; Admin is the
// full-access role. These pages each used to inline "Office || Field",
// which silently left Admins unable to touch the calendar at all.
/**
 * Who may remove an appointment outright.
 *
 * Office and Admin only. Deliberately NOT canEditSchedule, which also
 * includes Dispatch and Field: booking, moving and confirming visits is
 * those roles' daily work, but destroying the record of a visit that
 * happened is a different act. An appointment is the evidence a trip was
 * made -- it is what the show rate, the follow-up cron and a rep's
 * commission all read -- so removing one is an office decision.
 *
 * Cancelled is the tool for "it isn't happening", and it keeps the
 * history. Delete is for a booking made in error.
 */
export function canDeleteAppointments(profile: Pick<Profile, "roles"> | null) {
  if (!profile) return false;
  return profile.roles.includes("Office") || profile.roles.includes("Admin");
}

export function canEditSchedule(profile: Pick<Profile, "roles"> | null) {
  if (!profile) return false;
  return (
    profile.roles.includes("Office") ||
    profile.roles.includes("Admin") ||
    profile.roles.includes("Field") ||
    // Booking, moving and confirming appointments is what a dispatcher
    // does all day; without this the role can see the calendar but not
    // change it, which is not a dispatcher.
    profile.roles.includes("Dispatch")
  );
}

// Your Sales Center (Power Dialer, Call Reports): Office, Sales, or the
// Call-Center-only role can place calls, set dispositions, and manage lists.
export function canUseSalesCenter(profile: Pick<Profile, "roles"> | null) {
  if (!profile) return false;
  return (
    profile.roles.includes("Office") ||
    profile.roles.includes("Admin") ||
    profile.roles.includes("Sales") ||
    profile.roles.includes("Call Center")
  );
}

// Pages that can be individually shown/hidden per role (Settings -> Role
// Visibility), matching the real iBuildPro product. Office/Admin always see
// everything, mirroring its "Admins always have full access" behavior.
export type PageKey =
  | "dashboard"
  | "pipeline"
  | "reply-inbox"
  | "marketing-analytics"
  | "contacts"
  | "salespeople"
  | "appt-setter-assignments"
  | "lead-refunds"
  | "power-dialer"
  | "call-reports"
  | "text-reports"
  | "appointment-reports"
  | "projects"
  | "production"
  | "documents"
  | "payments"
  | "commissions"
  | "sales-commission"
  | "calendar"
  | "schedule"
  | "contracts";

// Registry entries carrying this group are not a collapsible sidebar
// section -- they render as top-level links, in registry order. Role
// Visibility still shows them under one "General" heading.
export const TOP_LEVEL_NAV_GROUP = "General";

// The single source of truth for pages: Role Visibility reads it to build
// its matrix, and lib/nav.ts derives the sidebar from it. Array order is
// sidebar order. Adding a page here is all that is needed to route it,
// list it, and make it govern-able -- see the note in lib/nav.ts.
export const PAGE_REGISTRY: { key: PageKey; label: string; href: string; group: string }[] = [
  { key: "dashboard", label: "Dashboard", href: "/", group: "General" },
  {
    key: "marketing-analytics",
    label: "Marketing Analytics",
    href: "/marketing-analytics",
    group: "General",
  },
  { key: "pipeline", label: "Leads Pipeline", href: "/pipeline", group: "Dispatch (Leads Mgmt.)" },
  { key: "reply-inbox", label: "Reply Inbox", href: "/reply-inbox", group: "Dispatch (Leads Mgmt.)" },
  { key: "contacts", label: "Contacts", href: "/contacts", group: "Dispatch (Leads Mgmt.)" },
  { key: "salespeople", label: "Salespeople", href: "/salespeople", group: "Dispatch (Leads Mgmt.)" },
  {
    key: "appt-setter-assignments",
    label: "Appt. Setter Assignments",
    href: "/appt-setter-assignments",
    group: "Dispatch (Leads Mgmt.)",
  },
  {
    key: "lead-refunds",
    label: "Lead Refunds",
    href: "/lead-refunds",
    group: "Dispatch (Leads Mgmt.)",
  },
  { key: "power-dialer", label: "Power Dialer", href: "/dial-queue", group: "Your Sales Center" },
  { key: "call-reports", label: "Call Reports", href: "/call-reports", group: "Your Sales Center" },
  { key: "text-reports", label: "Text Reports", href: "/text-reports", group: "Your Sales Center" },
  {
    key: "appointment-reports",
    label: "Appointment Reports",
    href: "/appointment-reports",
    group: "Your Sales Center",
  },
  { key: "projects", label: "Projects", href: "/projects", group: "General" },
  { key: "production", label: "Production", href: "/production", group: "General" },
  // Key stays "documents" so existing role_page_visibility overrides keep
  // pointing at it; only the label and route move. Named "Contracts"
  // rather than "Invoices" because a signed estimate becomes a contract --
  // invoicing is a separate lifecycle and is not built yet.
  { key: "documents", label: "Estimates & Contracts", href: "/estimates", group: "General" },
  { key: "payments", label: "Payments", href: "/payments", group: "General" },
  // Two separate schemes, two separate screens. The dispatcher earns a
  // percentage of the gross sale for bringing the lead in; the rep earns
  // a share of what the job actually made. One page showing both invites
  // them to be read as a single figure.
  { key: "commissions", label: "Dispatch Commission", href: "/commissions", group: "General" },
  {
    key: "sales-commission",
    label: "Sales Commission",
    href: "/sales-commission",
    group: "General",
  },
  { key: "calendar", label: "Calendar", href: "/calendar", group: "General" },
  { key: "schedule", label: "Schedule", href: "/schedule", group: "General" },
  { key: "contracts", label: "Contracts", href: "/contracts", group: "General" },
];

// Roles that can be individually restricted via Role Visibility.
//
// Admin is the only role excluded. Office runs the company day to day but
// is not always meant to see every module -- an office manager who books
// jobs may have no business in Marketing Analytics or Lead Refunds -- so
// it is managed here like any other role, defaulting to full access.
//
// Admin Settings itself is deliberately not in PAGE_REGISTRY and is gated
// by isAdminRole instead, so nothing in this matrix can lock an Office
// user out of the screen they would use to undo it.
export const VISIBILITY_MANAGED_ROLES: AppRole[] = [
  "Office",
  "Dispatch",
  "Field",
  "Sales",
  "Call Center",
  "Bookkeeping",
];

// A dispatcher receives leads, assigns them to reps, books and confirms
// appointments, and works the schedule. They need everyone's leads and
// the whole calendar -- and nothing to do with money, so Estimates,
// Lead Refunds and Marketing Analytics are off by default. All of it is
// overridable per company in Role Visibility.
const DISPATCH_DEFAULT_PAGES: PageKey[] = [
  "dashboard",
  "pipeline",
  "reply-inbox",
  "contacts",
  "salespeople",
  "appt-setter-assignments",
  "calendar",
  "schedule",
  "call-reports",
  "text-reports",
];

// Projects is the point of the role: sold jobs, what they cost, what is
// left. Estimates & Contracts because a cost is filed against a phase and
// the phases live on the contract. Payments because reconciling what
// arrived is the other half of the job.
const BOOKKEEPING_DEFAULT_PAGES: PageKey[] = [
  "dashboard",
  "projects",
  "documents",
  "payments",
];

// Platform default when no explicit override row exists for a role/page --
// "untouched cells follow the default," same wording as the real product.
// Most roles default to full access; Call Center and Dispatch default to
// the pages their job actually needs.
export function defaultPageVisible(role: AppRole, pageKey: PageKey): boolean {
  // A bookkeeper files receipts and chases money. They are not given the
  // pipeline, the dialer or the contact book -- every one of those is
  // also the customers' names and phone numbers, and none of it is
  // needed to enter a cost. Commissions stays off too: that is payroll,
  // and letting someone see what every rep earns should be a decision
  // taken on purpose in Role Visibility, not a side effect of hiring a
  // bookkeeper.
  if (role === "Bookkeeping") return BOOKKEEPING_DEFAULT_PAGES.includes(pageKey);
  if (role === "Call Center") {
    return (
      pageKey === "dashboard" ||
      pageKey === "power-dialer" ||
      pageKey === "call-reports" ||
      pageKey === "text-reports" ||
      pageKey === "appointment-reports"
    );
  }
  if (role === "Dispatch") return DISPATCH_DEFAULT_PAGES.includes(pageKey);
  // Payments is company-wide money -- everything collected, across every
  // rep's jobs. A rep seeing the whole company's revenue is a different
  // thing from a rep seeing their own commissionable work, so it starts
  // off for the field roles and an Admin can turn it on per role in Role
  // Visibility. Office and Admin keep it: that is who chases the money.
  if (pageKey === "payments" && (role === "Field" || role === "Sales")) return false;
  // Commission is payroll, so who sees whose matters, and the two schemes
  // are gated separately now that they are separate screens.
  //
  // Dispatch commission stays Office and Admin, as it was.
  if (pageKey === "commissions" && role !== "Office" && role !== "Admin") return false;
  // Sales commission adds the Sales role, so a rep can check their own
  // earnings without asking. The report itself filters to the signed-in
  // person unless they are Office or Admin, and that is enforced in the
  // action rather than here -- this only decides whether the page appears.
  if (
    pageKey === "sales-commission" &&
    role !== "Office" &&
    role !== "Admin" &&
    role !== "Sales"
  )
    return false;
  return true;
}

export type RolePageVisibilityRow = {
  id: string;
  role: AppRole;
  page_key: PageKey;
  visible: boolean;
};

export function effectivePageVisible(
  role: AppRole,
  pageKey: PageKey,
  overrides: RolePageVisibilityRow[]
): boolean {
  const override = overrides.find((o) => o.role === role && o.page_key === pageKey);
  return override ? override.visible : defaultPageVisible(role, pageKey);
}

export function canSeePage(
  profile: Pick<Profile, "roles"> | null,
  pageKey: PageKey,
  overrides: RolePageVisibilityRow[]
): boolean {
  if (!profile) return false;
  // Admin alone bypasses the matrix. Office is managed like any other
  // role now, so hiding a page from Office actually hides it.
  if (profile.roles.includes("Admin")) return true;
  if (profile.roles.length === 0) return defaultPageVisible("Field", pageKey);
  // Someone holding several roles sees a page if ANY of their roles can.
  // Restricting a person therefore means restricting every role they
  // hold, which is why the matrix shows each role separately.
  return profile.roles.some((role) => effectivePageVisible(role, pageKey, overrides));
}

export function pathToPageKey(pathname: string): PageKey | null {
  if (pathname === "/") return "dashboard";
  const sorted = [...PAGE_REGISTRY].sort((a, b) => b.href.length - a.href.length);
  const match = sorted.find(
    (p) => p.href !== "/" && (pathname === p.href || pathname.startsWith(p.href + "/"))
  );
  return match?.key ?? null;
}

export type CompanyProfile = {
  company_id: string;
  name: string | null;
  /** "Doing business as" name, shown on customer-facing documents and emails when set. */
  dba: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  call_forward_number: string | null;
  call_forward_timeout: number;
  new_lead_alert_phones: string | null;
  new_lead_alert_daily_cap: number;
  license_holder_name: string | null;
  license_number: string | null;
  license_state: string | null;
  license_type: string | null;
  timezone: string;
  logo_url: string | null;
  call_script: string | null;
  no_show_followup_enabled: boolean;
  no_show_grace_minutes: number;
  no_show_lookback_hours: number;
  time_format: TimeFormat;
  rep_appointment_info_template: string | null;
};

export const REP_APPOINTMENT_INFO_DEFAULT =
  "Appointment: {title}\nClient: {client_name}\n🔧 {project_type}\n📅 {when}\n📍 {address_link}\n\nReply YES to confirm or NO to decline.";

// Fills the rep-facing "Text Rep Info" template. client_name is left blank
// (never the phone number) when the lead has no real name on file -- some
// leads only ever captured a phone number, which gets stored as the
// first_name, and that must never masquerade as a name in this text. Any
// template line built around a variable that came back empty (e.g.
// "Client: {client_name}" or "location line: {address_link}") is dropped
// entirely, whatever label or emoji prefixes it.
const REP_TEMPLATE_EMPTY = "@@EMPTY@@";

export function fillRepInfoTemplate(
  template: string,
  vars: { title: string; clientName: string; when: string; addressLink: string; projectType?: string }
): string {
  const filled = template
    .replace(/\{title\}/g, vars.title || REP_TEMPLATE_EMPTY)
    .replace(/\{client_name\}/g, vars.clientName || REP_TEMPLATE_EMPTY)
    .replace(/\{when\}/g, vars.when || REP_TEMPLATE_EMPTY)
    .replace(/\{address_link\}/g, vars.addressLink || REP_TEMPLATE_EMPTY)
    .replace(/\{project_type\}/g, vars.projectType || REP_TEMPLATE_EMPTY);
  return filled
    .split("\n")
    .filter((line) => !line.includes(REP_TEMPLATE_EMPTY))
    .join("\n");
}

/** One hour after the start, as a sensible first suggestion for an end time. */
export function addHour(time: string): string {
  const [h, m] = (time || "09:00").slice(0, 5).split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return "10:00";
  return `${String((h + 1) % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "1:30 PM", or "" when there's no time. */
export function formatClock(time: string | null, format: TimeFormat = "12h"): string {
  if (!time) return "";
  const hhmm = time.slice(0, 5);
  if (format === "24h") return hhmm;
  const [h, m] = hhmm.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return "";
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

/**
 * "9:00 AM – 10:00 AM" when an end time exists, otherwise just the start.
 * Shared so the calendar, schedule, portal and rep texts all agree.
 */
export function formatTimeRange(
  time: string | null,
  endTime: string | null,
  format: TimeFormat = "12h",
  // Text messages pass "-": the en dash isn't in GSM-7, so one of them
  // flips the whole SMS to UCS-2 and halves how much fits per segment.
  separator = "–"
): string {
  const start = formatClock(time, format);
  if (!start) return "";
  const end = formatClock(endTime, format);
  if (!end) return start;
  // Times come back from Postgres as "HH:MM:SS" but go in as "HH:MM";
  // compare on the same slice so the two forms line up.
  const startKey = (time ?? "").slice(0, 5);
  const endKey = (endTime ?? "").slice(0, 5);
  // Same reading at both ends is a zero-length appointment, not a range.
  if (endKey === startKey) return start;
  return `${start} ${separator} ${end}${endsNextDay(time, endTime) ? " (next day)" : ""}`;
}

/**
 * True when the end reads earlier than the start. Only a wall-clock time is
 * stored -- no date -- so that can only mean the appointment runs past
 * midnight. Labelled wherever it shows rather than hidden: if it was a
 * typo, the label is how anyone notices.
 */
export function endsNextDay(time: string | null, endTime: string | null): boolean {
  if (!time || !endTime) return false;
  return endTime.slice(0, 5) < time.slice(0, 5);
}

// Company-wide display preference for appointment time pickers -- native
// <input type="time"> is locale-driven, so a custom picker enforces this.
export type TimeFormat = "12h" | "24h";

// Maps the company_profile.timezone custom label to a real IANA zone, for
// the handful of features (no-show follow-up windows, SMS reminders) that
// need to reason about "now" in the company's local time.
export const TIMEZONE_IANA: Record<string, string> = {
  Pacific: "America/Los_Angeles",
  Mountain: "America/Denver",
  Central: "America/Chicago",
  Eastern: "America/New_York",
  Alaska: "America/Anchorage",
  Hawaii: "Pacific/Honolulu",
};

export type SmsQuickTextKey = "confirm" | "reschedule" | "on_my_way" | "running_late";

export type SmsQuickText = {
  key: SmsQuickTextKey;
  label: string;
  description: string;
  body: string | null;
};

// Hyphens, not em dashes. The em dash isn't in GSM-7, and a single one
// re-encodes the whole message as UCS-2 -- which drops capacity from 160
// characters per segment to 70, so a 156-character confirmation costs
// three segments instead of one.
export const QUICK_TEXT_DEFAULTS: Record<SmsQuickTextKey, string> = {
  confirm:
    "Hi {first_name}, this is {rep_name} with {company_name}. Just confirming we're still on for {when} - reply YES to confirm or NO to reschedule.\n{links}",
  reschedule:
    "Hi {first_name}, this is {rep_name} with {company_name}. We need to reschedule your {when} appointment - what time works better for you?",
  on_my_way:
    "Hi {first_name}, this is {rep_name} with {company_name} - on my way to your {when} appointment now!",
  running_late:
    "Hi {first_name}, this is {rep_name} with {company_name}. Running a little behind for our {when} appointment, I'll be there shortly - sorry for the delay!",
};

/**
 * A company link as it should appear in a text: no scheme, no "www.", no
 * trailing slash. Phones linkify "aibuildpros.com" perfectly well, and the
 * prefix costs 12 characters per link that come straight out of the
 * segment budget. A bare Instagram handle ("@aibuildpros") is expanded to
 * a real domain so it's tappable.
 */
export function smsLink(raw: string | null, handleDomain?: string): string {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "";
  if (handleDomain && trimmed.startsWith("@")) {
    return `${handleDomain}/${trimmed.slice(1)}`;
  }
  return trimmed
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/, "");
}

export function fillQuickTextVariables(
  template: string,
  vars: {
    firstName: string;
    when: string;
    repName: string;
    companyName: string;
    website?: string | null;
    facebookUrl?: string | null;
    instagramUrl?: string | null;
  }
): string {
  const website = smsLink(vars.website ?? "");
  const facebook = smsLink(vars.facebookUrl ?? "", "facebook.com");
  const instagram = smsLink(vars.instagramUrl ?? "", "instagram.com");
  // Only the links actually filled in on the company profile. " | " rather
  // than a middot: the middot isn't in GSM-7 and would re-encode the whole
  // message (the pipe costs 2 septets, which is the cheap way to do this).
  const links = [website, facebook, instagram].filter(Boolean).join(" | ");

  const filled = template
    .replace(/\{first_name\}/g, vars.firstName || "there")
    .replace(/\{when\}/g, vars.when)
    .replace(/\{rep_name\}/g, vars.repName || "your rep")
    .replace(/\{company_name\}/g, vars.companyName)
    .replace(/\{links\}/g, links || REP_TEMPLATE_EMPTY)
    .replace(/\{website\}/g, website || REP_TEMPLATE_EMPTY)
    .replace(/\{facebook\}/g, facebook || REP_TEMPLATE_EMPTY)
    .replace(/\{instagram\}/g, instagram || REP_TEMPLATE_EMPTY);

  // Same rule as the rep template: a line whose link was never filled in
  // drops out whole, so nobody gets a text ending in a bare "Instagram:".
  return filled
    .split("\n")
    .filter((line) => !line.includes(REP_TEMPLATE_EMPTY))
    .join("\n")
    .trimEnd();
}

// Stages are admin-managed (Settings -> Pipeline Stages), not a fixed
// set, so this is just a plain string matching a pipeline_stages.name.
export type PipelineStage = string;

// Stages where the outcome is already decided. Work sitting in one of
// these is history: reassigning it would credit a deal to someone who
// didn't close it, which is why handovers default to open work only.
export type TouchKind = "opened" | "note" | "task" | "appointment" | "call" | "text";

// Lives here, not beside the action that produces it: a "use server"
// module may only export async functions, so a const exported from one
// reaches the client as a server reference rather than the value.
export const TOUCH_LABEL: Record<TouchKind, string> = {
  opened: "Opened",
  note: "Note",
  task: "Task",
  appointment: "Appointment",
  call: "Call",
  text: "Text",
};

export const CLOSED_PIPELINE_STAGES = ["Won", "Lost", "Not Interested", "DNC"];

export function isClosedStage(stage: string): boolean {
  return CLOSED_PIPELINE_STAGES.includes(stage);
}

// Stages that take a lead out of the working pipeline entirely. Chasing a
// deal you already won isn't a follow-up, so counts of outstanding work
// skip these -- and both the pipeline's Follow-ups Due panel and the
// Daily Brief read it from here so they can't drift apart again.
export const SETTLED_LEAD_STAGES = ["Won", "Lost"];

export function isSettledStage(stage: string): boolean {
  return SETTLED_LEAD_STAGES.includes(stage);
}

// Stage names that app logic depends on directly (auto-advance on
// booking, pipeline value/won stats) -- protected from rename/delete
// in the Pipeline Stages admin UI, but still reorderable.
export const SYSTEM_STAGE_NAMES = [
  "Unsorted",
  "Appointment Scheduled",
  "Won",
  "Lost",
];

export type PipelineStageRow = {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  is_system: boolean;
  created_at: string;
};

export const FALLBACK_STAGE_COLOR = "#9A9384";

export function stageColor(stages: { name: string; color: string }[], name: string) {
  return stages.find((s) => s.name === name)?.color ?? FALLBACK_STAGE_COLOR;
}

// Calendars are admin-managed (Settings -> Calendars), not a fixed set,
// so this is just a plain string matching a calendars.name.
export type EventType = string;

export type CalendarRow = {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  is_system: boolean;
  created_at: string;
};

export type ProjectTypeRow = {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
};

export type LeadSourceRow = {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
};

export type EventStatus =
  | "New"
  | "Confirmed"
  | "Showed"
  | "Won"
  | "No-show"
  | "Cancelled";
// Ordered as the appointment actually progresses, so the chip row reads
// left to right the way the day does: booked, confirmed, turned up,
// sold -- then the two ways it can fail.
export const EVENT_STATUSES: EventStatus[] = [
  "New",
  "Confirmed",
  "Showed",
  "Won",
  "No-show",
  "Cancelled",
];
export type EventVisual = "cancelled" | "noshow" | "confirmed" | "pending";

/**
 * How an appointment should read on the calendar.
 *
 * Deliberately not a colour: the chip's colour already carries which
 * calendar the appointment belongs to, and Job Visit is green. Painting
 * confirmations green too would make a green block mean either "job
 * visit" or "confirmed estimate", which is worse than not marking it.
 *
 * Confirmation comes from customer_confirmed, not from status. The status
 * dropdown is set by hand; customer_confirmed is what the "reply YES to
 * confirm" text actually sets. On this calendar 30 appointments are
 * confirmed by the customer while only 7 carry the Confirmed status, so
 * reading status would show most of the week as unconfirmed when the
 * customer has already said yes.
 *
 * Status still wins for Cancelled and No-show, because those are
 * decisions somebody records rather than something the customer replies.
 */
export function eventVisualState(
  event: Pick<Event, "status" | "customer_confirmed">
): EventVisual {
  if (event.status === "Cancelled") return "cancelled";
  if (event.status === "No-show") return "noshow";
  return event.customer_confirmed ? "confirmed" : "pending";
}

export const EVENT_STATUS_COLOR: Record<EventStatus, string> = {
  New: "#7C8798",
  Confirmed: "#2F855A",
  Showed: "#2D5F8A",
  // Gold rather than another green. Confirmed is already green, and the
  // one status worth spotting across a month of chips is the one that
  // made money.
  Won: "#B7791F",
  "No-show": "#C7691B",
  Cancelled: "#C0392B",
};

export type Event = {
  id: string;
  title: string | null;
  date: string;
  time: string | null;
  // Null means no end time was recorded. Displays fall back to showing
  // just the start rather than inventing a duration.
  end_time: string | null;
  event_type: EventType;
  status: EventStatus;
  assigned_to: string | null;
  second_assigned_to: string | null;
  job_id: string | null;
  lead_id: string | null;
  notes: string | null;
  customer_confirmed: boolean;
  rep_confirmed: boolean;
  rep_info_sent_at: string | null;
  second_rep_info_sent_at: string | null;
  notes_updated_by: string | null;
  followup_flagged_at: string | null;
  result_reminder_sent_at: string | null;
  followup_moved_at: string | null;
  notes_updated_at: string | null;
  created_at: string;
  updated_at: string;
};

// An appointment that still reads "New" or "Confirmed" after it has been
// and gone never had its outcome recorded. Keeping this as the one
// definition of "has a result" -- rather than a separate result column
// that could disagree with the status shown on the calendar -- is what
// lets the modal badge and the follow-up cron stay in step.
// Won belongs here: it is the strongest possible outcome, so an
// appointment marked Won must not be chased by the follow-up cron for
// never having had its result recorded.
export const RESOLVED_EVENT_STATUSES: EventStatus[] = [
  "Showed",
  "Won",
  "No-show",
  "Cancelled",
];

/**
 * Where a lead lands when an appointment came and went without an outcome.
 * Seeded into every company's pipeline, but an admin can rename it -- if
 * no stage by this name exists, the automation leaves the lead alone
 * rather than inventing somewhere to put it.
 */
export const FOLLOW_UP_STAGE = "Appointment Follow Up";

export function hasAppointmentResult(status: EventStatus): boolean {
  return RESOLVED_EVENT_STATUSES.includes(status);
}

/**
 * The rep turned up and the customer was there.
 *
 * Won means they showed AND sold, so it has to count as a show. Reports
 * that tested `status === "Showed"` would otherwise have dropped a rep's
 * show rate the moment they recorded their best appointments properly --
 * punishing the better data entry, and making Won look like it cost them
 * business.
 */
export function appointmentAttended(status: EventStatus): boolean {
  return status === "Showed" || status === "Won";
}

/** Breathing room after an appointment ends before a missing result is late. */
export const RESULT_GRACE_MINUTES = 60;

/**
 * Whether this appointment is overdue a result. Takes `nowMs` rather than
 * reading the clock so it can be called during render without tripping the
 * purity rule, and so tests can pin the time.
 *
 * An appointment with no time at all is treated as ending at midnight --
 * it's overdue the day after, not the moment the date arrives.
 */
export function appointmentResultOverdue(
  event: Pick<Event, "date" | "time" | "end_time" | "status">,
  nowMs: number,
  graceMinutes: number = RESULT_GRACE_MINUTES
): boolean {
  if (hasAppointmentResult(event.status)) return false;
  const clock = event.end_time || event.time;
  const endsAt = new Date(`${event.date}T${clock ? clock.slice(0, 5) : "23:59"}:00`);
  if (isNaN(endsAt.getTime())) return false;
  return nowMs > endsAt.getTime() + graceMinutes * 60_000;
}

export type EventInput = {
  title: string;
  date: string;
  time: string;
  end_time: string;
  event_type: EventType;
  status: EventStatus;
  assigned_to: string;
  second_assigned_to: string;
  job_id: string;
  notes: string;
  customer_confirmed: boolean;
  rep_confirmed: boolean;
};

export type DocumentType = "Estimate" | "Invoice";
export type DocumentStatus = "Draft" | "Sent" | "Approved" | "Paid";

export type DocumentRecord = {
  id: string;
  type: DocumentType;
  contact_id: string | null;
  job_id: string | null;
  date: string;
  status: DocumentStatus;
  items: { desc: string; qty: number; price: number }[];
  notes: string | null;
  created_at: string;
};

export type ActivityEvent = {
  id: string;
  user_id: string;
  session_id: string;
  path: string;
  kind: "pageview" | "heartbeat";
  created_at: string;
};

// Call dispositions are admin-managed (Settings -> Call Dispositions),
// mirroring Pipeline Stages / Calendars.
export type CallDispositionRow = {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  is_system: boolean;
  created_at: string;
  /** Pipeline stage a lead moves to when a call gets this outcome, or
   *  null for no move. Applied forward-only from early stages. */
  move_to_stage: string | null;
  /** Whether this outcome books a follow-up task for the caller --
   *  a callback nobody is reminded of is a lost lead. */
  creates_followup_task: boolean;
};

export const NO_DISPOSITION = "No Disposition";

export type CallAttemptsFilter = "All" | "Never" | "1x" | "2x" | "3+";
export const CALL_ATTEMPTS_FILTERS: CallAttemptsFilter[] = ["All", "Never", "1x", "2x", "3+"];

export type CallLog = {
  id: string;
  lead_id: string | null;
  rep_id: string | null;
  direction: "outbound" | "inbound";
  from_number: string;
  to_number: string;
  status: string;
  duration_seconds: number;
  disposition: string;
  recording_url: string | null;
  twilio_call_sid: string | null;
  notes: string | null;
  created_at: string;
};

export type DialList = {
  id: string;
  name: string;
  lead_ids: string[];
  created_by: string | null;
  created_at: string;
};

export type SmsMessage = {
  id: string;
  lead_id: string | null;
  direction: "inbound" | "outbound";
  from_number: string;
  to_number: string;
  body: string;
  twilio_sid: string | null;
  created_at: string;
};

// Normalizes to the last 10 digits so numbers stored/typed with
// different formatting (parens, dashes, +1) still match each other.
/**
 * A number in the form Twilio dials: "+1" followed by digits.
 *
 * Contacts are stored however they were typed or imported -- "+1
 * 714-403-5570", "714-403-5570", "1714-403-5570" are all the same
 * person. Anything with a bracket, dash or space in it used to be
 * rejected as an invalid destination, so the call died after two
 * seconds and only bare ten-digit numbers ever connected.
 *
 * Returns "" when there aren't enough digits to be a phone number, so
 * callers can tell "nothing to dial" from "dial this".
 */
export function toE164(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7) return "";
  // An explicit + means the country code is already there.
  if (trimmed.startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export type JobStatus = "Not Started" | "In Progress" | "On Hold" | "Complete";

export const JOB_STATUSES: JobStatus[] = [
  "Not Started",
  "In Progress",
  "On Hold",
  "Complete",
];

export const JOB_COLOR: Record<JobStatus, string> = {
  "Not Started": "#7C8798",
  "In Progress": "#2D5F8A",
  "On Hold": "#C7691B",
  Complete: "#2F855A",
};

export type Job = {
  id: string;
  lead_id: string | null;
  name: string;
  address: string | null;
  status: JobStatus;
  start_date: string | null;
  end_date: string | null;
  assigned_to: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type JobInput = {
  name: string;
  address: string;
  status: JobStatus;
  start_date: string;
  end_date: string;
  assigned_to: string;
  notes: string;
};

export type RefundStatus = "None" | "Requested" | "Received" | "Denied";

export type Lead = {
  id: string;
  contact_type: ContactType;
  // The owning tenant. Distinct from company_name, which is the customer's
  // own business name when the contact is a Company rather than a person.
  company_id: string;
  // When this customer's client-portal access lapses. Null means never
  // granted. Renewable by office staff.
  portal_access_expires_at: string | null;
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  zip: string | null;
  source: string | null;
  project_type: string | null;
  stage: PipelineStage;
  value: number;
  notes: string | null;
  has_appt: boolean;
  second_contact_first_name: string | null;
  second_contact_last_name: string | null;
  second_contact_phone: string | null;
  assigned_to: string | null;
  // The dispatcher who holds this lead until it sells and is paid a
  // percentage of the sale. Separate from assigned_to, which is the rep
  // who runs the appointment -- a lead has both, and they are rarely the
  // same person.
  dispatcher_id: string | null;
  won_at: string | null;
  notes_updated_at: string | null;
  address_type: AddressType;
  lead_cost: number | null;
  refund_status: RefundStatus;
  refund_requested_at: string | null;
  date_received: string;
  created_at: string;
  updated_at: string;
};

// Power Dialer's ADDRESS TYPE filter (verified against the real
// iBuildPro product). Defaults to "Unverified" since we don't run an
// address-verification service; can be set manually.
export type AddressType =
  | "Unverified"
  | "Unknown"
  | "Office (commercial)"
  | "Residence (residential)"
  | "PO Box"
  | "Mailbox (CMRA)";
export const ADDRESS_TYPES: AddressType[] = [
  "Unverified",
  "Unknown",
  "Office (commercial)",
  "Residence (residential)",
  "PO Box",
  "Mailbox (CMRA)",
];

export type LeadInput = {
  contact_type: ContactType;
  company_name: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  address: string;
  zip: string;
  source: string;
  project_type: string;
  stage: PipelineStage;
  value: string;
  lead_cost: string;
  date_received: string;
  notes: string;
  has_appt: boolean;
  second_contact_first_name: string;
  second_contact_last_name: string;
  second_contact_phone: string;
  assigned_to: string;
};

export type SetterContact = {
  id: string;
  setter_id: string;
  lead_id: string;
  created_at: string;
};

export type LeadTask = {
  id: string;
  lead_id: string;
  title: string;
  due_date: string;
  due_time: string | null;
  completed_at: string | null;
  assigned_to: string | null;
  created_at: string;
};

// Timestamped activity/notes timeline for a lead -- additive alongside the
// single leads.notes field (which still drives the stale-notes warning).
// Optionally tagged to the appointment it came from, e.g. an appointment's
// outcome after being marked Showed.
export type LeadNote = {
  id: string;
  lead_id: string;
  author_id: string | null;
  body: string;
  event_id: string | null;
  created_at: string;
};

export type LeadFile = {
  id: string;
  lead_id: string;
  uploaded_by: string | null;
  file_name: string;
  file_path: string;
  file_url: string;
  file_size: number | null;
  content_type: string | null;
  storage_provider: string;
  created_at: string;
};

export type LeadWarnings = {
  noAppts: boolean;
  noNotes: boolean;
  noTasks: boolean;
  staleNotes: boolean;
  overdueTaskDays: number | null;
};

const STALE_NOTES_DAYS = 14;

export function computeLeadWarnings(
  lead: Lead,
  hasAppt: boolean,
  tasks: LeadTask[]
): LeadWarnings {
  const openTasks = tasks.filter((t) => !t.completed_at);
  const overdue = openTasks
    .map((t) => daysSince(t.due_date))
    .filter((d) => d > 0);

  return {
    noAppts: !hasAppt,
    noNotes: !lead.notes || !lead.notes.trim(),
    noTasks: openTasks.length === 0,
    staleNotes:
      !!lead.notes?.trim() &&
      (!lead.notes_updated_at || daysSince(lead.notes_updated_at) > STALE_NOTES_DAYS),
    overdueTaskDays: overdue.length ? Math.max(...overdue) : null,
  };
}

export function hasFollowUpDue(tasks: LeadTask[]) {
  const todayISO = new Date().toISOString().slice(0, 10);
  return tasks.some((t) => !t.completed_at && t.due_date <= todayISO);
}

export function isColdLead(warnings: LeadWarnings) {
  return (
    warnings.noAppts &&
    (warnings.noTasks || warnings.staleNotes || warnings.overdueTaskDays !== null)
  );
}

export function money(n: number | string) {
  return (Number(n) || 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

// ── Estimates ────────────────────────────────────────────────────────

export type EstimateStatus =
  | "Draft"
  | "Sent"
  | "Viewed"
  | "Signed"
  | "Declined"
  | "Expired"
  | "Void";

/**
 * Deletable only while nobody outside the company has seen it.
 *
 * deleteEstimate used to check nothing at all: a Signed contract could be
 * hard-deleted, and portal_payments cascades, so one click took the
 * agreement, the signatures, the schedule and the record that the
 * customer had paid. Anything issued gets voided instead -- the document
 * survives, marked, with a reason.
 */
export function canDeleteEstimateStatus(status: EstimateStatus): boolean {
  return status === "Draft";
}

/** Cancelled documents are still documents. They just stop counting. */
export function isVoid(status: EstimateStatus): boolean {
  return status === "Void";
}

/**
 * Whose name belongs on an estimate as the salesperson.
 *
 * estimates.assigned_to is stamped when the document is created and
 * never moves again. Reassigning the lead therefore left every list and
 * every document naming whoever happened to raise the draft -- often the
 * dispatcher who took the call, not a salesperson at all.
 *
 * Until it is signed, the document follows the lead: the point of naming
 * a rep is saying who the customer will actually meet. Once signed it
 * stops moving, like the terms and the photos -- a contract records who
 * sold the job, and reassigning the lead a year later must not rewrite
 * that.
 *
 * Shared so the office list and the customer's copy answer identically.
 * They did not: the customer's proposal already followed this rule while
 * the estimates list still read the stamped id, so one screen said Simon
 * and the other said josh.c about the same document.
 */
export function effectiveEstimateRepId(input: {
  status: EstimateStatus | string;
  /** Stamped on the document when it was created. */
  estimateAssignedTo: string | null;
  /** Who holds the customer now. */
  leadAssignedTo: string | null | undefined;
}): string | null {
  const frozen = input.status === "Signed" || input.status === "Void";
  return (!frozen && input.leadAssignedTo) || input.estimateAssignedTo || null;
}

// Statuses a customer has already seen. Editing one of these supersedes it
// with a new version rather than rewriting what they were shown.
export const ISSUED_ESTIMATE_STATUSES: EstimateStatus[] = [
  "Sent",
  "Viewed",
  "Signed",
  "Declined",
  "Expired",
];

export function isIssuedEstimate(status: EstimateStatus): boolean {
  return ISSUED_ESTIMATE_STATUSES.includes(status);
}

/**
 * The line past which an estimate stops being editable.
 *
 * Not "has it been sent" -- a customer asking for a change after reading
 * the quote is the normal course of a sale, and forcing a whole new
 * document for a dropped line item is friction with no safety benefit.
 *
 * It is "has anyone committed to it": once a customer has signed, the
 * document is a contract and its terms are what they agreed to. Editing
 * underneath a signature is how a homeowner ends up bound to a price they
 * never saw.
 *
 * The contractor's own signature is deliberately not a lock -- revising
 * your own offer before the customer accepts is allowed.
 */
export function estimateLocked(
  status: EstimateStatus,
  signers: Pick<EstimateSigner, "party" | "signed_at">[]
): boolean {
  // A cancelled document is a record of what was cancelled. Editing one
  // would quietly rewrite history that somebody voided on purpose.
  if (status === "Void") return true;
  if (status === "Signed") return true;
  return signers.some((s) => s.party === "customer" && !!s.signed_at);
}

/**
 * True when editing will pull a live document back from the customer.
 * They are holding a link to what they were sent, so a silent edit would
 * leave them reading one version and signing another.
 */
export function editWillRecallEstimate(status: EstimateStatus): boolean {
  return status === "Sent" || status === "Viewed";
}

/**
 * A section of an estimate: Kitchen, Bathroom, Exterior.
 *
 * Distinct from the "Includes" behaviour, where an unpriced line folds
 * under the priced line above it. Sections sit above that -- a section
 * holds priced lines, and each of those still carries its own detail.
 */
export type EstimateGroup = {
  id: string;
  estimate_id: string;
  name: string;
  description: string | null;
  sort_order: number;
};

export type EstimateSection = {
  group: EstimateGroup | null;
  items: EstimateItem[];
  subtotalCents: number;
};

/**
 * Items arranged into their sections, in section order, with ungrouped
 * lines first.
 *
 * Ungrouped goes first rather than last on purpose: on an estimate that
 * has never used sections every line is ungrouped, and this has to render
 * exactly as it does today.
 */
export function groupEstimateItems(
  items: EstimateItem[],
  groups: EstimateGroup[]
): EstimateSection[] {
  const ordered = [...groups].sort((a, b) => a.sort_order - b.sort_order);
  const sections: EstimateSection[] = [];

  const ungrouped = items.filter((i) => !i.group_id);
  if (ungrouped.length) {
    sections.push({ group: null, items: ungrouped, subtotalCents: sumLines(ungrouped) });
  }
  for (const g of ordered) {
    const mine = items.filter((i) => i.group_id === g.id);
    // Empty sections are kept while editing -- somebody has named one and
    // not filled it yet -- and dropped from the customer's copy by the
    // caller, since a heading over nothing reads as an omission.
    sections.push({ group: g, items: mine, subtotalCents: sumLines(mine) });
  }
  return sections;
}

function sumLines(items: EstimateItem[]): number {
  return items.reduce((sum, i) => sum + (i.line_total_cents || 0), 0);
}

export type EstimateItem = {
  id: string;
  estimate_id: string;
  sort_order: number;
  name: string;
  description: string | null;
  quantity: number;
  unit: string | null;
  unit_price_cents: number;
  line_total_cents: number;
  taxable: boolean;
  cost_cents: number | null;
  /** The section this line sits in. Null renders exactly as before. */
  group_id?: string | null;
};

export type EstimateSigner = {
  id: string;
  estimate_id: string;
  party: "company" | "customer";
  name: string;
  email: string | null;
  phone: string | null;
  sort_order: number;
  signed_at: string | null;
  signature_name: string | null;
  /** A hand-drawn signature, as a base64 PNG data URL. Null for a typed-only signature. */
  signature_image: string | null;
  signature_type: "typed" | "drawn";
};

export type Estimate = {
  id: string;
  company_id: string;
  lead_id: string;
  doc_number: string;
  title: string;
  status: EstimateStatus;
  version: number;
  supersedes_id: string | null;
  assigned_to: string | null;
  issued_at: string | null;
  expires_at: string | null;
  voided_at?: string | null;
  voided_by?: string | null;
  /** Why it was cancelled. Required when voiding: the status alone
   *  cannot answer "why is EST-1021 cancelled" six months later. */
  void_reason?: string | null;
  // Approximate, and nullable: California requires a home improvement
  // contract to state them, but a rep pricing a job on a kitchen counter
  // does not always know yet, and a date guessed to fill a required box
  // reads as a commitment.
  start_date: string | null;
  completion_date: string | null;
  // What sort of document this is. A change order adds to a signed
  // contract that stays exactly as signed -- unlike supersedes_id, which
  // replaces one. A completion certificate carries no money at all.
  // Every pre-existing row is a contract.
  kind: string;
  parent_estimate_id: string | null;
  /** Completion certificates only: the date the work actually finished,
   *  which is when the contract's labour warranty starts running. */
  completed_on?: string | null;
  /** The contractor's list of what is still outstanding, typed in the
   *  office when the certificate is raised. */
  completion_notes?: string | null;
  /** The customer's own list, written by them at the moment they sign.
   *  Kept apart from completion_notes so it stays clear later who said a
   *  thing was outstanding. */
  completion_customer_items?: string | null;
  tax_rate_bp: number;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  // Snapshotted policy, so changing the company's deposit rule next year
  // cannot rewrite the deposit on a contract already signed.
  deposit_percent_bp: number;
  deposit_cap_cents: number;
  deposit_cents: number | null;
  customer_message: string | null;
  terms: string | null;
  notes: string | null;
  sent_at: string | null;
  viewed_at: string | null;
  signed_at: string | null;
  declined_at: string | null;
  declined_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

// Money crosses the wire as integer cents. Formatting to the cent (unlike
// money(), which rounds to whole dollars for pipeline summaries) because a
// document someone signs has to add up exactly.
export function moneyCents(cents: number | null | undefined): string {
  return ((Number(cents) || 0) / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// "$1,250.50", "1250.5", "1,250" -> 125050. Rounds rather than truncates so
// a typed 0.005 does not silently vanish.
export function centsFromInput(raw: string | number | null | undefined): number {
  if (typeof raw === "number") return Math.round(raw * 100);
  const cleaned = String(raw ?? "").replace(/[^0-9.-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === ".") return 0;
  return Math.round(Number(cleaned) * 100) || 0;
}

export function centsToInput(cents: number | null | undefined): string {
  return ((Number(cents) || 0) / 100).toFixed(2);
}

/**
 * Quantity is optional: most line items are lump sums where typing "1"
 * every time is noise.
 *
 * Blank means one, NOT zero. `Number("")` is 0, so an empty box used to
 * multiply the price to nothing -- a rep who cleared the field got a
 * priced line worth $0.00, and the only clue was a total they had no
 * reason to re-read. An explicit 0 is still honoured, since that is a
 * deliberate keystroke.
 */
export function parseQuantity(raw: string | number | null | undefined): number {
  if (raw === null || raw === undefined) return 1;
  const s = String(raw).trim();
  if (s === "") return 1;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return 1;
  return n;
}

/**
 * Whether a line's quantity is worth showing the customer.
 *
 * "1 ls" tells a homeowner nothing -- it is an internal way of saying
 * "this is a lump sum" -- and next to it the Price column just repeats
 * the Amount. "300 sq at $75.00" is the opposite: it is the arithmetic
 * behind the number and they should see it.
 */
export function quantityIsMeaningful(
  quantity: number,
  unit: string | null | undefined
): boolean {
  const u = (unit ?? "").trim().toLowerCase();
  // A real unit of measure always earns its place.
  if (u && u !== "ls") return true;
  // Otherwise only a count other than one says anything.
  return (Number(quantity) || 0) !== 1;
}

export function lineTotalCents(quantity: number, unitPriceCents: number): number {
  return Math.round((Number(quantity) || 0) * (Number(unitPriceCents) || 0));
}

// The single totals calculation, shared by the builder's live preview and
// the server action that saves. Two implementations would eventually
// disagree, and the number the rep saw is the number the customer signs.
export function computeEstimateTotals(
  items: Pick<EstimateItem, "quantity" | "unit_price_cents" | "taxable">[],
  taxRateBp: number
): { subtotalCents: number; taxCents: number; totalCents: number } {
  let subtotalCents = 0;
  let taxableCents = 0;
  for (const item of items) {
    const line = lineTotalCents(item.quantity, item.unit_price_cents);
    subtotalCents += line;
    if (item.taxable) taxableCents += line;
  }
  const taxCents = Math.round((taxableCents * (Number(taxRateBp) || 0)) / 10000);
  return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}

// Margin, for the rep's eyes only. Every one of these is used exclusively
// by the builder -- EstimateDocument (what the customer opens) never
// imports them, and never reads cost_cents at all.
export function lineCostCents(quantity: number, unitCostCents: number | null): number {
  if (unitCostCents === null || unitCostCents === undefined) return 0;
  return Math.round((Number(quantity) || 0) * (Number(unitCostCents) || 0));
}

/**
 * Gross margin as a percentage of the price, not a markup on cost.
 *
 * These get confused constantly and the gap is not small: $1,000 cost
 * sold at $1,500 is a 50% markup but a 33% margin. Contractors quote and
 * lose money on the difference, so this returns the conservative one.
 *
 * Null when there is no revenue to take a percentage of -- 0 would read
 * as "no margin" when the truth is "not known yet".
 */
export function marginPct(revenueCents: number, costCents: number): number | null {
  if (!revenueCents) return null;
  return ((revenueCents - costCents) / revenueCents) * 100;
}

export function formatMarginPct(pct: number | null): string {
  return pct === null ? "—" : `${pct.toFixed(1)}%`;
}

export function estimateMargin(
  items: { quantity: number; unit_price_cents: number; cost_cents: number | null }[]
): { revenueCents: number; costCents: number; profitCents: number; pct: number | null } {
  let revenueCents = 0;
  let costCents = 0;
  for (const item of items) {
    revenueCents += lineTotalCents(item.quantity, item.unit_price_cents);
    costCents += lineCostCents(item.quantity, item.cost_cents);
  }
  return {
    revenueCents,
    costCents,
    profitCents: revenueCents - costCents,
    pct: marginPct(revenueCents, costCents),
  };
}

// ── Deposit and progress payments ────────────────────────────────────

// A saved scope of work, used as a worked example for the AI generator.
// project_type null means "any job".
export type ScopeTemplate = {
  id: string;
  company_id: string;
  name: string;
  project_type: string | null;
  body: string;
  created_at: string;
  updated_at: string;
};

// A payment taken online through the portal. Distinct from
// EstimatePayment, which is a *scheduled* phase -- this is money that
// actually arrived.
export type PortalPayment = {
  id: string;
  estimate_id: string;
  /** Which schedule phase this settles. Null on a deposit. */
  estimate_payment_id?: string | null;
  kind: "deposit" | "progress";
  amount_cents: number;
  status: "pending" | "succeeded" | "failed" | "cancelled";
  method: string | null;
  paid_at: string | null;
  created_at: string;
};

/** Only settled money counts. A pending ACH transfer has not arrived. */
export function paidTotalCents(payments: Pick<PortalPayment, "status" | "amount_cents">[]): number {
  return payments
    .filter((p) => p.status === "succeeded")
    .reduce((sum, p) => sum + (p.amount_cents || 0), 0);
}

export function depositPayment(
  payments: Pick<PortalPayment, "kind" | "status" | "paid_at" | "method" | "amount_cents">[]
) {
  return payments.find((p) => p.kind === "deposit" && p.status === "succeeded") ?? null;
}

export type SignedContract = {
  id: string;
  total_cents: number;
  deposit_cents: number | null;
};

export type CollectionsSummary = {
  /** Settled money, in the bank. */
  collectedCents: number;
  /** Face value of every signed contract. */
  contractValueCents: number;
  /** Signed but not yet collected. Never negative. */
  outstandingCents: number;
  /** ACH still clearing -- promised, not arrived. */
  clearingCents: number;
  /** Signed contracts whose deposit has not landed: the money to chase today. */
  awaitingDepositCount: number;
  awaitingDepositCents: number;
  /** Progress phases billed and not yet paid. */
  billedCents: number;
  /** Billed, unpaid, and past its due date. */
  overdueCents: number;
  overdueCount: number;
};

/**
 * The money view over signed contracts.
 *
 * Only signed estimates count as contract value. A draft or a sent
 * estimate is a proposal; counting it as money owed would inflate the
 * figure with work nobody has agreed to.
 *
 * Overdue counts only phases the contractor actually billed. An unbilled
 * phase cannot be late however old the contract is -- the customer has
 * never been asked for it.
 */
export function collectionsSummary(
  contracts: SignedContract[],
  payments: Pick<
    PortalPayment,
    "estimate_id" | "estimate_payment_id" | "kind" | "status" | "amount_cents"
  >[],
  phases: Pick<EstimatePayment, "id" | "amount_cents" | "requested_at" | "due_date">[] = [],
  today = new Date()
): CollectionsSummary {
  const collectedCents = paidTotalCents(payments);
  const contractValueCents = contracts.reduce((sum, c) => sum + (c.total_cents || 0), 0);

  const clearingCents = payments
    .filter((p) => p.status === "pending")
    .reduce((sum, p) => sum + (p.amount_cents || 0), 0);

  const settledOn = new Set(
    payments.filter((p) => p.status === "succeeded" && p.kind === "deposit").map((p) => p.estimate_id)
  );
  const awaiting = contracts.filter((c) => (c.deposit_cents || 0) > 0 && !settledOn.has(c.id));

  let billedCents = 0;
  let overdueCents = 0;
  let overdueCount = 0;
  for (const phase of phases) {
    const on = payments.filter((p) => p.estimate_payment_id === phase.id);
    const state = phaseState(phase, on, today);
    if (state === "billed" || state === "overdue") billedCents += phase.amount_cents || 0;
    if (state === "overdue") {
      overdueCents += phase.amount_cents || 0;
      overdueCount += 1;
    }
  }

  return {
    collectedCents,
    contractValueCents,
    // Collected can exceed signed value if money landed against an
    // estimate later revised downward; a negative "outstanding" would
    // read as the company owing the customer, which it does not.
    outstandingCents: Math.max(0, contractValueCents - collectedCents),
    clearingCents,
    awaitingDepositCount: awaiting.length,
    awaitingDepositCents: awaiting.reduce((sum, c) => sum + (c.deposit_cents || 0), 0),
    billedCents,
    overdueCents,
    overdueCount,
  };
}

/** An ACH transfer still clearing -- worth showing, but it is not money yet. */
export function pendingPayment(
  payments: Pick<PortalPayment, "status" | "amount_cents" | "method">[]
) {
  return payments.find((p) => p.status === "pending") ?? null;
}

/**
 * How money arrives when it isn't Stripe.
 *
 * Lives here rather than beside the action that writes it: a "use server"
 * file may only export async functions, so a plain array there breaks the
 * whole module at runtime -- and takes every page importing it down with
 * it. Nothing in the type check or the build catches that.
 */
export const MANUAL_PAYMENT_METHODS = ["cash", "check", "zelle", "wire", "other"] as const;
export type ManualPaymentMethod = (typeof MANUAL_PAYMENT_METHODS)[number];

export function paymentMethodLabel(method: string | null): string {
  if (method === "us_bank_account") return "bank transfer";
  if (method === "card") return "card";
  // Money taken by hand. Named the way a contractor would say it, since
  // this reads back on the contract and in the payment history.
  if (method === "cash") return "cash";
  if (method === "check") return "check";
  if (method === "zelle") return "Zelle";
  if (method === "wire") return "wire transfer";
  if (method === "other") return "other";
  return method ?? "";
}

export type EstimatePayment = {
  id: string;
  estimate_id: string;
  sort_order: number;
  name: string;
  description: string | null;
  amount_cents: number;
  /** When the contractor billed this phase. Null means not billed yet. */
  requested_at?: string | null;
  due_date?: string | null;
  /** Set when the document was voided and this phase had not been billed.
   *  Billed phases are left alone -- the request genuinely went out, and
   *  erasing it would leave a later payment with nothing to settle. */
  cancelled_at?: string | null;
};

// ── Job costs ────────────────────────────────────────────────────────

/**
 * Money actually spent on a job.
 *
 * Distinct from estimate_items.cost_cents, which is what somebody
 * guessed a line would cost while quoting it. This is what left the bank.
 */
export type JobExpense = {
  id: string;
  company_id: string;
  lead_id: string;
  /** The phase it is filed against. Null means "on the job, unfiled". */
  estimate_payment_id: string | null;
  /** Free text, only set when no vendor record matched. */
  vendor: string | null;
  vendor_id: string | null;
  category: string | null;
  description: string | null;
  amount_cents: number;
  spent_on: string;
  /** 'manual' or 'quickbooks' -- which rows a sync may overwrite. */
  source: string;
  qb_txn_id: string | null;
  qb_txn_type: string | null;
  qb_project_id: string | null;
  created_at: string;
};

export type JobExpenseInput = {
  leadId: string;
  estimatePaymentId: string | null;
  vendorId: string | null;
  /** Only used when no vendor record matches -- a QuickBooks import
   *  whose supplier is not in the list yet still has to keep the name. */
  vendor: string;
  category: string;
  description: string;
  amountCents: number;
  spentOn: string;
};

// ── Vendors ──────────────────────────────────────────────────────────

/**
 * A supplier or subcontractor, as a record rather than a spelling.
 *
 * No tax ID field, on purpose. EINs and SSNs are needed for 1099s and
 * belong in QuickBooks, which is built to hold them. This carries only
 * whether the W-9 is on file, which answers the question actually asked
 * in January without the CRM ever storing the number.
 */
export type Vendor = {
  id: string;
  company_id: string;
  name: string;
  trade: string | null;
  default_category: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  license_number: string | null;
  insurance_expires_on: string | null;
  w9_on_file: boolean;
  w9_received_on: string | null;
  notes: string | null;
  qb_vendor_id: string | null;
  is_active: boolean;
  created_at: string;
};

export type VendorInsurance = "none" | "expired" | "expiring" | "current";

/**
 * Whether a sub's insurance still covers them.
 *
 * "expiring" is anything inside 30 days: a certificate that lapses next
 * week is a problem you want while there is still time to ask for the
 * new one, not on the day it stops covering you.
 *
 * "none" is not a failure -- a lumber yard has no reason to carry a
 * certificate on your file, and flagging every supplier red would train
 * everyone to ignore the flag that matters.
 */
export function vendorInsuranceState(vendor: Pick<Vendor, "insurance_expires_on">): VendorInsurance {
  if (!vendor.insurance_expires_on) return "none";
  const expires = new Date(vendor.insurance_expires_on + "T00:00:00");
  const now = new Date();
  const days = Math.floor((expires.getTime() - now.getTime()) / 86400000);
  if (days < 0) return "expired";
  if (days <= 30) return "expiring";
  return "current";
}

export function vendorLabel(vendor: Pick<Vendor, "name" | "trade">): string {
  return vendor.trade ? `${vendor.name} · ${vendor.trade}` : vendor.name;
}

export type PhaseProfit = {
  billedCents: number;
  costCents: number;
  profitCents: number;
  /** Null when nothing is billed -- 0% would read as "no margin". */
  pct: number | null;
};

/**
 * Profit on one phase: what it bills, less what was spent against it.
 *
 * Costs only count once they are filed against a phase. An unfiled
 * receipt is deliberately absent rather than spread across phases,
 * because spreading it would move every phase's margin by an amount
 * nobody chose.
 */
export function phaseProfit(billedCents: number, expenses: Pick<JobExpense, "amount_cents">[]): PhaseProfit {
  const costCents = expenses.reduce((sum, e) => sum + (Number(e.amount_cents) || 0), 0);
  return {
    billedCents,
    costCents,
    profitCents: billedCents - costCents,
    pct: marginPct(billedCents, costCents),
  };
}

/** Costs grouped by the phase they are filed against; null key = unfiled. */
export function expensesByPhase(expenses: JobExpense[]): Map<string | null, JobExpense[]> {
  const map = new Map<string | null, JobExpense[]>();
  for (const e of expenses) {
    const key = e.estimate_payment_id ?? null;
    const list = map.get(key) ?? [];
    list.push(e);
    map.set(key, list);
  }
  return map;
}

// ── Projects ─────────────────────────────────────────────────────────

/**
 * A sold job: one signed contract, its change orders, and the money.
 *
 * Not a new record. There is an empty `jobs` table sitting in this
 * schema inviting one, and creating it would put the customer's name and
 * address in two places -- which drift apart the first time somebody
 * corrects one and not the other. A project is a view over a contract
 * and the lead it belongs to.
 */
export type ProjectRollup = {
  /** Contract plus every signed change order. What was actually sold. */
  soldCents: number;
  /** Money received and settled. Pending ACH has not arrived. */
  collectedCents: number;
  /** Billed but not yet collected. */
  receivableCents: number;
  costCents: number;
  /** Collected less spent. The figure that says whether a job is bleeding. */
  netCashCents: number;
  /** Costs on this customer that no phase claims. Excluded from the
   *  figures above when the customer has more than one contract, since
   *  attributing them to either would be a guess. */
  unattributedCostCents: number;
  collectedPct: number | null;
};

export function computeProjectRollup(input: {
  contractTotalCents: number;
  signedChangeOrderCents: number;
  /** Settled payments against the contract and its change orders. */
  payments: Pick<PortalPayment, "status" | "amount_cents">[];
  billedCents: number;
  /** Costs filed to a phase of this contract or its change orders. */
  filedCostCents: number;
  /** Costs on the lead that no phase claims. */
  unfiledCostCents: number;
  /** False when the customer has other signed contracts, in which case
   *  unfiled costs could belong to any of them. */
  ownsUnfiledCosts: boolean;
}): ProjectRollup {
  const soldCents = input.contractTotalCents + input.signedChangeOrderCents;
  const collectedCents = paidTotalCents(input.payments);
  const unattributed = input.ownsUnfiledCosts ? 0 : input.unfiledCostCents;
  const costCents = input.filedCostCents + (input.ownsUnfiledCosts ? input.unfiledCostCents : 0);
  return {
    soldCents,
    collectedCents,
    receivableCents: Math.max(0, input.billedCents - collectedCents),
    costCents,
    netCashCents: collectedCents - costCents,
    unattributedCostCents: unattributed,
    collectedPct: soldCents ? (collectedCents / soldCents) * 100 : null,
  };
}

/**
 * Worst first.
 *
 * A project list sorted by name or date is a filing cabinet. Sorted by
 * money going the wrong way, it is the thing you open in the morning:
 * jobs underwater, then jobs owed the most, then everything else by size.
 */
export function projectTriageOrder(a: ProjectRollup, b: ProjectRollup): number {
  const aBleeding = a.netCashCents < 0;
  const bBleeding = b.netCashCents < 0;
  if (aBleeding !== bBleeding) return aBleeding ? -1 : 1;
  if (aBleeding && bBleeding) return a.netCashCents - b.netCashCents;
  if (a.receivableCents !== b.receivableCents) return b.receivableCents - a.receivableCents;
  return b.soldCents - a.soldCents;
}

// ── Photos on documents ──────────────────────────────────────────────

/** A job photo, as offered in the picker. */
export type LeadPhoto = {
  id: string;
  file_name: string;
  file_url: string;
  content_type: string | null;
  created_at: string;
};

/**
 * Whether an attachment can be drawn, or only linked to.
 *
 * A PDF in an <img> renders as a broken image, and on the customer's
 * copy of a proposal that is worse than not attaching it. Everything
 * that is not a picture is shown as a named link instead.
 *
 * Falls back to the file extension because content_type is whatever the
 * browser claimed at upload, and some send application/octet-stream for
 * a perfectly ordinary PDF.
 */
export function attachmentIsImage(
  contentType: string | null | undefined,
  fileName?: string | null
): boolean {
  if (contentType && /^image\//i.test(contentType)) return true;
  if (contentType && /^application\/pdf$/i.test(contentType)) return false;
  return /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(fileName ?? "");
}

/**
 * A photo attached to an estimate, contract or change order.
 *
 * The file stays owned by the lead -- this is a link, not a copy, so one
 * photograph has one caption and one place to correct it.
 */
export type EstimatePhoto = {
  id: string;
  estimate_id: string;
  /** The line it justifies. Null means it belongs to the document. */
  estimate_item_id: string | null;
  lead_file_id: string;
  caption: string | null;
  sort_order: number;
  file_name: string;
  file_url: string;
  content_type: string | null;
};

/** Photos grouped by the line they sit under; null key = document-level. */
export function photosByItem(photos: EstimatePhoto[]): Map<string | null, EstimatePhoto[]> {
  const map = new Map<string | null, EstimatePhoto[]>();
  for (const p of photos) {
    const key = p.estimate_item_id ?? null;
    const list = map.get(key) ?? [];
    list.push(p);
    map.set(key, list);
  }
  return map;
}

/**
 * Sets one phase and lets the others absorb the difference.
 *
 * The deposit is deliberately not a party to this. It is computed from
 * the company's percentage and held under California's $1,000 home
 * improvement cap, so `balanceCents` is what is left after it and the
 * phases divide only that.
 *
 * The others move in proportion to what they were, so a schedule of
 * 30/30/20/10 keeps its shape when one phase changes rather than
 * flattening into equal parts.
 *
 * `baseOthers` is a snapshot taken when editing began, not the current
 * amounts. Recomputing from live values on every keystroke would feed
 * each result into the next: typing "3" then "0" would redistribute
 * twice, from already-redistributed figures, and the original ratios
 * would be gone by the second digit.
 */
export function redistributePhases(input: {
  balanceCents: number;
  targetKey: string;
  targetCents: number;
  /** Amounts as they were when editing started, excluding the target. */
  baseOthers: { key: string; amountCents: number }[];
}): Map<string, number> {
  const out = new Map<string, number>();
  // Never negative: a phase cannot bill less than nothing, so an entry
  // larger than the whole balance leaves the others at zero and the
  // difference is reported rather than hidden in a negative line.
  const remaining = Math.max(0, input.balanceCents - input.targetCents);
  const baseTotal = input.baseOthers.reduce((s, o) => s + o.amountCents, 0);

  if (input.baseOthers.length === 0) return out;

  if (baseTotal <= 0) {
    // Nothing to be proportional to -- an even split is the only
    // defensible reading of "share what is left".
    const each = splitEvenlyCents(remaining, input.baseOthers.length);
    input.baseOthers.forEach((o, i) => out.set(o.key, each[i] ?? 0));
    return out;
  }

  let assigned = 0;
  input.baseOthers.forEach((o, i) => {
    const isLast = i === input.baseOthers.length - 1;
    // The last one takes the rounding remainder, so the schedule lands
    // exactly on the balance instead of a cent short.
    const cents = isLast
      ? remaining - assigned
      : Math.round((remaining * o.amountCents) / baseTotal);
    out.set(o.key, Math.max(0, cents));
    assigned += cents;
  });
  return out;
}

export type PhaseState = "unbilled" | "billed" | "overdue" | "clearing" | "paid";

/**
 * Where a single progress phase stands.
 *
 * Paid beats everything: money that has landed is not overdue no matter
 * what the due date said. Clearing (an ACH transfer in flight) is
 * likewise not overdue -- the customer has done their part and chasing
 * them for it would be wrong.
 */
export function phaseState(
  phase: Pick<EstimatePayment, "requested_at" | "due_date">,
  payments: Pick<PortalPayment, "status">[],
  today = new Date()
): PhaseState {
  if (payments.some((p) => p.status === "succeeded")) return "paid";
  if (payments.some((p) => p.status === "pending")) return "clearing";
  if (!phase.requested_at) return "unbilled";
  if (phase.due_date) {
    // Date-only comparison: a payment due today is not late today.
    const due = new Date(`${phase.due_date}T23:59:59`);
    if (today > due) return "overdue";
  }
  return "billed";
}

export function phaseStateLabel(state: PhaseState): string {
  if (state === "paid") return "Paid";
  if (state === "clearing") return "Clearing";
  if (state === "overdue") return "Overdue";
  if (state === "billed") return "Billed";
  return "Not billed";
}

/** Default terms on a progress payment: net 7 from the day it is billed. */
export const PROGRESS_PAYMENT_NET_DAYS = 7;

export function defaultDueDate(from = new Date(), netDays = PROGRESS_PAYMENT_NET_DAYS): string {
  const d = new Date(from);
  d.setDate(d.getDate() + netDays);
  return d.toISOString().slice(0, 10);
}

export const DEFAULT_DEPOSIT_PERCENT_BP = 1000; // 10.00%
export const DEFAULT_DEPOSIT_CAP_CENTS = 100000; // $1,000

/**
 * "10% or up to $1,000" means whichever is LESS, not whichever the rep
 * prefers. On a $28,500 job 10% is $2,850, so the deposit is $1,000; on a
 * $5,000 job 10% is $500, so the deposit is $500.
 *
 * This is California's limit for home improvement contracts (CSLB, B&P
 * 7159) -- a down payment may not exceed $1,000 or 10% of the contract
 * price, whichever is less. Enforced as a ceiling rather than a default
 * so a large job cannot quietly collect an illegal deposit.
 */
export function depositCents(
  totalCents: number,
  percentBp: number = DEFAULT_DEPOSIT_PERCENT_BP,
  capCents: number = DEFAULT_DEPOSIT_CAP_CENTS
): number {
  if (!totalCents || totalCents <= 0) return 0;
  const byPercent = Math.round((totalCents * (Number(percentBp) || 0)) / 10000);
  if (!capCents || capCents <= 0) return Math.min(byPercent, totalCents);
  return Math.min(byPercent, capCents, totalCents);
}

/** What the progress phases have to add up to. */
export function balanceAfterDepositCents(totalCents: number, deposit: number): number {
  return Math.max(0, (totalCents || 0) - (deposit || 0));
}

/**
 * Percent is always of the estimate total, matching how the reference
 * product reports it -- a $4,722.45 phase on a $28,500 job reads 16.57%,
 * not 17.17% of the post-deposit balance. Percentages of two different
 * bases on one page is how a customer ends up querying the invoice.
 */
export function paymentPercentOfTotal(amountCents: number, totalCents: number): number | null {
  if (!totalCents) return null;
  return ((amountCents || 0) / totalCents) * 100;
}

export function paymentsTotalCents(payments: Pick<EstimatePayment, "amount_cents">[]): number {
  return payments.reduce((sum, p) => sum + (p.amount_cents || 0), 0);
}

/**
 * Deposit + phases must equal the estimate exactly. Anything left over is
 * money nobody has agreed when to pay, so it is surfaced rather than
 * quietly absorbed into the last phase.
 */
export function scheduleBalance(
  totalCents: number,
  depositAmountCents: number,
  payments: Pick<EstimatePayment, "amount_cents">[]
): { phasesCents: number; scheduledCents: number; differenceCents: number; balanced: boolean } {
  const phasesCents = paymentsTotalCents(payments);
  const scheduledCents = phasesCents + (depositAmountCents || 0);
  const differenceCents = (totalCents || 0) - scheduledCents;
  return { phasesCents, scheduledCents, differenceCents, balanced: differenceCents === 0 };
}

/**
 * Splits a balance across n phases in whole cents, giving any remainder
 * to the earliest phases. Three phases of $100.00 must come to $100.00,
 * not $99.99 -- an even split that loses a cent leaves the schedule
 * permanently unbalanced and the rep hunting for it.
 */
export function splitEvenlyCents(balanceCents: number, phases: number): number[] {
  if (phases <= 0 || balanceCents <= 0) return [];
  const base = Math.floor(balanceCents / phases);
  const remainder = balanceCents - base * phases;
  return Array.from({ length: phases }, (_, i) => base + (i < remainder ? 1 : 0));
}

// The phases a remodel actually bills at, in order. Used to seed a
// schedule so the rep edits names rather than inventing them.
export const DEFAULT_PAYMENT_PHASES: { name: string; description: string }[] = [
  { name: "Materials delivered", description: "Payment due when materials are delivered to the job site." },
  { name: "At completion of demolition & framing", description: "Payment due upon completion of demolition and framing." },
  { name: "At completion of rough-in", description: "Payment due upon completion of rough-in plumbing and electrical." },
  { name: "At completion of finishes", description: "Payment due upon completion of finish work." },
  { name: "Final walkthrough & punch list", description: "Final payment due upon completion of the punch list." },
];

export function estimateExpired(e: Pick<Estimate, "expires_at" | "status">, now = new Date()): boolean {
  if (e.status === "Signed" || e.status === "Declined") return false;
  if (!e.expires_at) return false;
  return new Date(`${e.expires_at}T23:59:59`).getTime() < now.getTime();
}

// "1 of 2 signed" -- a document is only a contract once every signer has
// signed, and the pending names are what the rep needs to chase.
export function signatureProgress(signers: Pick<EstimateSigner, "signed_at" | "name">[]): {
  signed: number;
  total: number;
  complete: boolean;
  pending: string[];
} {
  const signed = signers.filter((s) => !!s.signed_at).length;
  return {
    signed,
    total: signers.length,
    complete: signers.length > 0 && signed === signers.length,
    pending: signers.filter((s) => !s.signed_at).map((s) => s.name),
  };
}

export function daysSince(dateStr: string | null) {
  if (!dateStr) return 0;
  // A bare "YYYY-MM-DD" parses as UTC midnight, which anywhere west of
  // UTC makes a lead received this afternoon look a day old. Pin it to
  // local midnight so the count matches the calendar the user is reading.
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? `${dateStr}T00:00:00` : dateStr);
  if (isNaN(d.getTime())) return 0;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

/**
 * A received date short enough for a pipeline card: "Jul 29", but
 * "Jul 29 '25" once it isn't this year.
 *
 * The year is not decoration. Leads imported from a spreadsheet keep the
 * date they actually came in, and some of those are over a year old --
 * a bare "Jul 29" on one of those reads as a lead that arrived last week.
 */
export function shortReceivedDate(dateStr: string | null, now: Date = new Date()): string {
  if (!dateStr) return "";
  const d = new Date(`${dateStr.slice(0, 10)}T00:00:00`);
  if (isNaN(d.getTime())) return "";
  const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (d.getFullYear() === now.getFullYear()) return label;
  return `${label} '${String(d.getFullYear()).slice(-2)}`;
}

export function mapsUrl(address: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

export function leadDisplayName(l: {
  contact_type: ContactType;
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
}) {
  if (l.contact_type === "Company") {
    return l.company_name || "Unnamed Company";
  }
  return `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim() || "Unnamed";
}

/**
 * How a hand-typed crew message reads on the rep's phone.
 *
 * Lives here rather than beside the action that sends it because the
 * compose box shows the same string back to the sender, and a preview
 * built by different code from the message itself is a preview that can
 * quietly stop being true.
 *
 * ("use server" files may only export async functions, so a plain helper
 * could not live there anyway -- that one takes the whole module down at
 * runtime while every local check still passes.)
 */
/**
 * The estimate fields an appointment needs to list what a lead has been
 * quoted. Narrower than the full row on purpose: the calendar loads these
 * for every lead in the company, and it only ever shows a line per one.
 */
export type EstimateKind = "contract" | "change_order" | "completion";

/**
 * Whether a document's total is money the business has sold.
 *
 * Stated once because it is asked in several places -- the funnel, the
 * dispatcher's commission base, the lead's value -- and each of those got
 * it wrong in turn when change orders arrived. A completion certificate
 * carries no money at all; a change order carries money that belongs to
 * its parent contract, not to a job of its own.
 *
 * Anything added later is excluded until somebody decides otherwise,
 * which is the safe direction: a new kind quietly counted as revenue is
 * how a total starts lying.
 */
export function isSellableKind(kind: string | null | undefined): boolean {
  return (kind ?? "contract") === "contract";
}

/** Documents that carry no price at all, so no totals are shown. */
export function isPricelessKind(kind: string | null | undefined): boolean {
  return kind === "completion";
}

export type LinkedEstimate = Pick<
  Estimate,
  "id" | "lead_id" | "doc_number" | "title" | "status" | "total_cents" | "issued_at" | "created_at"
>;

export function repMessagePreview(jobLabel: string, body: string) {
  return `Re: ${jobLabel}\n${body.trim()}`;
}

/**
 * What one contract may claim of a job's costs.
 *
 * Costs hang off the lead, but a customer can hold several signed
 * contracts -- one here holds five. Summing the lead's costs against each
 * of them counts the same money over and over, which on the commission
 * report is somebody's pay.
 *
 * So a cost belongs to a contract when a phase of that contract claims
 * it. A cost nobody has filed belongs to the customer rather than to any
 * one document, and is only attributed when there is exactly one contract
 * it could possibly mean.
 *
 * Shared with the projects list rather than written twice: the two must
 * agree about what a job cost, or the same job reports two profits.
 */
export function costsForContract(input: {
  leadExpenses: { amount_cents: number; estimate_payment_id: string | null }[];
  /** Phase ids belonging to this contract and its change orders. */
  contractPhaseIds: Set<string>;
  /** Every phase id on the job, to tell "filed elsewhere" from "unfiled". */
  allPhaseIds: Set<string>;
  leadHasOneContract: boolean;
}): { cents: number; counted: number } {
  let cents = 0;
  let counted = 0;
  for (const e of input.leadExpenses) {
    const filedHere = e.estimate_payment_id && input.contractPhaseIds.has(e.estimate_payment_id);
    const unfiled = !e.estimate_payment_id || !input.allPhaseIds.has(e.estimate_payment_id);
    if (filedHere || (unfiled && input.leadHasOneContract)) {
      cents += e.amount_cents;
      counted += 1;
    }
  }
  return { cents, counted };
}

// ── Sales rep commission ─────────────────────────────────────────────

export type RepCommission = {
  contractCents: number;
  leadCostCents: number;
  expensesCents: number;
  netProfitCents: number;
  /** The whole pot before it is split between the reps. */
  poolCents: number;
  rep1Cents: number;
  rep2Cents: number;
  /**
   * True when no cost has been recorded against the job at all.
   *
   * Not the same as costs of zero. With nothing entered, net profit
   * equals the whole contract and the commission looks enormous -- on an
   * $80,000 job with no costs the pot reads $34,000 rather than the few
   * thousand it will actually be. Callers show "pending" rather than a
   * figure, the same way the projects list refuses to colour net cash
   * green on a job that is unmeasured rather than profitable.
   */
  unmeasured: boolean;
};

/**
 * What the reps earn on one contract.
 *
 * Lead cost first, then the job's actual costs, then the reps take their
 * share of what is left -- so a rep who discounts to close, or who lets
 * the job run over, earns less. Both percentages are stamped on the
 * contract rather than read from settings at report time: a contract
 * signed at 50% must still pay 50% after the company moves to 40%, or
 * changing the setting would silently restate what everybody has already
 * been paid.
 */
export function computeRepCommission(input: {
  contractCents: number;
  /** Basis points of the contract. 1500 = 15%. */
  leadCostBp: number;
  /** Basis points of net profit paid to the reps together. 5000 = 50%. */
  commissionRateBp: number;
  /** Actual money spent on the job, and whether any was recorded. */
  expensesCents: number;
  hasCosts: boolean;
  /** How the pot divides. 6000/4000 is a 60/40 split. */
  rep1Bp: number;
  rep2Bp: number;
}): RepCommission {
  const leadCostCents = Math.round((input.contractCents * input.leadCostBp) / 10000);
  const netProfitCents = input.contractCents - leadCostCents - input.expensesCents;
  // Never negative: a job that lost money owes the rep nothing, but it
  // does not owe the company a refund out of this calculation either.
  const poolCents = Math.max(0, Math.round((netProfitCents * input.commissionRateBp) / 10000));

  const rep1Cents = Math.round((poolCents * input.rep1Bp) / 10000);
  // The remainder, so the two shares always add up to the pot exactly
  // rather than losing a cent to rounding on a 1/3 split.
  const rep2Cents = input.rep2Bp > 0 ? poolCents - rep1Cents : 0;

  return {
    contractCents: input.contractCents,
    leadCostCents,
    expensesCents: input.expensesCents,
    netProfitCents,
    poolCents,
    rep1Cents,
    rep2Cents,
    unmeasured: !input.hasCosts,
  };
}

/**
 * What still stands between an earned commission and a payable one.
 *
 * Commission is paid when the job is finished and settled: paid in full,
 * and the customer has signed the completion certificate. Both, not
 * either -- money without a signed certificate means the job may still
 * come back, and a signed certificate without the money means the
 * company would be paying commission out of its own pocket.
 *
 * Held back is not the same as not earned. The rep is owed it; the
 * clock has not started. Every screen that shows a nil payable also
 * shows this list, because "you are owed nothing" and "you are owed
 * $3,000 once they pay the last invoice" are different sentences and a
 * rep who cannot tell them apart has no idea what to chase.
 */
export type CommissionHold = "costs" | "payment" | "certificate";

export function commissionHolds(input: {
  hasCosts: boolean;
  collectedCents: number;
  contractCents: number;
  certificateSigned: boolean;
}): CommissionHold[] {
  const holds: CommissionHold[] = [];
  if (!input.hasCosts) holds.push("costs");
  // Paid in full, not mostly paid. A retention still held, or the last
  // change order unbilled, is exactly the case this rule exists for.
  if (input.collectedCents < input.contractCents) holds.push("payment");
  if (!input.certificateSigned) holds.push("certificate");
  return holds;
}

export const COMMISSION_HOLD_LABEL: Record<CommissionHold, string> = {
  costs: "Job costs not recorded yet",
  payment: "Final payment outstanding",
  certificate: "Completion certificate not signed",
};

/**
 * The date a commission became payable: the later of the last payment
 * landing and the certificate being signed.
 *
 * Which pay period a commission falls into is decided by whichever gate
 * cleared last, not by when the job was sold. A job signed in March,
 * paid off in June and signed off in July is July's payroll.
 */
export function commissionQualifiedAt(input: {
  holds: CommissionHold[];
  lastPaymentAt: string | null;
  certificateSignedAt: string | null;
}): string | null {
  if (input.holds.length > 0) return null;
  const dates = [input.lastPaymentAt, input.certificateSignedAt].filter(
    (d): d is string => !!d
  );
  if (dates.length === 0) return null;
  return dates.sort()[dates.length - 1];
}

export type CommissionInputs = {
  signed: { id: string; lead_id: string; total_cents: number }[];
  dispatcherByLead: Map<string, string>;
  collectedByEstimate: Map<string, number>;
  commissionBp: number;
};

export type DispatcherCommission = {
  dispatcherId: string;
  jobsSold: number;
  contractCents: number;
  collectedCents: number;
  /** Earned on what sold. */
  commissionCents: number;
  /** The share of that backed by money actually in the bank. */
  earnedOnCollectedCents: number;
};

/**
 * What each dispatcher has earned on the jobs they brought in.
 *
 * Two figures, deliberately. Commission is earned when the job sells,
 * but paying 1% of a $50,000 contract that has taken $500 so far is a
 * cash-flow trap -- so the collected-backed figure sits beside it and
 * the contractor chooses which one they pay against.
 *
 * Pure so it can be tested without a session: the action that calls it
 * needs a signed-in user, which is exactly what makes the maths hard to
 * check otherwise.
 */
export function computeDispatcherCommissions({
  signed,
  dispatcherByLead,
  collectedByEstimate,
  commissionBp,
}: CommissionInputs): DispatcherCommission[] {
  const byDispatcher = new Map<string, DispatcherCommission>();

  for (const estimate of signed) {
    const who = dispatcherByLead.get(estimate.lead_id);
    // No dispatcher on the lead means nobody is owed anything for it.
    if (!who) continue;

    const row =
      byDispatcher.get(who) ??
      {
        dispatcherId: who,
        jobsSold: 0,
        contractCents: 0,
        collectedCents: 0,
        commissionCents: 0,
        earnedOnCollectedCents: 0,
      };

    // Overpayment happens (a rounded-up cheque, a tip). It must not pay
    // commission on more than the job is worth.
    const collected = Math.min(collectedByEstimate.get(estimate.id) ?? 0, estimate.total_cents);
    row.jobsSold += 1;
    row.contractCents += estimate.total_cents;
    row.collectedCents += collected;
    row.commissionCents += Math.round((estimate.total_cents * commissionBp) / 10000);
    row.earnedOnCollectedCents += Math.round((collected * commissionBp) / 10000);
    byDispatcher.set(who, row);
  }

  return [...byDispatcher.values()].sort((a, b) => b.commissionCents - a.commissionCents);
}

/**
 * Whether this person only gets their own leads.
 *
 * The app-side twin of is_dispatch_scoped in the database (0069): a
 * dispatcher is narrowed to their own book, and holding Office or Admin
 * alongside lifts the narrowing entirely. Other roles are unaffected.
 */
export function isDispatchScoped(
  profile: (Pick<Profile, "roles"> & { is_dispatch_supervisor?: boolean }) | null
) {
  if (!profile) return false;
  if (profile.roles.includes("Office") || profile.roles.includes("Admin")) return false;
  // A supervisor runs the desk, so the whole book is their business.
  if (profile.is_dispatch_supervisor) return false;
  return profile.roles.includes("Dispatch");
}

/**
 * Who may enter a brand-new lead.
 *
 * Narrower than canEditDispatch on purpose: a plain dispatcher works the
 * leads that arrive but does not add to the book -- the database has
 * refused their inserts all along while the UI showed them the button.
 * The supervisor flag is what grants entry to a dispatcher.
 */
export function canCreateLeads(
  profile: (Pick<Profile, "roles"> & { is_dispatch_supervisor?: boolean }) | null
) {
  if (!profile) return false;
  return (
    profile.roles.includes("Office") ||
    profile.roles.includes("Admin") ||
    profile.roles.includes("Sales") ||
    (profile.roles.includes("Dispatch") && profile.is_dispatch_supervisor === true)
  );
}

/**
 * Whether an appointment belongs to somebody else's book.
 *
 * The mirror of migration 0090's policy: an appointment is workable when
 * its lead is unclaimed or held by you, and one with no lead has no
 * holder to defer to.
 *
 * Takes the holder rather than reading it from a lead, because the
 * client cannot look it up. leads_select narrows a dispatcher to their
 * own leads and the unclaimed pool, so the lead they are being kept out
 * of is precisely the one absent from their data -- the holder has to be
 * resolved server-side and handed down.
 */
export function appointmentLockedForViewer(input: {
  /** leads.dispatcher_id for the appointment's lead, resolved server-side. */
  holderId: string | null | undefined;
  // Both accept undefined, which is what an omitted prop looks like.
  // Unknown scoping means "not scoped", and an unknown viewer is not the
  // holder -- so the omission locks rather than unlocks.
  viewerId: string | null | undefined;
  viewerIsDispatchScoped: boolean | undefined;
}): boolean {
  if (!input.viewerIsDispatchScoped) return false;
  if (!input.holderId) return false;
  return input.holderId !== input.viewerId;
}

/**
 * Stages where a lead is still being chased for its first appointment.
 *
 * Shared by everything that advances a lead automatically -- booking an
 * appointment, a dialer disposition -- so they agree on where automation
 * is allowed to act. Past these, the lead is in a rep's hands and a
 * missed phone call must not drag it backwards.
 */
export const PRE_APPOINTMENT_STAGES: PipelineStage[] = [
  "Unsorted",
  "New Lead",
  "Meta",
  "No Answer",
  "Contacted",
];

/**
 * Where a dialer outcome moves the lead, or null for nowhere.
 *
 * Forward-only, early-stages-only: a customer at "Proposal Sent" who
 * misses one call must not fall back to "No Answer", so only leads
 * still in the pre-appointment stages move at all. The target must
 * exist in this company's pipeline -- a mapping pointing at a deleted
 * stage skips rather than writes a stage no board can show.
 */
export function dispositionStageMove(input: {
  currentStage: string;
  moveToStage: string | null | undefined;
  companyStages: string[];
}): string | null {
  if (!input.moveToStage) return null;
  if (!PRE_APPOINTMENT_STAGES.includes(input.currentStage)) return null;
  if (!input.companyStages.includes(input.moveToStage)) return null;
  if (input.moveToStage === input.currentStage) return null;
  return input.moveToStage;
}

/**
 * Where a lead stands after a signed contract is voided.
 *
 * The mirror of what signing does. Signing writes the contract total
 * onto the lead and advances it to Won; voiding used to touch only the
 * document, so a cancelled $45,000 test contract left a lead sitting on
 * the board as Won $45,000 indefinitely.
 *
 * If other signed contracts remain, the lead is still won -- for their
 * money, with value taken from the most recently signed. If nothing
 * signed remains, it is not won by anyone's definition, and it returns
 * to Proposal Sent: the paperwork exists, nobody has committed to it.
 */
export function leadAfterContractVoid(
  remainingSigned: { total_cents: number; signed_at: string | null }[]
): { demote: boolean; valueDollars: number | null } {
  if (remainingSigned.length === 0) return { demote: true, valueDollars: null };
  const latest = [...remainingSigned].sort((a, b) =>
    (b.signed_at ?? "").localeCompare(a.signed_at ?? "")
  )[0];
  return { demote: false, valueDollars: latest.total_cents / 100 };
}
