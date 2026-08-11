"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { logActivityPing } from "@/lib/actions/activity";
import { touchDevice } from "@/lib/actions/devices";
import { describeDevice, getOrCreateDeviceId } from "@/lib/device";
import { createClient } from "@/lib/supabase/client";

const SESSION_KEY = "crm-activity-session-id";
const HEARTBEAT_MS = 30000;

// A visible tab is not a working user. Someone who opens the CRM and walks
// away leaves it visible indefinitely, and heartbeats based on visibility
// alone bank that whole stretch as active time. Only ping when the person
// has actually done something recently -- once they go idle the pings stop
// on their own, and the reporting side already discards gaps.
const IDLE_AFTER_MS = 60000;

const INTERACTION_EVENTS = [
  "pointerdown",
  "keydown",
  "scroll",
  "touchstart",
  "mousemove",
  "wheel",
] as const;

function getOrCreateSessionId(): string {
  let id = window.sessionStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.sessionStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

export function ActivityTracker() {
  const pathname = usePathname();

  useEffect(() => {
    logActivityPing(getOrCreateSessionId(), pathname, "pageview");
  }, [pathname]);

  useEffect(() => {
    const sessionId = getOrCreateSessionId();
    // Arriving here is itself activity, so start the clock rather than
    // waiting for the first mouse move.
    let lastInteraction = Date.now();

    // Deliberately just stamps a timestamp -- mousemove and scroll fire
    // constantly, and passive listeners keep scrolling smooth.
    const mark = () => {
      lastInteraction = Date.now();
    };
    for (const evt of INTERACTION_EVENTS) {
      window.addEventListener(evt, mark, { passive: true });
    }

    /**
     * The device this browser is, and whether it is still allowed.
     *
     * Rides the heartbeat that was already running rather than adding a
     * timer of its own. The server can't identify a device on its own --
     * it refreshes tokens on the user's behalf, so every session reaches
     * Supabase looking like the Vercel machine that refreshed it. Only
     * the browser knows, so the browser says.
     */
    const deviceId = getOrCreateDeviceId();
    const deviceLabel = describeDevice(navigator.userAgent);

    async function touch() {
      const res = await touchDevice(deviceId, navigator.userAgent, deviceLabel);
      // Revoked while signed in: end it here. There is no push channel to
      // this browser, so this heartbeat is the only thing that can carry
      // the news -- which is why it takes effect within a heartbeat
      // rather than at once.
      if (res?.revoked) {
        await createClient().auth.signOut();
        window.location.href = "/login";
      }
    }
    touch();

    function ping() {
      const working =
        document.visibilityState === "visible" &&
        Date.now() - lastInteraction < IDLE_AFTER_MS;
      if (working) {
        logActivityPing(sessionId, window.location.pathname, "heartbeat");
        touch();
      }
    }

    const interval = setInterval(ping, HEARTBEAT_MS);
    return () => {
      clearInterval(interval);
      for (const evt of INTERACTION_EVENTS) window.removeEventListener(evt, mark);
    };
  }, []);

  return null;
}
