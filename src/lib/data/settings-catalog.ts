export type SettingsCardDef = {
  title: string;
  desc: string;
  icon: string;
  href?: string;
  key?: "logo" | "pipeline-stages";
};

export type SettingsSectionDef = {
  category: string;
  hint: string;
  cards: SettingsCardDef[];
};

export const SETTINGS_CATEGORIES = [
  "Company Identity",
  "People & Access",
  "Sales & Pipeline",
  "Calendar & Appointments",
  "Phone & Dialer",
  "Projects & Operations",
  "Finance & Accounting",
  "Documents & Compliance",
  "Email & Messaging",
  "Notifications & Automations",
  "Integrations & AI",
  "Data Management",
  "System & Monitoring",
];

export const SETTINGS_SECTIONS: SettingsSectionDef[] = [
  {
    category: "Company Identity",
    hint: "How your company appears across the app, portal, and documents",
    cards: [
      {
        title: "Company Profile",
        desc: "Company name, address, phone, email, website, and license details",
        icon: "🏢",
        href: "/settings/company-profile",
      },
      {
        title: "Logo",
        desc: "Upload your company logo and configure how it appears in emails and documents",
        icon: "🖼",
        key: "logo",
      },
      { title: "Appearance & Theme", desc: "Theme colors, dark/light mode, and visual style", icon: "🎨" },
      { title: "Social Media Links", desc: "LinkedIn, Facebook, Instagram, and other social profiles", icon: "🔗" },
      { title: "Insurance Documents", desc: "Upload liability, workers comp, and other insurance certificates", icon: "🛡" },
      { title: "License Certificates", desc: "Upload contractor licenses and state certifications", icon: "📜" },
    ],
  },
  {
    category: "People & Access",
    hint: "Team members, roles, permissions, and per-role defaults",
    cards: [
      {
        title: "Users & Roles",
        desc: "Invite team members, assign roles, and manage permissions",
        icon: "👥",
        href: "/settings/users-roles",
      },
      {
        title: "Role Visibility",
        desc: "Choose which pages each role can open. Hidden pages are removed from the sidebar and blocked at the URL.",
        icon: "👁",
      },
      { title: "Role Analytics Defaults", desc: "Default KPI visibility per role and dashboard layout", icon: "📊" },
    ],
  },
  {
    category: "Sales & Pipeline",
    hint: "Pipelines, lead sources, estimates, commissions, and marketing",
    cards: [
      {
        title: "Pipeline Stages",
        desc: "Manage stages within each pipeline (Appointment Scheduled, Won, Lost, etc.)",
        icon: "📍",
        key: "pipeline-stages",
      },
      { title: "Pipeline Custom Fields", desc: "Configure custom field schema for pipelines", icon: "🧩" },
      { title: "Stage Badges", desc: "Map pipeline stages to badge colors and labels shown on cards", icon: "🏷" },
      {
        title: "Estimate Defaults",
        desc: "Default terms and conditions, markup, deposit, expiration, and plan size limits",
        icon: "📄",
      },
      {
        title: "Estimate Templates",
        desc: "Pre-built estimates (bathroom, kitchen, ADU, pool, etc.) used to seed new estimates",
        icon: "🧾",
      },
      {
        title: "Commission & Lead Cost Defaults",
        desc: "Default lead cost and commission split percentages applied to new projects",
        icon: "%",
      },
      { title: "Lead Sources", desc: "Create and manage lead source categories (Zillow, Referral, etc.)", icon: "📥" },
      { title: "Marketing Messages", desc: "Reusable marketing texts & emails your team can send from any lead", icon: "✉" },
      { title: "Geofencing", desc: "Geofence radius, alerts, and check-in behavior", icon: "📡" },
    ],
  },
  {
    category: "Calendar & Appointments",
    hint: "Calendars, appointment notifications, and Google Calendar sync",
    cards: [
      {
        title: "Calendars",
        desc: "Configure the 5 system calendars (Sales Rep, Office, Architect, Sign-Off, 2nd @ Property) and add custom ones. Set colors per calendar.",
        icon: "📅",
      },
      {
        title: "Appointment Notifications",
        desc: "Appointment notification templates — the WhatsApp appointment notices, the Send SMS quick-text templates (Confirm, Reschedule, On my way, Running...",
        icon: "🔔",
      },
      { title: "Google Calendar", desc: "OAuth connection and sync settings for Google Calendar", icon: "📆" },
    ],
  },
  {
    category: "Phone & Dialer",
    hint: "Click-to-call, the power dialer, call scripts, and call outcomes",
    cards: [
      {
        title: "In-App Dialer (Twilio Voice)",
        desc: "Native click-to-call dialer: connection status, caller ID, and call recording toggle",
        icon: "📞",
      },
      {
        title: "Parallel (Predictive) Dialer",
        desc: "Dial 3–5 contacts at once, connect only to answered calls, with FCC-compliance guardrails (abandon message, rate governor, ring timeout)",
        icon: "📶",
      },
      { title: "Call Scripts", desc: "Phone-call scripts shown to admins in the Power Dialer when a call connects", icon: "📝" },
      {
        title: "Call Dispositions",
        desc: "Customize the call-outcome buttons in the dialer and what each one does (stats, pipeline moves, scheduler)",
        icon: "☎",
      },
    ],
  },
  {
    category: "Projects & Operations",
    hint: "Project types & statuses, schedules, checklists, and dashboards",
    cards: [
      { title: "Welcome Dashboard Widgets", desc: "Choose which widgets appear by default on the Welcome Dashboard", icon: "🧱" },
      { title: "Project Types", desc: "Manage project category list (Kitchen, Bath, Roof, etc.)", icon: "🏗" },
      { title: "Project Statuses", desc: "Manage the production statuses a project can move through", icon: "📶" },
      { title: "Checklist Templates", desc: "Template CRUD for project checklists", icon: "☑" },
      { title: "Schedule Templates", desc: "Templates for project schedules and Gantt charts", icon: "📋" },
      { title: "Schedule Categories", desc: "Category list for schedule items (Phase, Crew, Material, Inspection)", icon: "🗂" },
      {
        title: "Material Categories",
        desc: "Category list for PM Dashboard → Materials (appliances, tile, flooring, fixtures)",
        icon: "🧱",
      },
      { title: "Dashboard KPI Visibility", desc: "Control which KPI cards show on the main dashboard", icon: "📊" },
    ],
  },
  {
    category: "Finance & Accounting",
    hint: "Banks, payables & receivables, customer payments, QuickBooks",
    cards: [
      {
        title: "Finance Settings",
        desc: "Finance toggles including overpayment controls and Finance Manager behavior",
        icon: "💲",
      },
      { title: "Bank Accounts", desc: "Bank account CRUD, payment methods, deposit routing", icon: "🏦" },
      { title: "Payment Routing Instructions", desc: "Bank details shown at the bottom of every invoice", icon: "🧾" },
      {
        title: "Payables & Receivables",
        desc: "Payment focus day and on-demand missing progress payment phase creation",
        icon: "💲",
      },
      { title: "QuickBooks Integration", desc: "Connect QuickBooks, map fields, configure sync, matching rules", icon: "🔗" },
      { title: "Portal Payments", desc: "Connect Stripe so customers can pay invoices on the portal by card or ACH", icon: "💳" },
    ],
  },
  {
    category: "Documents & Compliance",
    hint: "Compliance templates, document folders, required paperwork, and legal letters",
    cards: [
      { title: "Compliance Templates", desc: "Compliance checklist templates, required fields, conditional logic", icon: "📝" },
      {
        title: "Document Folders",
        desc: "Folders and subtypes that project documents get filed under (Docs, Photos, Agreements, etc.) + per-audience visibility",
        icon: "🗂",
      },
      { title: "Paperwork Types", desc: "Documents tracked in PM Dashboard → Pending Paperwork", icon: "📄" },
      { title: "Document Requirements", desc: "Required document types for contracts and agreements", icon: "📃" },
      {
        title: "Vendor Contract Template",
        desc: "Edit the default subcontractor agreement sent for e-signature when you award a bid",
        icon: "✍",
      },
      { title: "Rescission Policy", desc: "Cooling-off period days and notice of cancellation template", icon: "⏱" },
      { title: "Sign-off Letter", desc: "Customer-satisfaction acknowledgement letter sent at project close-out", icon: "✅" },
    ],
  },
  {
    category: "Email & Messaging",
    hint: "Email domain, sender & templates, chat, SMS/WhatsApp, short links",
    cards: [
      { title: "Email Domain", desc: "Verify your sending domain with SPF, DKIM, and DMARC records", icon: "📧" },
      { title: "Email Sender Settings", desc: "From email, from name, and notification emails for proposals", icon: "📨" },
      { title: "Resend API Key", desc: "Optional: use your own Resend API key instead of the platform key", icon: "🔑" },
      { title: "Email Templates", desc: "Manage email templates for proposals, notifications, bulk outreach", icon: "📄" },
      { title: "Chat & Messaging", desc: "Chat provider configuration, webhooks, SMS, WhatsApp", icon: "💬" },
      { title: "Short Links", desc: "Create and manage short URLs with domain routing and analytics", icon: "🔗" },
    ],
  },
  {
    category: "Notifications & Automations",
    hint: "Automatic messages, alert recipients, and follow-up rules",
    cards: [
      { title: "Automations Center", desc: "Everything the system does automatically — and its switches", icon: "⚙" },
      { title: "Permit Digest Recipients", desc: "Choose which roles receive the daily permit digest email", icon: "🔔" },
      {
        title: "Dispatch Follow-up Alerts",
        desc: "WhatsApp alerts when follow-up items age past 3 / 7 / 14 days; recipients click a personalized link to complete, dismiss, reschedule, or reassign",
        icon: "🔔",
      },
    ],
  },
  {
    category: "Integrations & AI",
    hint: "Third-party connections, lead imports, webhooks, and AI",
    cards: [
      { title: "GoHighLevel Connection", desc: "GHL API connection, location selection, sync toggle", icon: "🔗" },
      { title: "GHL Field Mappings", desc: "Map GHL contact and lead fields to app fields", icon: "🗺" },
      { title: "OpenAI API Key", desc: "API key used to power AI features (estimates, analysis, assistant)", icon: "🔑" },
      { title: "AI Estimator", desc: "Prompt and model settings for the AI scope and estimate generator", icon: "🤖" },
      { title: "AI Analysis", desc: "Positive and negative signal prompts used by the AI analyzer", icon: "🧠" },
      {
        title: "Cloud Storage",
        desc: "Connect Dropbox or Google Drive to automatically sync project files and free up Supabase storage",
        icon: "☁",
      },
      {
        title: "Facebook Lead Ads",
        desc: "Auto-import leads from Facebook Lead Ads into Contacts & Leads",
        icon: "📘",
        href: "/settings/facebook-lead-ads",
      },
      {
        title: "Google Local Services Ads",
        desc: "Auto-import Google Guarantee leads from Google Local Services Ads into Contacts & Leads",
        icon: "🔍",
      },
      {
        title: "Incoming Data (Webhooks)",
        desc: "Custom inbound URLs so your website, Zapier, or any system can push leads into the CRM",
        icon: "📥",
        href: "/settings/incoming-webhooks",
      },
      { title: "Outgoing Webhooks", desc: "Push lead status updates back to your CRM, lead source, or accounting system", icon: "📤" },
    ],
  },
  {
    category: "Data Management",
    hint: "Import data from other systems, clean up, and bulk-edit",
    cards: [
      {
        title: "Data Import",
        desc: "Upload CSV exports from another system — auto-detected for known sources, visual mapping for everything else",
        icon: "📊",
      },
      { title: "Junk Contacts Cleanup", desc: "Rules and batch actions to clean up junk or duplicate contacts", icon: "🧹" },
      { title: "Bulk Delete", desc: "Bulk delete contacts, leads, appointments, and users", icon: "🗑" },
    ],
  },
  {
    category: "System & Monitoring",
    hint: "Billing, usage, logs, audit trail, and platform tools",
    cards: [
      { title: "Billing & Usage", desc: "Subscription plan, features, billing history, and AI token usage", icon: "🧾" },
      { title: "Audit Log", desc: "View table change history, archive, and AI-generate summaries", icon: "🕐" },
    ],
  },
];
