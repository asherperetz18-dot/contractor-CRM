"use client";

import { useSyncExternalStore } from "react";

// A tiny external store fed by the incoming-text watcher's broadcasts.
// The watcher and the sidebar live in separate component trees under
// the server layout, so an event bus is the channel between them --
// and useSyncExternalStore is the React-sanctioned way to read one.
let current = 0;
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  window.addEventListener("crm:inbox-count", (e) => {
    current = (e as CustomEvent<number>).detail ?? 0;
    for (const notify of listeners) notify();
  });
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}
const getSnapshot = () => current;
const getServerSnapshot = () => 0;

/** Conversations waiting on a reply, as counted by the watcher. */
export function useInboxCount(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
