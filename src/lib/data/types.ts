export type ContactType = "Individual" | "Company";

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
