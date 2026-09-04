"use client";

import { useSyncExternalStore } from "react";
import type { PopupKind } from "@/lib/popup-shape";

/**
 * Which popups this browser shows, and whether they ding. Everything is
 * ON until the person turns it off -- the ask was "always pop", and a
 * switch nobody has touched should mean exactly that.
 *
 * Per browser, not per account: the same place the text watcher already
 * kept its mute. A dispatcher's two desk screens can differ on purpose.
 */
export type PopupPrefs = Record<PopupKind, boolean> & { sound: boolean };

export const POPUP_KINDS: { key: PopupKind; label: string; hint: string }[] = [
  { key: "message", label: "Texts", hint: "New customer texts, and texts that didn't deliver" },
  { key: "money", label: "Money", hint: "Payments received in the portal" },
  { key: "job", label: "Jobs", hint: "Signatures, proposal views, job steps assigned to you" },
  { key: "lead", label: "Leads", hint: "New leads coming in" },
  { key: "appointment", label: "Appointments", hint: "Appointments booked for you by a teammate" },
];

const KEY = "crm:popup-prefs";
// The text watcher's old mute switch, honored so nobody who muted the
// ding gets it back after this update.
const LEGACY_MUTE_KEY = "crm:text-ding-muted";

const DEFAULTS: PopupPrefs = {
  message: true,
  money: true,
  job: true,
  lead: true,
  appointment: true,
  sound: true,
};

function load(): PopupPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PopupPrefs>;
      return { ...DEFAULTS, ...parsed };
    }
    if (localStorage.getItem(LEGACY_MUTE_KEY) === "1") return { ...DEFAULTS, sound: false };
  } catch {
    // private mode etc. -- defaults it is.
  }
  return DEFAULTS;
}

// One cached snapshot: useSyncExternalStore needs the same reference
// back while nothing changed, or it re-renders forever.
let snapshot: PopupPrefs | null = null;
const listeners = new Set<() => void>();

function current(): PopupPrefs {
  if (!snapshot) snapshot = load();
  return snapshot;
}

export function readPopupPrefs(): PopupPrefs {
  return typeof window === "undefined" ? DEFAULTS : current();
}

export function writePopupPrefs(next: PopupPrefs) {
  snapshot = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
    // Keep the old key in step, so the two never disagree.
    localStorage.setItem(LEGACY_MUTE_KEY, next.sound ? "0" : "1");
  } catch {
    // forgotten on reload; still applies for this session.
  }
  for (const notify of listeners) notify();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}
const getServerSnapshot = () => DEFAULTS;

/** Live view of the switches; re-renders when any component flips one. */
export function usePopupPrefs(): [PopupPrefs, (patch: Partial<PopupPrefs>) => void] {
  const prefs = useSyncExternalStore(subscribe, current, getServerSnapshot);
  const update = (patch: Partial<PopupPrefs>) => writePopupPrefs({ ...current(), ...patch });
  return [prefs, update];
}
