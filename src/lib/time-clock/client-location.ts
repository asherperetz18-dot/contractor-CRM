// Browser-side location helpers shared by the Time Clock buttons and the
// background sharer.

// Fired after any clock action so the sharer re-asks whether to track.
export const TIME_CLOCK_CHANGED = "timeclock:changed";

// One fix for a clock-in/out stamp, or null if the phone won't give one
// quickly. Never blocks the punch itself -- hours matter more than pins.
export function currentFix(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  });
}
