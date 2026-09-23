"use client";

import { useEffect, useRef, useState } from "react";
import { distanceMeters } from "@/lib/time-clock/geo";
import { TIME_CLOCK_CHANGED } from "@/lib/time-clock/client-location";

// Send a fix at most this often while standing still...
const EVERY_MS = 2 * 60 * 1000;
// ...or sooner once someone has moved this far (arrivals land promptly),
// but never more often than MIN_GAP_MS.
const MOVED_M = 150;
const MIN_GAP_MS = 20 * 1000;

/**
 * Shares the phone's location while its owner is on the clock, on every
 * page of the CRM, and shows that it's doing so. Asks /api/location
 * whether to track when it mounts and after every clock action; the
 * server refuses fixes from anyone off the clock, and answers
 * { tracking: false } to stop it.
 *
 * A browser only reports location while the CRM is on screen -- the
 * installable phone app is what keeps it going in a pocket.
 */
export function LocationSharer() {
  const [tracking, setTracking] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const last = useRef<{ at: number; lat: number; lng: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function ask() {
      const res = await fetch("/api/location").catch(() => null);
      const json = res?.ok ? ((await res.json()) as { tracking?: boolean }) : null;
      if (!cancelled) setTracking(!!json?.tracking);
    }
    ask();
    window.addEventListener(TIME_CLOCK_CHANGED, ask);
    return () => {
      cancelled = true;
      window.removeEventListener(TIME_CLOCK_CHANGED, ask);
    };
  }, []);

  useEffect(() => {
    if (!tracking || !navigator.geolocation) return;
    const watch = navigator.geolocation.watchPosition(
      async (pos) => {
        setBlocked(false);
        const fix = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const now = Date.now();
        const prev = last.current;
        const due =
          !prev ||
          now - prev.at >= EVERY_MS ||
          (now - prev.at >= MIN_GAP_MS && distanceMeters(prev, fix) >= MOVED_M);
        if (!due) return;
        last.current = { at: now, ...fix };
        const res = await fetch("/api/location", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...fix,
            accuracy: pos.coords.accuracy,
            recordedAt: new Date(pos.timestamp).toISOString(),
          }),
        }).catch(() => null);
        if (!res) return;
        const json = (await res.json().catch(() => null)) as { tracking?: boolean } | null;
        if (json && json.tracking === false) setTracking(false);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setBlocked(true);
      },
      { enableHighAccuracy: true, maximumAge: 30000, timeout: 60000 }
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [tracking]);

  if (!tracking) return null;
  return (
    <div className={blocked ? "tc-sharing-pill tc-sharing-blocked" : "tc-sharing-pill"} role="status">
      {blocked
        ? "On the clock · location is blocked — allow it for this site so your arrivals count"
        : "On the clock · sharing location"}
    </div>
  );
}
