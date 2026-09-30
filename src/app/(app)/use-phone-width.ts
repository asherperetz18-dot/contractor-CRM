"use client";

import { useSyncExternalStore } from "react";

// The phone layout's breakpoint (mobile.css §6, DECISIONS #089), for the
// few places that must not even mount their phone-only part on a wider
// screen -- because that part fetches (the lead window's header).
const QUERY = "(max-width: 700px)";

function subscribe(onChange: () => void) {
  const m = window.matchMedia(QUERY);
  m.addEventListener("change", onChange);
  return () => m.removeEventListener("change", onChange);
}

export function usePhoneWidth(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false
  );
}
