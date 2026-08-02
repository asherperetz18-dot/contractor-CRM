"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Modal } from "@/components/ui/modal";
import {
  SETTINGS_CATEGORIES,
  SETTINGS_SECTIONS,
  type SettingsCardDef,
} from "@/lib/data/settings-catalog";
import { removeLogo, uploadLogo } from "@/lib/actions/settings";

export function SettingsGrid({ logoUrl }: { logoUrl: string | null }) {
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

  const q = query.trim().toLowerCase();
  const filteredSections = SETTINGS_SECTIONS.map((sec) => ({
    ...sec,
    cards: q
      ? sec.cards.filter((c) => (c.title + " " + c.desc).toLowerCase().includes(q))
      : sec.cards,
  })).filter((sec) => sec.cards.length > 0);

  function openCard(card: SettingsCardDef) {
    if (card.key === "logo") {
      setLogoPreview(logo);
      setLogoFile(null);
      setLogoError("");
    }
    setActiveCard(card);
  }

  function handleLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
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

      <div className="chip-row">
        {SETTINGS_CATEGORIES.map((c) => (
          <span key={c} className="chip settings-chip">
            {c}
          </span>
        ))}
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
                  >
                    <span className="settings-card-icon">{c.icon}</span>
                    <div>
                      <div className="settings-card-title">{c.title}</div>
                      <div className="settings-card-desc">{c.desc}</div>
                    </div>
                  </Link>
                ) : (
                  <div
                    key={c.title}
                    className="settings-card"
                    onClick={() => openCard(c)}
                  >
                    <span className="settings-card-icon">{c.icon}</span>
                    <div>
                      <div className="settings-card-title">{c.title}</div>
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
          <div className="logo-preview-wrap">
            {logoPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoPreview} alt="Company logo preview" className="logo-preview-img" />
            ) : (
              <div className="logo-preview-empty">No logo uploaded</div>
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
