"use client";

import { useEffect, useRef, useState } from "react";
import { Capacitor, CapacitorHttp, registerPlugin } from "@capacitor/core";
import { fixDue } from "@/lib/time-clock/send-policy";
import { TIME_CLOCK_CHANGED } from "@/lib/time-clock/client-location";

// The slice of the phone app's plugins this uses (mobile/ in the repo).
type NativeFix = { latitude: number; longitude: number; accuracy: number; time: number | null };
type BackgroundGeolocationPlugin = {
  addWatcher(
    options: { backgroundMessage?: string; backgroundTitle?: string; requestPermissions?: boolean; stale?: boolean; distanceFilter?: number },
    callback: (fix?: NativeFix, error?: { code?: string }) => void
  ): Promise<string>;
  removeWatcher(options: { id: string }): Promise<void>;
  openSettings(): Promise<void>;
};
type LocalNotificationsPlugin = { requestPermissions(): Promise<unknown> };

const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>("BackgroundGeolocation");
const LocalNotifications = registerPlugin<LocalNotificationsPlugin>("LocalNotifications");

type Fix = { lat: number; lng: number; accuracy: number | null; recordedAt: string };

// Inside the phone app, posts go through the native HTTP stack: Android
// throttles WebView requests after five minutes in the background.
async function postFix(fix: Fix): Promise<{ tracking?: boolean } | null> {
  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.post({
      url: `${window.location.origin}/api/location`,
      headers: { "Content-Type": "application/json" },
      data: fix,
    }).catch(() => null);
    return res ? (res.data as { tracking?: boolean }) : null;
  }
  const res = await fetch("/api/location", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fix),
  }).catch(() => null);
  return res ? ((await res.json().catch(() => null)) as { tracking?: boolean } | null) : null;
}

/**
 * Shares the phone's location while its owner is on the clock, on every
 * page of the CRM, and shows that it's doing so. Asks /api/location
 * whether to track when it mounts and after every clock action; the
 * server refuses fixes from anyone off the clock, and answers
 * { tracking: false } to stop it.
 *
 * In a browser, fixes only come while the CRM is on screen. Inside the
 * installable phone app, the background-location plugin keeps them
 * coming with the phone locked (Android shows an "On the clock"
 * notification while it does).
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
    if (!tracking) return;

    async function onFix(fix: Fix) {
      setBlocked(false);
      const now = Date.now();
      if (!fixDue(last.current, fix, now)) return;
      last.current = { at: now, lat: fix.lat, lng: fix.lng };
      const json = await postFix(fix);
      if (json && json.tracking === false) setTracking(false);
    }

    if (Capacitor.isNativePlatform()) {
      let watcherId: string | null = null;
      let stopped = false;
      // Android 13+ hides the "On the clock" notification without this.
      LocalNotifications.requestPermissions().catch(() => null);
      BackgroundGeolocation.addWatcher(
        {
          backgroundTitle: "On the clock",
          backgroundMessage: "Sharing your location with the office until you clock out.",
          requestPermissions: true,
          stale: false,
          // Every fix; fixDue decides what's worth sending, and standing
          // still must still report or the office sees "Location off".
          distanceFilter: 0,
        },
        (fix, error) => {
          if (error) {
            if (error.code === "NOT_AUTHORIZED") setBlocked(true);
            return;
          }
          if (!fix) return;
          onFix({
            lat: fix.latitude,
            lng: fix.longitude,
            accuracy: fix.accuracy,
            recordedAt: new Date(fix.time ?? Date.now()).toISOString(),
          });
        }
      ).then((id) => {
        if (stopped) BackgroundGeolocation.removeWatcher({ id });
        else watcherId = id;
      });
      return () => {
        stopped = true;
        if (watcherId) BackgroundGeolocation.removeWatcher({ id: watcherId });
      };
    }

    if (!navigator.geolocation) return;
    const watch = navigator.geolocation.watchPosition(
      (pos) =>
        onFix({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          recordedAt: new Date(pos.timestamp).toISOString(),
        }),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setBlocked(true);
      },
      { enableHighAccuracy: true, maximumAge: 30000, timeout: 60000 }
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [tracking]);

  if (!tracking) return null;
  if (blocked) {
    return (
      <div className="tc-sharing-pill tc-sharing-blocked" role="status">
        On the clock · location is blocked — allow it so your arrivals count
        {Capacitor.isNativePlatform() && (
          <button type="button" className="tc-pill-btn" onClick={() => BackgroundGeolocation.openSettings()}>
            Open settings
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="tc-sharing-pill" role="status">
      On the clock · sharing location
    </div>
  );
}
