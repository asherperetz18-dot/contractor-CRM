"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { Field } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { TimeField } from "@/components/ui/time-field";
import { AddressAutocompleteInput } from "@/components/ui/address-autocomplete-input";
import { PicklistSelect } from "@/components/ui/picklist-select";
import { LeadEstimateButton } from "./lead-estimate-button";
import type { LeadEstimateIndex } from "@/lib/data/lead-estimate-index";
import { LeadAppointmentsPanel } from "./lead-appointments-panel";
import { LeadAnalysisPanel } from "./lead-analysis-panel";
import { PropertyPeek } from "@/components/ui/property-peek";
import { LeadViewTrail } from "./lead-view-trail";
import {
  addHour as addHourTo,
  endsNextDay,
  leadDisplayName,
  mapsUrl,
  money,
  stageColor,
  type CalendarRow,
  type Lead,
  type LeadFile,
  type LeadInput,
  type LeadNote,
  type LeadSourceRow,
  type LeadTask,
  type PipelineStageRow,
  type ProjectTypeRow,
  type Profile,
  type RefundStatus,
} from "@/lib/data/types";
import {
  bookAppointmentForLead,
  convertLeadToJob,
  createLead,
  deleteLead,
  findDuplicateLeads,
  moveLeadStage,
  requestLeadRefund,
  resolveLeadRefund,
  updateLead,
  type DuplicateLeadMatch,
} from "@/lib/actions/leads";
import { addLeadNote } from "@/lib/actions/lead-notes";
import {
  createPortalLinkForStaff,
  renewPortalAccess,
  sendPortalLink,
} from "@/lib/actions/portal";

// One-click ways out of the active pipeline, in the order they appear.
// Only rendered when the stage actually exists for the current company --
// "Not Interested" is a custom stage that exists in some companies and not
// others, and a button that moves a lead to a stage this company doesn't
// have would just fail.
const QUICK_EXIT_STAGES = ["Not Interested", "Lost"] as const;
import { TasksPanel } from "./tasks-panel";
import { NotesTimeline } from "./notes-timeline";
import { MessagesPanel } from "./messages-panel";
import {
  DispatcherPicker,
  type DispatcherPickerBootstrap,
} from "../calendar/dispatcher-picker";
import { LeadFilesPanel } from "./lead-files-panel";
import { CallsPanel } from "./calls-panel";

type Tab = "Overview" | "Appointments" | "Tasks" | "Notes" | "Texts" | "Calls" | "Files";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function toInput(lead?: Lead): LeadInput {
  return {
    contact_type: lead?.contact_type ?? "Individual",
    company_name: lead?.company_name ?? "",
    first_name: lead?.first_name ?? "",
    last_name: lead?.last_name ?? "",
    phone: lead?.phone ?? "",
    email: lead?.email ?? "",
    address: lead?.address ?? "",
    zip: lead?.zip ?? "",
    source: lead?.source ?? "",
    project_type: lead?.project_type ?? "",
    stage: lead?.stage ?? "Unsorted",
    value: lead ? String(lead.value ?? "") : "",
    lead_cost: lead?.lead_cost != null ? String(lead.lead_cost) : "",
    date_received: lead?.date_received ?? todayISO(),
    notes: lead?.notes ?? "",
    has_appt: lead?.has_appt ?? false,
    second_contact_first_name: lead?.second_contact_first_name ?? "",
    second_contact_last_name: lead?.second_contact_last_name ?? "",
    second_contact_phone: lead?.second_contact_phone ?? "",
    assigned_to: lead?.assigned_to ?? "",
  };
}

export function LeadForm({
  lead,
  reps,
  stages,
  calendars,
  projectTypes,
  sources,
  tasks,
  notes,
  files,
  readOnly,
  canDelete,
  isAdmin,
  estimateIndex,
  dispatcherPicker,
  onCancel,
  onSaved,
  onDeleted,
}: {
  lead?: Lead;
  reps: Profile[];
  stages: PipelineStageRow[];
  calendars: CalendarRow[];
  projectTypes: ProjectTypeRow[];
  sources: LeadSourceRow[];
  tasks?: LeadTask[];
  notes?: LeadNote[];
  files?: LeadFile[];
  readOnly?: boolean;
  canDelete?: boolean;
  /** Admin role only -- gates the who-opened-this trail. */
  isAdmin?: boolean;
  /** Every estimate in the company, grouped by lead. Loaded with the
   *  page so the estimate chip is there on the first frame. */
  estimateIndex?: LeadEstimateIndex;
  /** Dispatcher picker data, from the page -- same reason. */
  dispatcherPicker?: DispatcherPickerBootstrap;
  onCancel: () => void;
  onSaved: () => void;
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<LeadInput>(toInput(lead));
  const [hasSecondContact, setHasSecondContact] = useState(
    !!(lead?.second_contact_first_name || lead?.second_contact_phone)
  );
  const [showBooking, setShowBooking] = useState(false);
  const [tab, setTab] = useState<Tab>("Overview");
  const tabsRowRef = useRef<HTMLDivElement>(null);
  const [lastSaved, setLastSaved] = useState(form);
  const [projectTypeOptions, setProjectTypeOptions] = useState<{ id: string; name: string }[]>(
    projectTypes
  );
  const [sourceOptions, setSourceOptions] = useState<{ id: string; name: string }[]>(sources);
  const skipNextAutosave = useRef(true);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [refundStatus, setRefundStatus] = useState<RefundStatus>(lead?.refund_status ?? "None");
  const [refundRequestedAt, setRefundRequestedAt] = useState<string | null>(
    lead?.refund_requested_at ?? null
  );
  const [refundPending, setRefundPending] = useState(false);
  const [portalLinkStatus, setPortalLinkStatus] = useState<
    "idle" | "pending" | "sent" | "error"
  >("idle");
  const [portalLinkError, setPortalLinkError] = useState("");
  const [portalLinkChannels, setPortalLinkChannels] = useState("");
  const [portalExpiry, setPortalExpiry] = useState<string | null>(
    lead?.portal_access_expires_at ?? null
  );
  const [portalRenewPending, setPortalRenewPending] = useState(false);
  const [portalCopyStatus, setPortalCopyStatus] = useState<
    "idle" | "pending" | "copied" | "error"
  >("idle");
  const [portalCopyNote, setPortalCopyNote] = useState("");
  const [quickExitPending, setQuickExitPending] = useState("");
  const [markLostError, setMarkLostError] = useState("");

  /**
   * Contacts already carrying the phone or email being typed.
   *
   * Only in create mode, and a warning rather than a block: the CSV
   * importer has warned like this since it shipped, while the hand-typed
   * form never did -- which is exactly how the same customer ends up in
   * the pipeline twice with two reps calling them. A repeat enquiry is
   * sometimes a genuinely new job, so the decision stays with the typist.
   */
  const [dupMatches, setDupMatches] = useState<DuplicateLeadMatch[]>([]);
  useEffect(() => {
    if (lead) return; // editing an existing contact is not an attempt at a new one
    const phone = form.phone.trim();
    const emailAddr = form.email.trim();
    const enough = phone.replace(/\D/g, "").length >= 10 || !!emailAddr;
    let cancelled = false;
    const t = setTimeout(
      async () => {
        // Clearing also goes through the timeout: setting state
        // synchronously inside an effect forces an extra render pass.
        const matches = enough ? await findDuplicateLeads(phone, emailAddr) : [];
        if (!cancelled) setDupMatches(matches);
      },
      enough ? 600 : 0
    );
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead, form.phone, form.email]);

  // "now" is captured once at mount -- reading the clock during render
  // makes the same state render differently on re-renders.
  const [openedAt] = useState(() => Date.now());
  const portalActive = !!portalExpiry && new Date(portalExpiry).getTime() > openedAt;

  const stageIndex = stages.findIndex((s) => s.name === form.stage);
  const stageTotal = stages.length;

  function callPhone(phone: string) {
    window.dispatchEvent(new CustomEvent("crm:call", { detail: { phone, leadId: lead?.id } }));
  }

  function textPhone() {
    // The thread already lives in this card's Texts tab. Jumping out to
    // the Reply Inbox meant closing the modal and loading every
    // conversation just to show this one. Scrolling to the tab row
    // matters on small screens, where the panel opening below the fold
    // makes the button look dead.
    if (!lead) return;
    setTab("Texts");
    setTimeout(() => {
      tabsRowRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  /**
   * Puts a portal link on the clipboard instead of sending it.
   *
   * A fresh token every press, deliberately. Portal links are
   * single-use, so a link copied now and opened by staff is spent -- if
   * the same one had been given to the customer they would meet a dead
   * link and reasonably conclude the portal is broken. Minting per press
   * makes "copy one for me, send one to them" safe.
   */
  async function handleCopyPortalLink() {
    if (!lead) return;
    setPortalCopyStatus("pending");
    setPortalCopyNote("");
    const result = await createPortalLinkForStaff(lead.id);
    if (result?.error || !result?.url) {
      setPortalCopyStatus("error");
      setPortalCopyNote(result?.error || "Could not create a link.");
      return;
    }
    try {
      await navigator.clipboard.writeText(result.url);
      setPortalCopyStatus("copied");
      setPortalCopyNote(
        `Single-use, expires in ${result.expiresInDays ?? 7} days. Opening it signs you in as this customer.`
      );
    } catch {
      // Clipboard access can be refused outright; showing the link is
      // better than a copy button that silently does nothing.
      setPortalCopyStatus("error");
      setPortalCopyNote(result.url);
    }
    setTimeout(() => setPortalCopyStatus("idle"), 6000);
  }

  // Sends the customer a magic link into their client portal by email and
  // text, whichever they have on file, and reports back which actually
  // went out rather than a bare "Sent".
  async function handleSendPortalLink() {
    if (!lead) return;
    setPortalLinkStatus("pending");
    setPortalLinkError("");
    setPortalLinkChannels("");
    const result = await sendPortalLink(lead.id);
    if (result?.error) {
      setPortalLinkStatus("error");
      setPortalLinkError(result.error);
      return;
    }
    setPortalLinkChannels((result?.channels ?? []).join(" & "));
    setPortalLinkStatus("sent");
    // Sending a link is also what grants access, so reflect the new
    // expiry straight away rather than waiting for a reload.
    if (result?.expiresAt) setPortalExpiry(result.expiresAt);
    setTimeout(() => setPortalLinkStatus("idle"), 4000);
  }

  // Moves the contact straight out of the pipeline without going through
  // the stage dropdown and a save. Confirmed first because it drops them
  // from the active pipeline, and logged so there's a record of who did it.
  async function handleQuickExit(stage: string) {
    if (!lead) return;
    const who = [form.first_name, form.last_name].filter(Boolean).join(" ") || "this contact";
    if (!confirm(`Move ${who} to ${stage}? They'll drop out of the active pipeline.`)) return;

    setQuickExitPending(stage);
    setMarkLostError("");
    const result = await moveLeadStage(lead.id, stage);
    if (result?.error) {
      setQuickExitPending("");
      setMarkLostError(result.error);
      return;
    }
    await addLeadNote(lead.id, `Moved to ${stage} from the contact card.`);
    setQuickExitPending("");
    setForm((f) => ({ ...f, stage }));
    refresh();
    onSaved();
  }

  async function handleRenewPortal() {
    if (!lead) return;
    setPortalRenewPending(true);
    setPortalLinkError("");
    const result = await renewPortalAccess(lead.id);
    setPortalRenewPending(false);
    if (result?.error) {
      setPortalLinkStatus("error");
      setPortalLinkError(result.error);
      return;
    }
    if (result?.expiresAt) setPortalExpiry(result.expiresAt);
  }

  async function handleRequestRefund() {
    if (!lead) return;
    setRefundPending(true);
    setError("");
    const result = await requestLeadRefund(lead.id);
    setRefundPending(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    setRefundStatus("Requested");
    setRefundRequestedAt(new Date().toISOString());
  }

  async function handleResolveRefund(status: "Received" | "Denied") {
    if (!lead) return;
    setRefundPending(true);
    setError("");
    const result = await resolveLeadRefund(lead.id, status);
    setRefundPending(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    setRefundStatus(status);
  }
  const [booking, setBooking] = useState({
    date: todayISO(),
    time: "09:00",
    endTime: "",
    eventType: "Estimate",
    assignedTo: "",
    projectType: "",
    notes: "",
  });

  const set = <K extends keyof LeadInput>(k: K, v: LeadInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  function refresh() {
    startTransition(() => router.refresh());
  }

  // Autosaves write the database but no longer re-render the page --
  // every pause in typing was re-rendering the whole board behind the
  // open card, which froze scrolling for seconds. This remembers that
  // the page is behind, and closing the card settles the debt with one
  // refresh.
  const needsRefreshOnClose = useRef(false);
  function handleClose() {
    if (needsRefreshOnClose.current) {
      needsRefreshOnClose.current = false;
      refresh();
    }
    onCancel();
  }

  const autosaveDirty = form !== lastSaved;
  const formValid =
    form.contact_type === "Company"
      ? !!(form.company_name.trim() && form.phone.trim())
      : !!(form.first_name.trim() && form.last_name.trim() && form.phone.trim());

  useEffect(() => {
    if (!lead || readOnly) return;
    if (skipNextAutosave.current) {
      skipNextAutosave.current = false;
      return;
    }
    if (!formValid) return;

    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(async () => {
      const payload = hasSecondContact
        ? form
        : {
            ...form,
            second_contact_first_name: "",
            second_contact_last_name: "",
            second_contact_phone: "",
          };
      const result = await updateLead(lead.id, payload, { deferRevalidate: true });
      if (result?.error) {
        setError(result.error);
        return;
      }
      setLastSaved(form);
      needsRefreshOnClose.current = true;
    }, 1000);

    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, hasSecondContact]);

  async function handleSave() {
    if (!formValid) {
      setError("Fill in the required fields (marked *) before saving.");
      return;
    }
    setPending(true);
    setError("");
    const payload = hasSecondContact
      ? form
      : {
          ...form,
          second_contact_first_name: "",
          second_contact_last_name: "",
          second_contact_phone: "",
        };
    const result = lead
      ? await updateLead(lead.id, payload)
      : await createLead(payload);
    setPending(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    setLastSaved(form);
    needsRefreshOnClose.current = false;
    refresh();
    onSaved();
  }

  async function handleDelete() {
    if (!lead) return;
    setPending(true);
    const result = await deleteLead(lead.id);
    setPending(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    refresh();
    onDeleted?.();
  }

  async function handleConvert() {
    if (!lead) return;
    setPending(true);
    const result = await convertLeadToJob(lead);
    setPending(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    refresh();
    onSaved();
  }

  async function handleBook() {
    if (!lead) return;
    setPending(true);
    const contactName =
      form.contact_type === "Company"
        ? form.company_name
        : `${form.first_name} ${form.last_name}`.trim();
    const result = await bookAppointmentForLead(lead.id, lead.stage, {
      title: `${booking.eventType} — ${contactName}`,
      date: booking.date,
      time: booking.time,
      endTime: booking.endTime,
      eventType: booking.eventType,
      assignedTo: booking.assignedTo,
      notes: booking.notes,
      projectType: booking.projectType,
    });
    setPending(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    refresh();
    onSaved();
  }

  return (
    <Modal title={lead ? leadDisplayName(lead) : "New Contact"} onClose={handleClose} xwide>
      <fieldset disabled={readOnly || pending} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="form-grid">
          <Field label="Contact Type">
            <div className="segmented">
              <button
                type="button"
                className={
                  "segmented-btn" +
                  (form.contact_type === "Individual" ? " active" : "")
                }
                onClick={() => set("contact_type", "Individual")}
              >
                Individual
              </button>
              <button
                type="button"
                className={
                  "segmented-btn" +
                  (form.contact_type === "Company" ? " active" : "")
                }
                onClick={() => set("contact_type", "Company")}
              >
                Company
              </button>
            </div>
          </Field>
          {form.contact_type === "Company" && (
            <Field label="Company Name *">
              <input
                value={form.company_name}
                onChange={(e) => set("company_name", e.target.value)}
                placeholder="Business name"
              />
            </Field>
          )}
          <Field
            label={
              form.contact_type === "Company"
                ? "Contact Person First Name"
                : "First Name *"
            }
          >
            <input
              value={form.first_name}
              onChange={(e) => set("first_name", e.target.value)}
            />
          </Field>
          <Field
            label={
              form.contact_type === "Company"
                ? "Contact Person Last Name"
                : "Last Name *"
            }
          >
            <input
              value={form.last_name}
              onChange={(e) => set("last_name", e.target.value)}
            />
          </Field>
          <Field label="Phone *">
            <input
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
              placeholder="(555) 555-5555"
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder="client@email.com"
            />
          </Field>
        </div>

        {!lead && dupMatches.length > 0 && (
          <div className="dup-banner" style={{ marginBottom: 14 }}>
            <span>
              ⚠ Already in your contacts:{" "}
              {dupMatches.map((m, i) => (
                <span key={m.id}>
                  {i > 0 && ", "}
                  <strong>{m.name}</strong> ({m.stage}, same {m.matchedOn})
                </span>
              ))}
              . Saving anyway creates a duplicate.
            </span>
            <button
              type="button"
              className="btn-ghost small"
              onClick={() => {
                onCancel();
                router.push(`/contacts?openLead=${dupMatches[0].id}`);
              }}
            >
              Open existing
            </button>
          </div>
        )}

        {lead && (form.phone || form.address || form.email) && (
          <div className="contact-card contact-card-actions-row" style={{ marginBottom: 14 }}>
            {form.address && (
              <a href={mapsUrl(form.address)} target="_blank" rel="noopener noreferrer">
                📍 {form.address}
              </a>
            )}
            {form.phone && (
              <>
                <button
                  type="button"
                  className="icon-btn contact-quick-action"
                  onClick={() => callPhone(form.phone)}
                  title="Call"
                  aria-label="Call"
                >
                  📞 Call
                </button>
                <button
                  type="button"
                  className="icon-btn contact-quick-action"
                  onClick={() => textPhone()}
                  title="Text"
                  aria-label="Text"
                >
                  💬 Text
                </button>
              </>
            )}
            {form.email && (
              <a
                href={`mailto:${form.email}`}
                className="icon-btn contact-quick-action"
                title="Email"
              >
                ✉ Email
              </a>
            )}
            {(form.phone || form.email) && (
              <button
                type="button"
                className="icon-btn contact-quick-action"
                onClick={handleSendPortalLink}
                disabled={portalLinkStatus === "pending"}
                title="Send this contact a sign-in link to their project portal"
              >
                {portalLinkStatus === "pending" ? "Sending…" : "🔗 Portal Link"}
              </button>
            )}
            {/* Copying rather than sending: for checking what the
                customer sees, or pasting into an email being written by
                hand. A fresh token every press, because they are
                single-use -- see handleCopyPortalLink. */}
            {lead && (
              <button
                type="button"
                className="icon-btn contact-quick-action"
                onClick={handleCopyPortalLink}
                disabled={portalCopyStatus === "pending"}
                title="Copy a sign-in link for this contact's portal, to open or paste yourself"
              >
                {portalCopyStatus === "pending"
                  ? "Making…"
                  : portalCopyStatus === "copied"
                    ? "✓ Copied"
                    : "⧉ Copy link"}
              </button>
            )}
            {portalLinkStatus === "sent" && (
              <span className="cp-saved">
                ✓ Sent{portalLinkChannels ? ` by ${portalLinkChannels}` : ""}
              </span>
            )}
          </div>
        )}
        {portalLinkStatus === "error" && <p className="error-note">{portalLinkError}</p>}
        {portalCopyNote && (
          <p className={portalCopyStatus === "error" ? "error-note" : "est-tax-note"}>
            {portalCopyNote}
          </p>
        )}

        {lead && (
          <div className="portal-status-row">
            <span className="portal-status-label">Customer Portal</span>
            {portalActive ? (
              <span className="portal-status-ok">
                ✓ Active — expires {new Date(portalExpiry!).toLocaleDateString()}
              </span>
            ) : portalExpiry ? (
              <span className="portal-status-bad">⚠ Portal Expired</span>
            ) : (
              <span className="portal-status-none">Not sent yet</span>
            )}
            {portalExpiry && (
              <button
                type="button"
                className="btn-ghost small"
                onClick={handleRenewPortal}
                disabled={portalRenewPending}
              >
                {portalRenewPending ? "Renewing…" : "Renew"}
              </button>
            )}
          </div>
        )}

        {hasSecondContact ? (
          <div className="second-contact-block">
            <div className="second-contact-head">
              <span>Second Contact</span>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setHasSecondContact(false)}
                aria-label="Remove second contact"
              >
                ✕
              </button>
            </div>
            <div className="form-grid">
              <Field label="First Name">
                <input
                  value={form.second_contact_first_name}
                  onChange={(e) =>
                    set("second_contact_first_name", e.target.value)
                  }
                />
              </Field>
              <Field label="Last Name">
                <input
                  value={form.second_contact_last_name}
                  onChange={(e) =>
                    set("second_contact_last_name", e.target.value)
                  }
                />
              </Field>
              <Field label="Phone">
                <input
                  value={form.second_contact_phone}
                  onChange={(e) => set("second_contact_phone", e.target.value)}
                />
              </Field>
            </div>
          </div>
        ) : (
          !readOnly && (
            <button
              type="button"
              className="btn-ghost small"
              onClick={() => setHasSecondContact(true)}
            >
              + Add second contact (e.g. spouse / co-owner)
            </button>
          )
        )}

        {lead && stageTotal > 0 && (
          <div className="stage-progress">
            <div className="stage-progress-label">
              <Badge color={stageColor(stages, form.stage)}>{form.stage}</Badge>
              {stageIndex >= 0 && (
                <span className="stage-progress-count">
                  Stage {stageIndex + 1} of {stageTotal}
                </span>
              )}
            </div>
            <div className="stage-progress-bar">
              {stages.map((s, i) => (
                <span
                  key={s.id}
                  className={"stage-progress-seg" + (i === stageIndex ? " active" : "")}
                />
              ))}
            </div>
          </div>
        )}

        {lead && <LeadViewTrail leadId={lead.id} isAdmin={!!isAdmin} />}

        {lead && (
          <div className="chip-row no-margin ta-tabs" ref={tabsRowRef}>
            {(
              ["Overview", "Appointments", "Tasks", "Notes", "Texts", "Calls", "Files"] as Tab[]
            ).map((t) => (
              <button
                key={t}
                type="button"
                className={"chip" + (tab === t ? " chip-active" : "")}
                onClick={() => setTab(t)}
              >
                {t}
                {t === "Tasks" && (tasks ?? []).filter((task) => !task.completed_at).length > 0
                  ? ` (${(tasks ?? []).filter((task) => !task.completed_at).length})`
                  : ""}
                {t === "Notes" && (notes ?? []).length > 0 ? ` (${(notes ?? []).length})` : ""}
                {t === "Files" && (files ?? []).length > 0 ? ` (${(files ?? []).length})` : ""}
              </button>
            ))}
            {/* Not a tab: it leaves the modal for the estimate itself
                rather than switching the pane below. */}
            <LeadEstimateButton
              leadId={lead.id}
              estimates={estimateIndex?.byLead[lead.id]?.estimates ?? []}
              paidCents={estimateIndex?.byLead[lead.id]?.paidCents ?? 0}
              canView={!!estimateIndex?.canView}
              canCreate={!!estimateIndex?.canCreate}
            />
            {/* One-click exits from the pipeline. Each is shown only if the
                stage exists for this company and isn't the current one, so
                a lead is never offered a move that would do nothing. */}
            {!readOnly && (
              <span className="chip-row-end">
                {QUICK_EXIT_STAGES.filter(
                  (s) => stages.some((ps) => ps.name === s) && form.stage !== s
                ).map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="chip chip-danger"
                    onClick={() => handleQuickExit(s)}
                    disabled={!!quickExitPending}
                    title={`Move this contact to the ${s} stage`}
                  >
                    {quickExitPending === s ? "Moving…" : `✕ ${s}`}
                  </button>
                ))}
              </span>
            )}
          </div>
        )}
        {markLostError && <p className="error-note">{markLostError}</p>}

        {(!lead || tab === "Overview") && (
          <>
        <div className="form-grid" style={{ marginTop: 14 }}>
          <Field label="Address">
            <AddressAutocompleteInput
              value={form.address}
              onChange={(v) => set("address", v)}
              onZipChange={(v) => set("zip", v)}
              placeholder="Job site address"
            />
          </Field>
          <Field label="Zip">
            <input value={form.zip} onChange={(e) => set("zip", e.target.value)} />
          </Field>
          <Field label="Project Type">
            <PicklistSelect
              table="project_types"
              value={form.project_type}
              options={projectTypeOptions}
              onChange={(v) => set("project_type", v)}
              onOptionAdded={(o) => setProjectTypeOptions((prev) => [...prev, o])}
              disabled={readOnly || pending}
            />
          </Field>
          <Field label="Source">
            <PicklistSelect
              table="lead_sources"
              value={form.source}
              options={sourceOptions}
              onChange={(v) => set("source", v)}
              onOptionAdded={(o) => setSourceOptions((prev) => [...prev, o])}
              disabled={readOnly || pending}
            />
          </Field>
          <Field label="Date Received">
            <input
              type="date"
              value={form.date_received}
              onChange={(e) => set("date_received", e.target.value)}
            />
          </Field>
          <Field label="Est. Value">
            <input
              value={form.value}
              onChange={(e) => set("value", e.target.value)}
              placeholder="0"
              inputMode="decimal"
            />
          </Field>
          <Field label="Lead Cost">
            <input
              value={form.lead_cost}
              onChange={(e) => set("lead_cost", e.target.value)}
              placeholder="0"
              inputMode="decimal"
            />
          </Field>
          {form.lead_cost.trim() !== "" && (
            <Field label="Est. Margin">
              <div className="ta-readonly-value">
                {money((Number(form.value) || 0) - (Number(form.lead_cost) || 0))}
              </div>
            </Field>
          )}
          <Field label="Stage">
            <select value={form.stage} onChange={(e) => set("stage", e.target.value as LeadInput["stage"])}>
              {stages.map((s) => (
                <option key={s.id} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          {/* "Has Appointment?" used to be a hand-set dropdown here. It
              could read "Scheduled" with nothing booked and "Not yet"
              with three on the calendar -- and the Appointments tab now
              shows the truth. Booking an appointment sets the underlying
              flag itself; the one place it could be set to a lie is
              gone. */}
          <Field label="Assigned Rep">
            <select
              value={form.assigned_to}
              onChange={(e) => set("assigned_to", e.target.value)}
            >
              <option value="">Unassigned</option>
              {reps.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name || r.email}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {/* A dispatcher takes the lead when it arrives -- long before
            there is an appointment to set it on, which is where this
            first shipped and was the only place it existed. Hidden until
            the lead is saved, since claiming needs a row to claim. */}
        {lead && (
          <div className="form-grid">
            <DispatcherPicker
              leadId={lead.id}
              currentDispatcherId={lead.dispatcher_id ?? null}
              readOnly={readOnly}
              bootstrap={dispatcherPicker}
            />
            <div />
          </div>
        )}

        {lead && (
          <div className="second-contact-block">
            <div className="second-contact-head">
              <span>↩ Lead Refund (RTP)</span>
              {refundStatus !== "None" && (
                <Badge
                  color={
                    refundStatus === "Requested"
                      ? "#C7691B"
                      : refundStatus === "Received"
                        ? "#2F855A"
                        : "#C0392B"
                  }
                >
                  {refundStatus}
                </Badge>
              )}
            </div>
            {refundStatus === "None" && (
              <button
                type="button"
                className="btn-ghost small"
                onClick={handleRequestRefund}
                disabled={readOnly || refundPending}
              >
                {refundPending ? "Requesting…" : "Request lead refund"}
              </button>
            )}
            {refundStatus === "Requested" && (
              <div className="modal-actions">
                <div>
                  {refundRequestedAt && (
                    <span className="empty-hint">
                      Requested{" "}
                      {new Date(refundRequestedAt).toLocaleDateString("en-US", {
                        month: "2-digit",
                        day: "2-digit",
                        year: "numeric",
                      })}
                    </span>
                  )}
                </div>
                {!readOnly && (
                  <div>
                    <button
                      type="button"
                      className="btn-ghost small"
                      onClick={() => handleResolveRefund("Received")}
                      disabled={refundPending}
                    >
                      Mark received
                    </button>
                    <button
                      type="button"
                      className="btn-ghost small"
                      onClick={() => handleResolveRefund("Denied")}
                      disabled={refundPending}
                    >
                      Mark denied
                    </button>
                  </div>
                )}
              </div>
            )}
            {(refundStatus === "Received" || refundStatus === "Denied") && !readOnly && (
              <button
                type="button"
                className="btn-ghost small"
                onClick={handleRequestRefund}
                disabled={refundPending}
              >
                Request again
              </button>
            )}
          </div>
        )}

        {lead && <LeadAnalysisPanel leadId={lead.id} />}

        {/* Same property block the appointment drawer carries: photo,
            Zillow, and the PropertyRadar owner/liens report. */}
        {lead && form.address && (
          <PropertyPeek
            address={form.address}
            leadId={lead.id}
            contactName={leadDisplayName(lead)}
          />
        )}

        <Field label="Notes">
          <textarea
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            rows={3}
          />
        </Field>

        {lead && !readOnly && (
          showBooking ? (
            <div className="second-contact-block">
              <div className="second-contact-head">
                <span>Book Appointment</span>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setShowBooking(false)}
                  aria-label="Cancel booking"
                >
                  ✕
                </button>
              </div>
              <div className="form-grid">
                <Field label="Date">
                  <input
                    type="date"
                    value={booking.date}
                    onChange={(e) =>
                      setBooking((b) => ({ ...b, date: e.target.value }))
                    }
                  />
                </Field>
                <Field label="Start Time">
                  <TimeField
                    value={booking.time}
                    onChange={(v) => setBooking((b) => ({ ...b, time: v }))}
                  />
                </Field>
                <Field label="End Time">
                  {booking.endTime ? (
                    <>
                      <div className="end-time-row">
                        <TimeField
                          value={booking.endTime}
                          onChange={(v) => setBooking((b) => ({ ...b, endTime: v }))}
                        />
                        <button
                          type="button"
                          className="btn-ghost small"
                          onClick={() => setBooking((b) => ({ ...b, endTime: "" }))}
                        >
                          Clear
                        </button>
                      </div>
                      {endsNextDay(booking.time, booking.endTime) && (
                        <p className="hint-note">Ends the next day.</p>
                      )}
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn-ghost small"
                      onClick={() =>
                        setBooking((b) => ({ ...b, endTime: addHourTo(b.time) }))
                      }
                    >
                      + Add end time
                    </button>
                  )}
                </Field>
                <Field label="Calendar">
                  <select
                    value={booking.eventType}
                    onChange={(e) =>
                      setBooking((b) => ({ ...b, eventType: e.target.value }))
                    }
                  >
                    {calendars.map((c) => (
                      <option key={c.id} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Assigned To">
                  <select
                    value={booking.assignedTo}
                    onChange={(e) =>
                      setBooking((b) => ({ ...b, assignedTo: e.target.value }))
                    }
                  >
                    <option value="">Unassigned</option>
                    {reps.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name || r.email}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Project Type">
                  <input
                    value={booking.projectType}
                    onChange={(e) =>
                      setBooking((b) => ({ ...b, projectType: e.target.value }))
                    }
                    placeholder="Kitchen, Roofing..."
                  />
                </Field>
              </div>
              <Field label="Notes">
                <textarea
                  value={booking.notes}
                  onChange={(e) => setBooking((b) => ({ ...b, notes: e.target.value }))}
                  rows={2}
                  placeholder="Anything the rep should know for this appointment"
                />
              </Field>
              <button
                type="button"
                className="btn-primary small"
                onClick={handleBook}
                disabled={pending}
              >
                Confirm &amp; Add to Calendar
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn-ghost small"
              onClick={() => {
                setBooking((b) => ({ ...b, projectType: form.project_type }));
                setShowBooking(true);
              }}
              style={{ marginBottom: 14 }}
            >
              📅 Book Appointment
            </button>
          )
        )}
          </>
        )}

        {lead && tab === "Appointments" && (
          <LeadAppointmentsPanel leadId={lead.id} reps={reps} />
        )}

        {lead && tab === "Tasks" && (
          <TasksPanel
            leadId={lead.id}
            tasks={tasks ?? []}
            reps={reps}
            readOnly={readOnly}
            onChanged={refresh}
          />
        )}

        {lead && tab === "Notes" && (
          <NotesTimeline
            leadId={lead.id}
            notes={notes ?? []}
            reps={reps}
            readOnly={readOnly}
            onChanged={refresh}
          />
        )}

        {lead && tab === "Texts" && (
          <MessagesPanel leadId={lead.id} phone={form.phone} readOnly={readOnly} />
        )}

        {lead && tab === "Calls" && <CallsPanel leadId={lead.id} readOnly={readOnly} />}

        {lead && tab === "Files" && (
          <LeadFilesPanel
            leadId={lead.id}
            files={files ?? []}
            reps={reps}
            readOnly={readOnly}
            onChanged={refresh}
          />
        )}

        {error && <p className="error-note">{error}</p>}

        <div className="modal-actions">
          <div className="modal-actions-left">
            {/* Not on the tabs that commit as you go. Delete removes the
                whole contact, and a red Delete directly beneath a thread
                of messages or a list of files reads as though it removes
                the one you are looking at. */}
            {lead && !readOnly && canDelete && tab !== "Texts" && tab !== "Files" && (
              <button type="button" className="btn-danger-ghost" onClick={handleDelete}>
                Delete
              </button>
            )}
            {lead && !readOnly && form.stage !== "Won" && (
              <button type="button" className="btn-ghost" onClick={handleConvert}>
                Mark Won → Create Job
              </button>
            )}
            {lead && !readOnly && (
              <span className="empty-hint">
                {!formValid
                  ? "Not saved — fill in required fields (marked *)"
                  : autosaveDirty
                    ? "Saving…"
                    : "✓ Saved"}
              </span>
            )}
          </div>
          <div>
            <button type="button" className="btn-ghost" onClick={handleClose}>
              {readOnly || lead ? "Close" : "Cancel"}
            </button>
            {!readOnly && !lead && (
              <button type="button" className="btn-primary" onClick={handleSave} disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </button>
            )}
          </div>
        </div>
      </fieldset>
    </Modal>
  );
}
