export type ContactType = "Individual" | "Company";

export type AppRole = "Office" | "Field" | "Admin" | "Sales";
export const APP_ROLES: AppRole[] = ["Office", "Field", "Admin", "Sales"];

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

// Dispatch section (Pipeline, Contacts, Appt. Setter Assignments): Office
// or Sales can create/edit; delete on leads is a separate, narrower check.
export function canEditDispatch(profile: Pick<Profile, "roles"> | null) {
  if (!profile) return false;
  return profile.roles.includes("Office") || profile.roles.includes("Sales");
}

export function canDeleteLeads(profile: Pick<Profile, "roles" | "can_delete_leads"> | null) {
  if (!profile) return false;
  if (profile.roles.includes("Office")) return true;
  return profile.roles.includes("Sales") && profile.can_delete_leads;
}

export type CompanyProfile = {
  id: number;
  name: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  license_holder_name: string | null;
  license_number: string | null;
  license_state: string | null;
  license_type: string | null;
  timezone: string;
  logo_url: string | null;
};

// Stages are admin-managed (Settings -> Pipeline Stages), not a fixed
// set, so this is just a plain string matching a pipeline_stages.name.
export type PipelineStage = string;

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

export type EventType = "Estimate" | "Job Visit" | "Meeting" | "Other";
export const EVENT_TYPES: EventType[] = ["Estimate", "Job Visit", "Meeting", "Other"];

export type Event = {
  id: string;
  title: string | null;
  date: string;
  time: string | null;
  event_type: EventType;
  assigned_to: string | null;
  job_id: string | null;
  lead_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type EventInput = {
  title: string;
  date: string;
  time: string;
  event_type: EventType;
  assigned_to: string;
  job_id: string;
  notes: string;
};

export type ActivityEvent = {
  id: string;
  user_id: string;
  session_id: string;
  path: string;
  kind: "pageview" | "heartbeat";
  created_at: string;
};

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

export type Lead = {
  id: string;
  contact_type: ContactType;
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
  created_at: string;
  updated_at: string;
};

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
  completed_at: string | null;
  assigned_to: string | null;
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
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return 0;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
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
