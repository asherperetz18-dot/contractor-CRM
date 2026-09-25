"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { downscaleImage } from "@/lib/images/downscale";
import {
  UploadQueueStrip,
  useFileDrop,
  useUploadQueue,
} from "@/components/uploads/file-drop";
import {
  formatTimeRange,
  leadDisplayName,
  leadPhotoThumbUrl,
  mapsUrl,
  type Event,
  type Lead,
  type Profile,
  type SmsMessage,
} from "@/lib/data/types";
import { docKindLabel } from "@/lib/data/company-docs";
import {
  portalRequestReschedule,
  portalSendMessage,
  portalSetAppointmentConfirmed,
  portalSignOut,
  portalUploadFile,
} from "@/lib/actions/portal";
import {
  estimateMoneyChip,
  estimateStatusChip,
  invoiceMoneyChip,
  journeyProgress,
  socialLinkClass,
} from "@/lib/portal/portal-display";

type PortalFile = {
  id: string;
  file_name: string;
  file_url: string | null;
  content_type: string | null;
  created_at: string;
  uploaded_by: string | null;
  /** Drive file id when storage_provider is google_drive; see leadPhotoThumbUrl. */
  file_path?: string | null;
  storage_provider?: string | null;
};

export type PortalDoc = {
  id: string;
  kind: string;
  title: string;
  file_url: string;
  expires_on: string | null;
};

export type PortalEstimate = {
  id: string;
  doc_number: string;
  title: string | null;
  status: string;
  total_cents: number;
  deposit_cents: number | null;
  depositPaid: boolean;
  amountDueCents: number;
  /** Billed progress phases not yet paid (completion, rough-in...). */
  phaseDueCents: number;
};

/** A bill for an extra on the job (a permit fee). */
export type PortalInvoice = {
  id: string;
  doc_number: string;
  title: string | null;
  totalCents: number;
  paidCents: number;
};

type Tab = "Overview" | "Photos" | "Messages";

// Internal pipeline stages are sales shorthand ("No Answer", "DNC",
// "Close to Sale") and must never be shown to the customer. Everything is
// mapped onto a short, client-safe journey instead.
const JOURNEY = [
  "Request received",
  "Appointment scheduled",
  "Estimate in progress",
  "Proposal sent",
  "Project confirmed",
] as const;

/**
 * Where the customer actually is.
 *
 * The estimate is asked first because it knows on its own: it turns
 * Signed the moment the customer signs it. The pipeline stage only moves
 * when a rep remembers to move it, and it routinely does not -- every
 * sent or signed estimate in this account was contradicted by its lead's
 * stage, including a signed $5,400 contract whose customer was shown
 * "Appointment scheduled".
 *
 * The stage is still the fallback, since before any estimate exists it
 * is the only thing that knows anything.
 */
function journeyStep(stage: string, estimates: PortalEstimate[]): number | null {
  if (estimates.some((e) => e.status === "Signed")) return 4;
  if (estimates.some((e) => e.status === "Sent" || e.status === "Viewed")) return 3;
  if (estimates.length > 0) return 2;

  const s = stage.toLowerCase();
  if (s === "lost" || s === "dnc") return null; // show no tracker at all
  // Won is a fact about the deal, not a promise about a document, so it
  // still stands on the stage alone.
  if (s === "won") return 4;

  /**
   * Nothing here the customer can open, so the stage alone cannot claim
   * a proposal was sent.
   *
   * "Proposal Sent" on the lead with the estimate still a Draft showed
   * the customer a ticked "Proposal sent" and then no proposal anywhere
   * on the page -- so they went looking for something that was never
   * sent, and the portal was the thing that told them it had been.
   *
   * Capped at "Estimate in progress": true whatever the stage says, and
   * it moves on by itself the moment the estimate is actually sent.
   */
  if (s.includes("proposal") || s.includes("finance") || s.includes("close to sale")) return 2;
  if (s.includes("estimate")) return 2;
  if (s.includes("appointment") || s.includes("2nd")) return 1;
  return 0;
}

// Line icons for the card headings, drawn in the heading's tone colour.
const ICONS = {
  status: <path d="M3 12h4l3 8 4-16 3 8h4" />,
  estimate: (
    <>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6M8 13h8M8 17h5" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M3 10h18" />
    </>
  ),
  shield: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />,
  shieldCheck: (
    <>
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  badge: (
    <>
      <circle cx="12" cy="9" r="5" />
      <path d="M9 13l-2 8 5-3 5 3-2-8" />
    </>
  ),
  photo: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="M21 16l-5-5-8 8" />
    </>
  ),
  chat: <path d="M4 5h16v11H9l-5 4z" />,
};

type IconTone = "blue" | "green" | "amber" | "violet" | "slate";

function PortalIcon({ name, tone }: { name: keyof typeof ICONS; tone: IconTone }) {
  return (
    <span className={`portal-ico portal-ico-${tone}`} aria-hidden="true">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {ICONS[name]}
      </svg>
    </span>
  );
}

function CardHead({
  icon,
  tone,
  children,
}: {
  icon: keyof typeof ICONS;
  tone: IconTone;
  children: React.ReactNode;
}) {
  return (
    <div className="portal-card-head">
      <PortalIcon name={icon} tone={tone} />
      <h2 className="portal-card-title">{children}</h2>
    </div>
  );
}

function formatMoney(cents: number) {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatDate(dateStr: string) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function PortalHome({
  lead,
  events,
  files,
  messages,
  reps,
  estimates,
  invoices = [],
  companyName,
  companyPhone,
  companyLogo,
  socialLinks,
  documents,
}: {
  lead: Lead;
  events: Event[];
  files: PortalFile[];
  messages: SmsMessage[];
  reps: Profile[];
  estimates: PortalEstimate[];
  invoices?: PortalInvoice[];
  companyName: string;
  companyPhone: string | null;
  companyLogo: string | null;
  /** Ready-made hrefs, already filtered to the profiles that exist. */
  socialLinks: { label: string; href: string }[];
  documents: PortalDoc[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("Overview");
  const [busyEvent, setBusyEvent] = useState("");
  const [error, setError] = useState("");
  const [reschedulingFor, setReschedulingFor] = useState("");
  const [rescheduleNote, setRescheduleNote] = useState("");
  const [messageBody, setMessageBody] = useState("");
  const [sending, setSending] = useState(false);
  // Thumbnails that failed to load, so each one falls back to an icon
  // once rather than retrying on every render.
  const [brokenThumbs, setBrokenThumbs] = useState<Set<string>>(new Set());

  // The stars appear twice (header and footer) and must agree on where
  // they go, so the target is resolved once here.
  const reviewHref = socialLinks.find((l) => l.label === "Google Reviews")?.href;

  const step = journeyStep(lead.stage, estimates);
  const progress = step === null ? null : journeyProgress(step, JOURNEY.length);
  const todayISO = new Date().toISOString().slice(0, 10);
  const upcoming = events.filter((e) => e.date >= todayISO && e.status !== "Cancelled");
  const past = events.filter((e) => e.date < todayISO || e.status === "Cancelled");

  function repName(id: string | null) {
    if (!id) return null;
    const r = reps.find((x) => x.id === id);
    return r?.name || null;
  }

  async function setConfirmed(eventId: string, confirmed: boolean) {
    setBusyEvent(eventId);
    setError("");
    const result = await portalSetAppointmentConfirmed(eventId, confirmed);
    setBusyEvent("");
    if (result?.error) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  async function submitReschedule(eventId: string) {
    setBusyEvent(eventId);
    setError("");
    const result = await portalRequestReschedule(eventId, rescheduleNote);
    setBusyEvent("");
    if (result?.error) {
      setError(result.error);
      return;
    }
    setReschedulingFor("");
    setRescheduleNote("");
    router.refresh();
  }

  async function sendMessage() {
    if (!messageBody.trim()) return;
    setSending(true);
    setError("");
    const result = await portalSendMessage(messageBody);
    setSending(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    setMessageBody("");
    router.refresh();
  }

  const uploadOne = useCallback(async (original: File) => {
    // Shrunk in the browser first: this goes through a server action,
    // which Vercel caps at ~4.5MB — a raw phone photo would 413.
    const file = await downscaleImage(original);
    const fd = new FormData();
    fd.append("file", file);
    const result = await portalUploadFile(fd);
    return result?.error ?? null;
  }, []);
  const { queue, pending: uploading, errors, progressLabel, start } = useUploadQueue(uploadOne);
  const { dragOver, dropProps } = useFileDrop(
    (files) => void startUpload(files),
    uploading
  );

  async function startUpload(files: File[]) {
    setError("");
    await start(files);
    router.refresh();
  }

  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length) void startUpload(files);
  }

  return (
    <div className="portal-shell">
      {/* The dark banner carries the brand and the greeting, and the tab
          bar overlaps its bottom edge -- the same navy as the sign-in
          gate, so the customer lands somewhere that looks like the page
          they signed in from. */}
      <section className="portal-hero">
        <header className="portal-header">
          <div className="portal-header-brand">
            {companyLogo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={companyLogo} alt="" className="portal-logo" />
            )}
            <span className="portal-company">{companyName}</span>
          </div>
          {/* The compact echo of the footer stars. Deliberately not the
              whole social row: the header is fought over by the brand and
              Sign out, and the customer came for their project, not our
              Facebook page. Hidden on narrow screens where even stars
              would crowd the company name. */}
          {socialLinks.length > 0 &&
            (reviewHref ? (
              <a
                href={reviewHref}
                target="_blank"
                rel="noopener noreferrer"
                className="portal-header-stars"
                aria-label="Leave us a five-star review"
              >
                ★★★★★
              </a>
            ) : (
              <span className="portal-header-stars" aria-hidden="true">
                ★★★★★
              </span>
            ))}
          <form action={portalSignOut}>
            <button type="submit" className="portal-signout">
              Sign out
            </button>
          </form>
        </header>

        <div className="portal-hero-body">
          <p className="portal-eyebrow">Your project portal</p>
          <h1 className="portal-greeting">Hi {lead.first_name || leadDisplayName(lead)}</h1>
          {(lead.project_type || step !== null) && (
            <div className="portal-hero-chips">
              {lead.project_type && <span className="portal-hero-chip">{lead.project_type}</span>}
              {step !== null && (
                <span
                  className={
                    step === JOURNEY.length - 1
                      ? "portal-hero-chip portal-hero-chip-done"
                      : "portal-hero-chip portal-hero-chip-now"
                  }
                >
                  {step === JOURNEY.length - 1 ? "✓ " : ""}
                  {JOURNEY[step]}
                </span>
              )}
            </div>
          )}
        </div>
      </section>

      <main className="portal-main">
        <nav className="portal-tabs">
          {(["Overview", "Photos", "Messages"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              className={t === tab ? "portal-tab portal-tab-active" : "portal-tab"}
              onClick={() => setTab(t)}
            >
              {t}
              {t === "Photos" && files.length > 0 && (
                <span className="portal-tab-count">{files.length}</span>
              )}
            </button>
          ))}
        </nav>

        {error && <p className="error-note">{error}</p>}

        {tab === "Overview" && (
          <>
            {step !== null && (
              <section className="portal-card">
                <CardHead icon="status" tone="green">
                  Project status
                </CardHead>
                {progress && (
                  <>
                    <div className="portal-progress-top">
                      <strong>{JOURNEY[step]}</strong>
                      <span>{progress.label}</span>
                    </div>
                    <div className="portal-progress-bar">
                      <i style={{ width: `${progress.percent}%` }} />
                    </div>
                  </>
                )}
                <ol className="portal-journey">
                  {JOURNEY.map((label, i) => (
                    <li
                      key={label}
                      className={
                        i < step
                          ? "portal-step portal-step-done"
                          : i === step
                            ? "portal-step portal-step-current"
                            : "portal-step"
                      }
                    >
                      <span className="portal-step-dot">
                        {i < step ? "✓" : i === step && i === JOURNEY.length - 1 ? "★" : i + 1}
                      </span>
                      <span className="portal-step-label">{label}</span>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {/* The only permanent way back to the document. Before this,
                the estimate was reachable solely through the magic link in
                the original text -- delete that text and a signed contract
                became unreachable. */}
            {estimates.length > 0 && (
              <section className="portal-card">
                <CardHead icon="estimate" tone="blue">
                  {estimates.length === 1 ? "Your estimate" : "Your estimates"}
                </CardHead>
                {estimates.map((e) => {
                  const status = estimateStatusChip(e.status);
                  // Money still owed is the one thing worth surfacing
                  // here rather than a page deeper.
                  const money = estimateMoneyChip(e);
                  return (
                    <a key={e.id} className="portal-est" href={`/portal/estimates/${e.id}`}>
                      <div className="portal-est-main">
                        <div className="portal-est-title">{e.title || "Project estimate"}</div>
                        <div className="portal-est-sub">{e.doc_number}</div>
                        <div className="portal-chips">
                          <span className={`portal-chip portal-chip-${status.tone}`}>
                            {status.label}
                          </span>
                          {money && (
                            <span className={`portal-chip portal-chip-${money.tone}`}>
                              {money.tone === "green" ? "✓ " : ""}
                              {money.label}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="portal-est-side">
                        <span className="portal-est-total">{formatMoney(e.total_cents)}</span>
                        {/* A document waiting on the customer's signature
                            gets a button that says so, in a colour that
                            says so -- "View" in quiet grey asks nothing of
                            anybody, which is exactly how estimates sit
                            unsigned for a week. */}
                        {e.status !== "Signed" && e.status !== "Declined" ? (
                          <span className="portal-est-sign-btn">Review &amp; Sign →</span>
                        ) : money?.tone === "amber" ? (
                          <span className="portal-est-sign-btn">Pay →</span>
                        ) : (
                          <span className="portal-est-go">View →</span>
                        )}
                      </div>
                    </a>
                  );
                })}
              </section>
            )}

            {/* Bills for extras on the job -- a permit fee. Nothing to
                sign, so each one says what's due and goes to its Pay
                button. */}
            {invoices.length > 0 && (
              <section className="portal-card">
                <CardHead icon="estimate" tone="blue">
                  {invoices.length === 1 ? "Your invoice" : "Your invoices"}
                </CardHead>
                {invoices.map((inv) => {
                  const money = invoiceMoneyChip(inv);
                  return (
                    <a key={inv.id} className="portal-est" href={`/portal/estimates/${inv.id}`}>
                      <div className="portal-est-main">
                        <div className="portal-est-title">{inv.title || "Invoice"}</div>
                        <div className="portal-est-sub">{inv.doc_number}</div>
                        <div className="portal-chips">
                          <span className={`portal-chip portal-chip-${money.tone}`}>
                            {money.tone === "green" ? "✓ " : ""}
                            {money.label}
                          </span>
                        </div>
                      </div>
                      <div className="portal-est-side">
                        <span className="portal-est-total">{formatMoney(inv.totalCents)}</span>
                        {money.tone === "green" ? (
                          <span className="portal-est-go">View →</span>
                        ) : (
                          <span className="portal-est-sign-btn">Pay →</span>
                        )}
                      </div>
                    </a>
                  );
                })}
              </section>
            )}

            <section className="portal-card">
              <CardHead icon="calendar" tone="violet">
                Upcoming appointments
              </CardHead>
              {upcoming.length === 0 ? (
                <div className="portal-appt-empty">
                  <p>
                    <strong>Nothing scheduled right now</strong>
                    {companyPhone && "Want to book a visit? Give us a call."}
                  </p>
                  {companyPhone && (
                    <a className="portal-call-btn" href={`tel:${companyPhone.replace(/[^\d+]/g, "")}`}>
                      📞 {companyPhone}
                    </a>
                  )}
                </div>
              ) : (
                upcoming.map((ev) => (
                  <div key={ev.id} className="portal-appt">
                    <div className="portal-appt-when">
                      <strong>{formatDate(ev.date)}</strong>
                      {ev.time && <span> at {formatTimeRange(ev.time, ev.end_time)}</span>}
                    </div>
                    {repName(ev.assigned_to) && (
                      <div className="portal-appt-rep">With {repName(ev.assigned_to)}</div>
                    )}
                    {lead.address && (
                      <div className="portal-appt-rep">
                        <a href={mapsUrl(lead.address)} target="_blank" rel="noopener noreferrer">
                          {lead.address}
                        </a>
                      </div>
                    )}

                    {ev.customer_confirmed ? (
                      <p className="portal-confirmed">✓ You confirmed this appointment</p>
                    ) : (
                      <div className="portal-appt-actions">
                        <button
                          type="button"
                          className="btn-primary small"
                          disabled={busyEvent === ev.id}
                          onClick={() => setConfirmed(ev.id, true)}
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          className="btn-ghost small"
                          disabled={busyEvent === ev.id}
                          onClick={() =>
                            setReschedulingFor(reschedulingFor === ev.id ? "" : ev.id)
                          }
                        >
                          Request a different time
                        </button>
                      </div>
                    )}

                    {reschedulingFor === ev.id && (
                      <div className="portal-reschedule">
                        <textarea
                          rows={2}
                          value={rescheduleNote}
                          onChange={(e) => setRescheduleNote(e.target.value)}
                          placeholder="What times work better for you?"
                        />
                        <button
                          type="button"
                          className="btn-primary small"
                          disabled={busyEvent === ev.id}
                          onClick={() => submitReschedule(ev.id)}
                        >
                          {busyEvent === ev.id ? "Sending…" : "Send request"}
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </section>

            {past.length > 0 && (
              <section className="portal-card">
                <CardHead icon="calendar" tone="slate">
                  Past appointments
                </CardHead>
                {past.map((ev) => (
                  <div key={ev.id} className="portal-appt portal-appt-past">
                    <div className="portal-appt-when">
                      {formatDate(ev.date)}
                      {ev.time && ` at ${formatTimeRange(ev.time, ev.end_time)}`}
                    </div>
                    {ev.status === "Cancelled" && (
                      <div className="portal-appt-rep">Cancelled</div>
                    )}
                  </div>
                ))}
              </section>
            )}

            {/* On Overview rather than behind a tab. "Are they licensed,
                are they insured" is asked early and by everyone, and
                anything a customer has to go looking for is something they
                text and ask about instead -- which is the errand this is
                meant to remove. Expired ones never reach here. */}
            {documents.length > 0 && (
              <section className="portal-card">
                <CardHead icon="shieldCheck" tone="amber">
                  Licence &amp; insurance
                </CardHead>
                <p className="portal-trust">
                  {companyName} is licensed and insured. Tap any document to open it.
                </p>
                <div className="portal-docs">
                  {documents.map((d) => {
                    const insurance = d.kind === "insurance";
                    return (
                      <a
                        key={d.id}
                        className={insurance ? "portal-doc portal-doc-ins" : "portal-doc"}
                        href={d.file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <PortalIcon
                          name={insurance ? "shield" : "badge"}
                          tone={insurance ? "blue" : "amber"}
                        />
                        <span className="portal-doc-text">
                          <span className="portal-doc-title">{d.title}</span>
                          <span className="portal-doc-kind">{docKindLabel(d.kind)}</span>
                        </span>
                        <span className="portal-doc-go" aria-hidden="true">
                          ›
                        </span>
                      </a>
                    );
                  })}
                </div>
              </section>
            )}
          </>
        )}

        {tab === "Photos" && (
          <section className="portal-card">
            <CardHead icon="photo" tone="violet">
              Photos &amp; documents
            </CardHead>
            <label
              className={`portal-upload${dragOver ? " drag-over" : ""}`}
              {...dropProps}
            >
              <input
                type="file"
                accept="image/*,application/pdf"
                multiple
                onChange={handleUpload}
                disabled={uploading}
              />
              <span>
                {uploading
                  ? (progressLabel ?? "Uploading…")
                  : dragOver
                    ? "Drop to upload"
                    : "＋ Add photos or documents — or drag & drop"}
              </span>
              <UploadQueueStrip queue={queue} />
            </label>
            {errors.map((msg) => (
              <p key={msg} className="error-note">
                {msg}
              </p>
            ))}

            {files.length === 0 ? (
              <p className="portal-empty">Nothing shared yet.</p>
            ) : (
              /* Tiles, not a list of file names. "WhatsApp Image
                 2026-07-31 at 12.08.20 PM.jpeg" tells nobody anything --
                 you had to open every one to find the photo you meant,
                 which on a phone is a download each time. */
              <div className="portal-file-grid">
                {files.map((f) => {
                  const isImage =
                    !!f.file_url &&
                    (f.content_type ?? "").startsWith("image/") &&
                    !brokenThumbs.has(f.id);
                  const isPdf = (f.content_type ?? "").includes("pdf");
                  return (
                    <a
                      key={f.id}
                      className="portal-file-tile"
                      href={f.file_url ?? "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <span className="portal-file-thumb">
                        {isImage ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            // A file kept in Google Drive has a URL that
                            // is a viewer page, not an image --
                            // leadPhotoThumbUrl swaps it for Drive's real
                            // thumbnail image. The onError fallback stays
                            // for files that are genuinely gone.
                            src={leadPhotoThumbUrl({
                              file_url: f.file_url!,
                              file_path: f.file_path,
                              storage_provider: f.storage_provider,
                            })}
                            alt={f.file_name}
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            onError={() =>
                              setBrokenThumbs((prev) => new Set(prev).add(f.id))
                            }
                          />
                        ) : (
                          <span className="portal-file-icon" aria-hidden="true">
                            {isPdf ? "📄" : "📎"}
                          </span>
                        )}
                      </span>
                      <span className="portal-file-name">{f.file_name}</span>
                      <span className="portal-file-meta">
                        {f.uploaded_by ? "from your contractor" : "you"} ·{" "}
                        {new Date(f.created_at).toLocaleDateString()}
                      </span>
                    </a>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {tab === "Messages" && (
          <section className="portal-card">
            <CardHead icon="chat" tone="blue">
              Messages
            </CardHead>
            {messages.length === 0 ? (
              <p className="portal-empty">No messages yet — send us a note below.</p>
            ) : (
              <div className="portal-thread">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={
                      m.direction === "inbound"
                        ? "portal-msg portal-msg-mine"
                        : "portal-msg portal-msg-them"
                    }
                  >
                    <div className="portal-msg-body">{m.body}</div>
                    <div className="portal-msg-time">
                      {new Date(m.created_at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="portal-composer">
              <textarea
                rows={3}
                value={messageBody}
                onChange={(e) => setMessageBody(e.target.value)}
                placeholder="Write a message…"
              />
              <button
                type="button"
                className="btn-primary"
                onClick={sendMessage}
                disabled={sending || !messageBody.trim()}
              >
                {sending ? "Sending…" : "Send"}
              </button>
            </div>
          </section>
        )}
      </main>

      {/* Below the content on every tab, not inside a card: it's the
          company's signature line, not project information. Renders only
          when at least one profile is filled in on the admin side. */}
      {socialLinks.length > 0 && (
        <footer className="portal-footer">
          <div className="portal-footer-card">
            <span className="portal-footer-title">Follow {companyName}</span>
            <div className="portal-footer-links">
              {socialLinks.map((l) => (
                <a
                  key={l.label}
                  href={l.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={socialLinkClass(l.label)}
                >
                  {l.label}
                </a>
              ))}
            </div>
            {/* Five stars as the sign-off. When a Google Reviews link is
                on file they take the customer straight there -- the person
                most likely to tap five stars is one who means it. */}
            {reviewHref ? (
              <a
                href={reviewHref}
                target="_blank"
                rel="noopener noreferrer"
                className="portal-footer-stars"
                aria-label="Leave us a five-star review"
              >
                ★★★★★
                <span className="portal-footer-stars-note">
                  Happy with us? Tap the stars to leave a review.
                </span>
              </a>
            ) : (
              <div className="portal-footer-stars" aria-hidden="true">
                ★★★★★
              </div>
            )}
          </div>
        </footer>
      )}
      <footer className="site-footer">
        © 2026 AI Build Pros LLC. All rights reserved.
      </footer>
    </div>
  );
}
