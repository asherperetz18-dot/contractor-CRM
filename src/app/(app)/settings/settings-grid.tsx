"use client";

import { useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Modal } from "@/components/ui/modal";
import {
  SETTINGS_CATEGORIES,
  SETTINGS_SECTIONS,
  type SettingsCardDef,
} from "@/lib/data/settings-catalog";
import { pushRecent, recentId, resolveRecents } from "@/lib/settings-recents";
import { removeLogo, uploadLogo } from "@/lib/actions/settings";
import { useFileDrop } from "@/components/uploads/file-drop";

// Per browser, not per account — same store shape as popup-prefs. The
// list logic is in settings-recents.ts where it is tested; this is only
// the storage, and losing it (private mode) just means an empty row.
const RECENTS_KEY = "crm:settings-recents";

function loadRecents(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]");
    if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    // private mode etc. — the row just starts empty.
  }
  return [];
}

// One cached snapshot, per popup-prefs: useSyncExternalStore needs the
// same reference back while nothing changed, or it re-renders forever.
let recentsSnapshot: string[] | null = null;
const recentsListeners = new Set<() => void>();

function currentRecents(): string[] {
  if (!recentsSnapshot) recentsSnapshot = loadRecents();
  return recentsSnapshot;
}

function writeRecents(next: string[]) {
  recentsSnapshot = next;
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // forgotten on reload; still shows for this visit.
  }
  for (const notify of recentsListeners) notify();
}

function subscribeRecents(onChange: () => void) {
  recentsListeners.add(onChange);
  return () => {
    recentsListeners.delete(onChange);
  };
}

const NO_RECENTS: string[] = [];
const getServerRecents = () => NO_RECENTS;

export function SettingsGrid({
  logoUrl,
  isAdmin,
}: {
  logoUrl: string | null;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [activeCard, setActiveCard] = useState<SettingsCardDef | null>(null);
  const [logo, setLogo] = useState(logoUrl);
  const [logoPreview, setLogoPreview] = useState<string | null>(logoUrl);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoError, setLogoError] = useState("");
  const [pending, setPending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Empty on the server render, this browser's history after hydration
  // — localStorage is local, so the first paint can't know it.
  const recents = useSyncExternalStore(subscribeRecents, currentRecents, getServerRecents);

  function remember(card: SettingsCardDef) {
    const id = recentId(card);
    if (id === null) return;
    writeRecents(pushRecent(currentRecents(), id));
  }

  function clearRecents() {
    writeRecents(NO_RECENTS);
  }

  const recentCards = resolveRecents(recents, SETTINGS_SECTIONS, isAdmin);

  const q = query.trim().toLowerCase();
  const filteredSections = SETTINGS_SECTIONS.map((sec) => ({
    ...sec,
    // Admin-only cards are dropped before the search filter, so they
    // can't be surfaced by typing their name either.
    cards: sec.cards
      .filter((c) => !c.adminOnly || isAdmin)
      .filter((c) => !q || (c.title + " " + c.desc).toLowerCase().includes(q)),
  })).filter((sec) => sec.cards.length > 0);

  function openCard(card: SettingsCardDef) {
    remember(card); // no-ops for a SOON card — nothing there to return to
    if (card.key === "logo") {
      setLogoPreview(logo);
      setLogoFile(null);
      setLogoError("");
    }
    setActiveCard(card);
  }

  function pickLogo(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setLogoError("Please choose an image file.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setLogoError("Image is too large — please use one under 2MB.");
      return;
    }
    setLogoError("");
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
  }

  function handleLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    pickLogo(e.target.files?.[0]);
  }

  // The logo can be dragged straight onto the preview box.
  const { dragOver: logoDragOver, dropProps: logoDropProps } = useFileDrop(
    (files) => pickLogo(files[0]),
    pending
  );

  async function saveLogo() {
    if (!logoFile) return;
    setPending(true);
    const formData = new FormData();
    formData.set("file", logoFile);
    const result = await uploadLogo(formData);
    setPending(false);
    if (result?.error) {
      setLogoError(result.error);
      return;
    }
    setLogo(result.url ?? null);
    setActiveCard(null);
    startTransition(() => router.refresh());
  }

  async function handleRemoveLogo() {
    setPending(true);
    const result = await removeLogo();
    setPending(false);
    if (result?.error) {
      setLogoError(result.error);
      return;
    }
    setLogo(null);
    setLogoPreview(null);
    setLogoFile(null);
    startTransition(() => router.refresh());
  }

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Settings</h1>
          <p className="module-sub">Search or browse all company configuration</p>
        </div>
      </div>

      <input
        className="settings-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search settings"
      />

      {/* Shortcut row: the last cards opened in this browser, newest
          first, until cleared. The static category labels only hold the
          spot while there's no history yet. */}
      <div className="chip-row">
        {recentCards.length === 0 ? (
          SETTINGS_CATEGORIES.map((c) => (
            <span key={c} className="chip settings-chip">
              {c}
            </span>
          ))
        ) : (
          <>
            {recentCards.map((c) =>
              c.href ? (
                <Link
                  key={c.title}
                  href={c.href}
                  className="chip settings-recent-chip"
                  onClick={() => remember(c)}
                >
                  {c.icon} {c.title}
                </Link>
              ) : (
                <button
                  key={c.title}
                  type="button"
                  className="chip settings-recent-chip"
                  onClick={() => openCard(c)}
                >
                  {c.icon} {c.title}
                </button>
              )
            )}
            <span className="chip-row-end">
              <button
                type="button"
                className="chip settings-recents-clear"
                onClick={clearRecents}
              >
                Clear
              </button>
            </span>
          </>
        )}
      </div>

      {filteredSections.length === 0 ? (
        <div className="empty-state">
          <p className="empty-label">No settings match</p>
          <p className="empty-hint">Try a different search term.</p>
        </div>
      ) : (
        filteredSections.map((sec) => (
          <div key={sec.category} className="settings-section">
            <div className="settings-section-head">
              <span className="settings-section-title">
                {sec.category.toUpperCase()}
              </span>
              <span className="settings-section-hint">{sec.hint}</span>
            </div>
            <div className="settings-grid">
              {sec.cards.map((c) =>
                c.href ? (
                  <Link
                    key={c.title}
                    href={c.href}
                    className="settings-card"
                    style={{ textDecoration: "none", color: "inherit" }}
                    onClick={() => remember(c)}
                  >
                    <span className="settings-card-icon">{c.icon}</span>
                    <div>
                      <div className="settings-card-title">{c.title}</div>
                      <div className="settings-card-desc">{c.desc}</div>
                    </div>
                  </Link>
                ) : (
                  // A card with no page behind it. Marked before it is
                  // clicked rather than after: 53 of these look identical
                  // to the 26 that work, so the only way to find out was
                  // to open one and be told it does nothing. On a screen
                  // being shown to other contractors that reads as a
                  // product two thirds finished rather than one with a
                  // roadmap.
                  <div
                    key={c.title}
                    className="settings-card settings-card-soon"
                    onClick={() => openCard(c)}
                  >
                    <span className="settings-card-icon">{c.icon}</span>
                    <div>
                      <div className="settings-card-title">
                        {c.title} <span className="settings-soon-tag">SOON</span>
                      </div>
                      <div className="settings-card-desc">{c.desc}</div>
                    </div>
                  </div>
                )
              )}
            </div>
          </div>
        ))
      )}

      {activeCard?.key === "logo" && (
        <Modal title="Logo" onClose={() => setActiveCard(null)}>
          <p className="hint-note" style={{ marginTop: 0 }}>
            Upload your company logo — it&apos;ll appear in the sidebar across the
            app.
          </p>
          <div
            className={`logo-preview-wrap panel-drop${logoDragOver ? " drag-over" : ""}`}
            {...logoDropProps}
          >
            {logoPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoPreview} alt="Company logo preview" className="logo-preview-img" />
            ) : (
              <div className="logo-preview-empty">
                {logoDragOver ? "Drop the logo here" : "No logo uploaded — drag & drop one here"}
              </div>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleLogoFile}
            className="logo-file-input"
          />
          {logoError && <p className="logo-error">{logoError}</p>}
          <div className="modal-actions">
            <div className="modal-actions-left">
              {logo && (
                <button
                  className="btn-danger-ghost"
                  onClick={handleRemoveLogo}
                  disabled={pending}
                >
                  Remove
                </button>
              )}
            </div>
            <div>
              <button className="btn-ghost" onClick={() => setActiveCard(null)}>
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={saveLogo}
                disabled={pending || !logoFile}
              >
                {pending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {activeCard && !activeCard.key && (
        <Modal title={activeCard.title} onClose={() => setActiveCard(null)}>
          <p className="hint-note" style={{ marginTop: 0 }}>{activeCard.desc}</p>
          <p className="hint-note">
            This setting isn&apos;t wired up yet — it&apos;s here to show where
            it&apos;ll live.
          </p>
          <div className="modal-actions">
            <div />
            <div>
              <button className="btn-primary" onClick={() => setActiveCard(null)}>
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
