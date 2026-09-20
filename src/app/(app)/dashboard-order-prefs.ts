"use client";

import { useSyncExternalStore } from "react";
import { DASHBOARD_PANEL_KEYS, mergePanelOrder } from "@/lib/data/dashboard-layout";

/**
 * Which order this browser shows the dashboard boxes in -- the same
 * store funnel-order-prefs is, for the same reasons: the server renders
 * the default order (it cannot know what this browser saved) and the
 * saved order arrives cleanly after hydration. It is the fallback for
 * the profile column (0161), and the pre-migration path.
 */
const KEY = "crm:dashboard-panel-order";

let snapshot: readonly string[] | null = null;
const listeners = new Set<() => void>();

function current(): readonly string[] {
  if (!snapshot) {
    try {
      const raw = localStorage.getItem(KEY);
      snapshot = mergePanelOrder(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      // private mode, or garbage in the key -- default order it is.
      snapshot = DASHBOARD_PANEL_KEYS;
    }
  }
  return snapshot;
}

function write(next: string[]) {
  snapshot = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // forgotten on reload; still applies for this visit.
  }
  for (const notify of listeners) notify();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

const getServerSnapshot = (): readonly string[] => DASHBOARD_PANEL_KEYS;

/** Live panel order; setting it re-renders every subscriber and saves. */
export function useDashboardOrder(): [readonly string[], (next: string[]) => void] {
  const order = useSyncExternalStore(subscribe, current, getServerSnapshot);
  return [order, write];
}
