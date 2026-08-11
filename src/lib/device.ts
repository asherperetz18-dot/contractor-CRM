/**
 * Identifying the machine someone is signed in on.
 *
 * Not a fingerprint, and deliberately not trying to be: this is a random
 * id the browser stores and hands back. It identifies a browser profile,
 * which is the closest honest proxy for "a device" and is the same thing
 * a user means when they say they are logged in on their phone.
 *
 * localStorage, not sessionStorage. The app's existing activity session
 * ids use sessionStorage, which is per tab -- two tabs on one laptop
 * already look like two sessions there, so it can never answer how many
 * devices someone is on. localStorage survives tabs and restarts, and
 * resets when they clear site data, which reads as a new device and is
 * the right answer anyway.
 */
const DEVICE_KEY = "crm.device.id";

export function getOrCreateDeviceId(): string {
  try {
    let id = window.localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      window.localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    // Private mode, or storage blocked. A per-load id is still better
    // than nothing: the device shows up as active, it just will not be
    // recognised as the same one next time.
    return crypto.randomUUID();
  }
}

/**
 * A user-agent string turned into something a person can recognise in a
 * list -- "iPhone · Safari" rather than 180 characters of Mozilla/5.0.
 *
 * Order matters. Chrome on iOS contains "CriOS" and also "Safari";
 * Edge contains "Chrome"; Chrome contains "Safari". Each check therefore
 * has to come before the one it would otherwise be mistaken for.
 */
export function describeDevice(ua: string): string {
  const platform = /iPhone/i.test(ua)
    ? "iPhone"
    : /iPad/i.test(ua)
      ? "iPad"
      : /Android/i.test(ua)
        ? "Android"
        : /Macintosh|Mac OS X/i.test(ua)
          ? "Mac"
          : /Windows/i.test(ua)
            ? "Windows"
            : /Linux/i.test(ua)
              ? "Linux"
              : "Unknown device";

  const browser = /Edg\//i.test(ua)
    ? "Edge"
    : /CriOS|Chrome\//i.test(ua)
      ? "Chrome"
      : /FxiOS|Firefox\//i.test(ua)
        ? "Firefox"
        : /Safari\//i.test(ua)
          ? "Safari"
          : null;

  return browser ? `${platform} · ${browser}` : platform;
}
