"use client";

import { useEffect, useRef, useState } from "react";
import { loadGooglePlaces } from "@/components/ui/address-autocomplete-input";
import type { TeamLocation } from "@/app/api/team-locations/route";
import type { LiveStatus } from "@/lib/time-clock/attendance";

const REFRESH_MS = 60 * 1000;

export const STATUS_LABEL: Record<LiveStatus, string> = {
  "at-job": "At a job",
  office: "In the office",
  driving: "Driving",
  stopped: "Stopped, not at a job",
  "no-signal": "Location off",
  break: "On break",
  off: "Off the clock",
};

// Marker fill per status, matching the tc-chip-* colors in globals.css.
const STATUS_COLOR: Record<LiveStatus, string> = {
  "at-job": "#0f766e",
  office: "#475569",
  driving: "#2d5f8a",
  stopped: "#b45309",
  "no-signal": "#9a3412",
  break: "#6d28d9",
  off: "#94a3b8",
};

const ORDER: LiveStatus[] = ["at-job", "driving", "stopped", "no-signal", "office", "break"];

function ago(iso: string | null) {
  if (!iso) return "no location yet";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return mins < 1 ? "updated just now" : `updated ${mins} min ago`;
}

// The slice of the Maps JS API this page draws with.
type LatLngLiteral = { lat: number; lng: number };
type MapsApi = {
  Map: new (el: HTMLElement, opts: { center: LatLngLiteral; zoom: number; mapTypeControl?: boolean; streetViewControl?: boolean }) => {
    fitBounds: (b: unknown) => void;
    setCenter: (c: LatLngLiteral) => void;
  };
  Marker: new (opts: {
    position: LatLngLiteral;
    map: unknown;
    title: string;
    label?: { text: string; color: string; fontSize: string; fontWeight: string };
    icon?: { path: number; scale: number; fillColor: string; fillOpacity: number; strokeColor: string; strokeWeight: number };
  }) => { setMap: (m: unknown) => void };
  LatLngBounds: new () => { extend: (p: LatLngLiteral) => void };
  SymbolPath: { CIRCLE: number };
};

export function TeamMapView() {
  const [people, setPeople] = useState<TeamLocation[] | null>(null);
  const [error, setError] = useState("");
  const [mapFailed, setMapFailed] = useState(false);
  const mapEl = useRef<HTMLDivElement>(null);
  const map = useRef<InstanceType<MapsApi["Map"]> | null>(null);
  const markers = useRef<{ setMap: (m: unknown) => void }[]>([]);
  const fitted = useRef(false);

  // A thin route on a timer, never an action (DECISIONS #062).
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await fetch("/api/team-locations").catch(() => null);
      const json = res ? ((await res.json().catch(() => null)) as { people?: TeamLocation[]; error?: string } | null) : null;
      if (cancelled) return;
      if (!json || json.error) return setError(json?.error ?? "Couldn't load the team.");
      setError("");
      setPeople(json.people ?? []);
    }
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!people || !mapEl.current || !apiKey) return;
    let cancelled = false;
    loadGooglePlaces(apiKey)
      .then(() => {
        if (cancelled || !mapEl.current) return;
        const maps = (window as unknown as { google: { maps: MapsApi } }).google.maps;
        const located = people.filter((p) => p.lat !== null && p.lng !== null);
        if (!map.current) {
          map.current = new maps.Map(mapEl.current, {
            center: located[0] ? { lat: located[0].lat!, lng: located[0].lng! } : { lat: 34.05, lng: -118.25 },
            zoom: 10,
            mapTypeControl: false,
            streetViewControl: false,
          });
        }
        markers.current.forEach((m) => m.setMap(null));
        const bounds = new maps.LatLngBounds();
        markers.current = located.map((p) => {
          const pos = { lat: p.lat!, lng: p.lng! };
          bounds.extend(pos);
          return new maps.Marker({
            position: pos,
            map: map.current,
            title: `${p.name} — ${STATUS_LABEL[p.status]}`,
            label: { text: p.name.slice(0, 1).toUpperCase(), color: "#ffffff", fontSize: "12px", fontWeight: "700" },
            icon: {
              path: maps.SymbolPath.CIRCLE,
              scale: 12,
              fillColor: STATUS_COLOR[p.status],
              fillOpacity: 1,
              strokeColor: "#ffffff",
              strokeWeight: 2,
            },
          });
        });
        // Frame everyone once; after that the office's own pan/zoom stays.
        if (located.length > 1 && !fitted.current) {
          map.current.fitBounds(bounds);
          fitted.current = true;
        }
      })
      .catch(() => setMapFailed(true));
    return () => {
      cancelled = true;
    };
  }, [people]);

  if (error) return <p className="error-note">{error}</p>;
  if (!people) return <p className="empty-hint">Loading…</p>;

  const counts = ORDER.map((s) => [s, people.filter((p) => p.status === s).length] as const).filter(([, n]) => n > 0);

  return (
    <div className="tc-map-page">
      <div className="chip-row">
        {counts.length === 0 && <span className="tc-soft">Nobody is on the clock right now.</span>}
        {counts.map(([s, n]) => (
          <span key={s} className={`tc-chip tc-chip-${s}`}>
            {STATUS_LABEL[s]} · {n}
          </span>
        ))}
      </div>
      <div className="tc-map-layout">
        {mapFailed || !process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ? (
          <div className="tc-map tc-map-empty">The map needs a Google Maps key; the list still shows everyone.</div>
        ) : (
          <div ref={mapEl} className="tc-map" aria-label="Map of the team" />
        )}
        <div className="tc-card tc-people">
          {people.length === 0 && <p className="empty-hint">Nobody is on the clock.</p>}
          {people.map((p) => (
            <div key={p.id} className="tc-person">
              <div className="tc-line">
                <strong>{p.name}</strong>
                <span className={`tc-chip tc-chip-${p.status}`}>{STATUS_LABEL[p.status]}</span>
              </div>
              <div className="tc-soft">
                {p.place ? `${p.place} · ` : ""}
                {ago(p.updatedAt)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
