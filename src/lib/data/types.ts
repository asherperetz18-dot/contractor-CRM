export type ContactType = "Individual" | "Company";

export type AppRole = "Office" | "Field" | "Admin" | "Sales" | "Call Center";
export const APP_ROLES: AppRole[] = ["Office", "Field", "Admin", "Sales", "Call Center"];

export type UserStatus = "Active" | "Archived";

export type Profile = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  roles: AppRole[];
  status: UserStatus;
  can_delete_leads: boolean;
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
export function isStrictAdmin(profile: Pick<Profile, "roles"> | null) {
  if (!profile) return false;
  return profile.roles.includes("Admin");
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
    profile.roles.includes("Sales")
  );
}

export function canDeleteLeads(profile: Pick<Profile, "roles" | "can_delete_leads"> | null) {
  if (!profile) return false;
  if (profile.roles.includes("Office") || profile.roles.includes("Admin")) return true;
  return profile.roles.includes("Sales") && profile.can_delete_leads;
}

// Calendar, Schedule and Production: who can book, edit, drag and
// complete work. Field crews need this alongside Office; Admin is the
// full-access role. These pages each used to inline "Office || Field",
// which silently left Admins unable to touch the calendar at all.
export function canEditSchedule(profile: Pick<Profile, "roles"> | null) {
  if (!profile) return false;
  return (
    profile.roles.includes("Office") ||
    profile.roles.includes("Admin") ||
    profile.roles.includes("Field")
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
  | "production"
  | "documents"
  | "calendar"
  | "schedule"
  | "contracts";

export const PAGE_REGISTRY: { key: PageKey; label: string; href: string; group: string }[] = [
  { key: "dashboard", label: "Dashboard", href: "/", group: "General" },
  { key: "pipeline", label: "Leads Pipeline", href: "/pipeline", group: "Dispatch (Leads Mgmt.)" },
  { key: "reply-inbox", label: "Reply Inbox", href: "/reply-inbox", group: "Dispatch (Leads Mgmt.)" },
  {
    key: "marketing-analytics",
    label: "Marketing Analytics",
    href: "/marketing-analytics",
    group: "Dispatch (Leads Mgmt.)",
  },
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
  { key: "production", label: "Production", href: "/production", group: "General" },
  { key: "documents", label: "Estimates & Invoices", href: "/documents", group: "General" },
  { key: "calendar", label: "Calendar", href: "/calendar", group: "General" },
  { key: "schedule", label: "Schedule", href: "/schedule", group: "General" },
  { key: "contracts", label: "Contracts", href: "/contracts", group: "General" },
];

// Roles that can be individually restricted via Role Visibility. Office and
// Admin are excluded from the matrix because they always have full access.
export const VISIBILITY_MANAGED_ROLES: AppRole[] = ["Field", "Sales", "Call Center"];

// Platform default when no explicit override row exists for a role/page --
// "untouched cells follow the default," same wording as the real product.
// Every role defaults to full access except the Call Center role, which
// defaults to just Dashboard + Power Dialer + Call/Text Reports.
export function defaultPageVisible(role: AppRole, pageKey: PageKey): boolean {
  if (role === "Call Center") {
    return (
      pageKey === "dashboard" ||
      pageKey === "power-dialer" ||
      pageKey === "call-reports" ||
      pageKey === "text-reports"
    );
  }
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
  if (profile.roles.includes("Office") || profile.roles.includes("Admin")) return true;
  if (profile.roles.length === 0) return defaultPageVisible("Field", pageKey);
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
  address: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
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

export type EventStatus = "New" | "Confirmed" | "Showed" | "No-show" | "Cancelled";
export const EVENT_STATUSES: EventStatus[] = [
  "New",
  "Confirmed",
  "Showed",
  "No-show",
  "Cancelled",
];
export const EVENT_STATUS_COLOR: Record<EventStatus, string> = {
  New: "#7C8798",
  Confirmed: "#2F855A",
  Showed: "#2D5F8A",
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
export const RESOLVED_EVENT_STATUSES: EventStatus[] = ["Showed", "No-show", "Cancelled"];

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
