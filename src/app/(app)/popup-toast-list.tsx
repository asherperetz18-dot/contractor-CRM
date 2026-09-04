"use client";

import type { PopupToast } from "@/lib/popup-shape";
import { POPUP_KINDS, type PopupPrefs } from "./popup-prefs";

/**
 * The corner stack, as pure markup: the watcher decides WHAT is showing,
 * this decides how it looks. Kept free of hooks and data so it can be
 * rendered on its own for a screenshot or a test.
 */
export function PopupToastList({
  toasts,
  awaiting,
  sound,
  onOpen,
  onDismiss,
  onToggleSound,
}: {
  toasts: PopupToast[];
  /** Conversations waiting in the Reply Inbox, for the line under the stack. */
  awaiting: number;
  sound: boolean;
  onOpen: (t: PopupToast) => void;
  onDismiss: (id: string) => void;
  onToggleSound: () => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div className="text-toast-wrap" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`text-toast popup-toast popup-toast-${t.kind}`}>
          <button className="text-toast-body" onClick={() => onOpen(t)}>
            <span className="text-toast-title">
              {t.icon} {t.title}
            </span>
            {t.body && <span className="text-toast-preview">{t.body}</span>}
          </button>
          <div className="text-toast-side">
            <button
              className="icon-btn"
              aria-label={sound ? "Mute alert sound" : "Unmute alert sound"}
              title={sound ? "Sound on — tap to mute" : "Sound off — tap to unmute"}
              onClick={onToggleSound}
            >
              {sound ? "🔔" : "🔕"}
            </button>
            <button className="icon-btn" aria-label="Dismiss" onClick={() => onDismiss(t.id)}>
              ✕
            </button>
          </div>
        </div>
      ))}
      {awaiting > 0 && (
        <div className="text-toast-more">
          {awaiting} conversation{awaiting === 1 ? "" : "s"} waiting in the Reply Inbox
        </div>
      )}
    </div>
  );
}

function Switch({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className="ur-toggle-btn"
      onClick={onToggle}
    >
      <span className={"toggle-track" + (on ? " toggle-on" : "")}>
        <span className="toggle-thumb" />
      </span>
    </button>
  );
}

/** The "⚙ Popups" switches inside the bell menu: one per kind, plus sound. */
export function PopupPrefsPanel({
  prefs,
  onChange,
}: {
  prefs: PopupPrefs;
  onChange: (patch: Partial<PopupPrefs>) => void;
}) {
  return (
    <div className="bell-prefs">
      <p className="bell-prefs-hint">
        Pop up on this screen when it happens. Applies to this browser.
      </p>
      {POPUP_KINDS.map((k) => (
        <div key={k.key} className="bell-pref-row">
          <span className="bell-pref-text">
            <span className="bell-pref-label">{k.label}</span>
            <span className="bell-pref-hint">{k.hint}</span>
          </span>
          <Switch
            on={prefs[k.key]}
            label={`${k.label} popups`}
            onToggle={() => onChange({ [k.key]: !prefs[k.key] })}
          />
        </div>
      ))}
      <div className="bell-pref-row">
        <span className="bell-pref-text">
          <span className="bell-pref-label">Sound</span>
          <span className="bell-pref-hint">A short ding with each popup</span>
        </span>
        <Switch on={prefs.sound} label="Popup sound" onToggle={() => onChange({ sound: !prefs.sound })} />
      </div>
    </div>
  );
}
