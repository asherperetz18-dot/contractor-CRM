"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { logActivityPing } from "@/lib/actions/activity";

const SESSION_KEY = "crm-activity-session-id";
const HEARTBEAT_MS = 30000;

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
    function ping() {
      if (document.visibilityState === "visible") {
        logActivityPing(sessionId, window.location.pathname, "heartbeat");
      }
    }
    const interval = setInterval(ping, HEARTBEAT_MS);
    return () => clearInterval(interval);
  }, []);

  return null;
}
