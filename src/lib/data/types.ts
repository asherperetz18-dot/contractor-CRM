export type ContactType = "Individual" | "Company";

export type AppRole = "Office" | "Field";
export const APP_ROLES: AppRole[] = ["Office", "Field"];

export type UserStatus = "Active" | "Archived";

export type Profile = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  roles: AppRole[];
  status: UserStatus;
  created_at: string;
};

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

export type PipelineStage =
  | "New Leads"
  | "Contacted"
  | "Estimate Scheduled"
  | "Estimate Sent"
  | "Negotiating"
  | "Won"
  | "Lost";

export const LEAD_STAGES: PipelineStage[] = [
  "New Leads",
  "Contacted",
  "Estimate Scheduled",
  "Estimate Sent",
  "Negotiating",
  "Won",
  "Lost",
];

export const STAGE_COLOR: Record<string, string> = {
  "New Leads": "#7C8798",
  Contacted: "#2D5F8A",
  "Estimate Scheduled": "#C7691B",
  "Estimate Sent": "#C7691B",
  Negotiating: "#B7862B",
  Won: "#2F855A",
  Lost: "#C0392B",
  Other: "#9A9384",
};

export type EventType = "Estimate" | "Job Visit" | "Meeting" | "Other";

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
};

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
