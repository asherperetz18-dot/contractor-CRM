"use client";

import { useEffect, useState, useTransition } from "react";
import { getCompanyDevices, restoreDevice, revokeDevice, type DeviceRow } from "@/lib/actions/devices";
import { getOrCreateDeviceId } from "@/lib/device";

// Anything older than this is not somebody working, it is a browser they
// closed. Kept generous: a rep who is off for a few days has not stopped
// having a phone.
const ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000;

function when(iso: string) {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function DevicesView() {
  const [devices, setDevices] = useState<DeviceRow[] | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await getCompanyDevices(getOrCreateDeviceId());
      if (cancelled) return;
      if (res.error) return setError(res.error);
      setDevices(res.devices ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  function act(fn: () => Promise<{ error?: string }>) {
    setError("");
    startTransition(async () => {
      const res = await fn();
      if (res?.error) return setError(res.error);
      setReloadKey((k) => k + 1);
    });
  }

  if (error) return <p className="error-note">{error}</p>;
  if (!devices) return <p className="empty-hint">Loading…</p>;

  // Grouped by person, because the question is always "how many is this
  // one person on", never "what is the newest device in the company".
  const byPerson = new Map<string, DeviceRow[]>();
  for (const d of devices) {
    if (!byPerson.has(d.personName)) byPerson.set(d.personName, []);
    byPerson.get(d.personName)!.push(d);
  }

  if (devices.length === 0) {
    return (
      <p className="empty-hint">
        Nothing recorded yet. A device appears here the next time someone uses the CRM
        on it — existing sessions are picked up automatically.
      </p>
    );
  }

  return (
    <div>
      <p className="hint-note" style={{ marginBottom: 14 }}>
        A device is a browser someone signed in on. Revoking one signs it out within
        about a minute — it takes effect on that device&apos;s next check-in, not
        instantly. Their other devices are unaffected.
      </p>

      {[...byPerson.entries()].map(([person, list]) => {
        const live = list.filter(
          (d) => !d.revoked_at && Date.now() - new Date(d.last_seen_at).getTime() < ACTIVE_WINDOW_MS
        );
        return (
          <div key={person} className="ta-panel" style={{ marginBottom: 14 }}>
            <div className="module-toolbar" style={{ marginBottom: 10 }}>
              <div>
                <strong>{person}</strong>{" "}
                <span className="est-tax-note">
                  {live.length === 0
                    ? "no devices active today"
                    : live.length === 1
                      ? "1 device active today"
                      : `${live.length} devices active today`}
                </span>
              </div>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Device</th>
                  <th>Last used</th>
                  <th>First seen</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {list.map((d) => (
                  <tr key={d.id} className={d.revoked_at ? "rv-cell-dirty" : ""}>
                    <td>
                      {d.label}
                      {d.isCurrent && <span className="est-tax-note"> · this device</span>}
                      {d.revoked_at && <span className="est-tax-note"> · revoked</span>}
                    </td>
                    <td>{when(d.last_seen_at)}</td>
                    <td>{when(d.first_seen_at)}</td>
                    <td className="right">
                      {d.revoked_at ? (
                        <button
                          className="btn-ghost small"
                          disabled={pending}
                          onClick={() => act(() => restoreDevice(d.id))}
                        >
                          Allow again
                        </button>
                      ) : (
                        <button
                          className="btn-ghost small"
                          disabled={pending}
                          onClick={() => {
                            // Revoking your own device signs you out of the
                            // screen you are standing on, which is a strange
                            // thing to do by accident.
                            const msg = d.isCurrent
                              ? "This is the device you're using. Revoking it will sign you out. Continue?"
                              : `Sign ${person} out of their ${d.label}?`;
                            if (window.confirm(msg)) act(() => revokeDevice(d.id));
                          }}
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
