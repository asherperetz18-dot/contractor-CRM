"use client";

import { useSyncExternalStore } from "react";
import { FUNNEL_CARD_KEYS, mergeSavedOrder } from "@/lib/data/funnel-order";

/**
 * Which order this browser shows the funnel cards in. Per browser, not
 * per account -- the same choice popup-prefs made, for the same reason:
 * two desk screens can differ on purpose, and a cosmetic preference is
 * not worth a schema and a roundtrip.
 *
 * Same store shape as popup-prefs: useSyncExternalStore so the server
 * renders the default order (it cannot know what this browser saved)
 * and the saved order arrives cleanly after hydration -- lint forbids
 * the setState-in-effect version of that dance.
 */
const KEY = "crm:est-funnel-order";

// One cached snapshot: useSyncExternalStore needs the same reference
// back while nothing changed, or it re-renders forever.
let snapshot: readonly string[] | null = null;
const listeners = new Set<() => void>();

function current(): readonly string[] {
  if (!snapshot) {
    try {
      const raw = localStorage.getItem(KEY);
      snapshot = mergeSavedOrder(FUNNEL_CARD_KEYS, raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      // private mode, or garbage in the key -- default order it is.
      snapshot = FUNNEL_CARD_KEYS;
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

const getServerSnapshot = (): readonly string[] => FUNNEL_CARD_KEYS;

/** Live card order; setting it re-renders every subscriber and saves. */
export function useFunnelOrder(): [readonly string[], (next: string[]) => void] {
  const order = useSyncExternalStore(subscribe, current, getServerSnapshot);
  return [order, write];
}
