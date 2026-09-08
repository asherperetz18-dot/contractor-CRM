import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * US National Weather Service for now -- free, no key, and every current
 * job site is in the LA area (squarely inside its US-only coverage). This
 * interface exists so a second, global implementation (Open-Meteo) can be
 * added later, behind the same call, the day a non-US tenant signs up --
 * not built yet since nothing needs it today.
 */
export interface WeatherProvider {
  /**
   * Highest chance-of-rain percentage (0-100) across the given window, or
   * null if no forecast data could be resolved for this address (bad
   * address, gridpoint outside coverage, or an upstream failure).
   */
  maxRainProbability(
    address: string,
    fromIso: string,
    toIso: string
  ): Promise<{ pop: number | null; error?: string }>;
}

type GeocodeCacheRow = {
  normalized_address: string;
  lat: number | null;
  lng: number | null;
  nws_office: string | null;
  nws_grid_x: number | null;
  nws_grid_y: number | null;
};

type NwsPeriod = {
  startTime: string;
  endTime: string;
  probabilityOfPrecipitation: { value: number | null } | null;
};

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase().replace(/\s+/g, " ");
}

async function geocodeViaCensus(
  address: string
): Promise<{ lat: number; lng: number } | null> {
  const url =
    "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress" +
    `?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = (await res.json().catch(() => null)) as {
    result?: { addressMatches?: { coordinates?: { x: number; y: number } }[] };
  } | null;
  const match = json?.result?.addressMatches?.[0];
  if (!match?.coordinates) return null;
  return { lat: match.coordinates.y, lng: match.coordinates.x };
}

async function resolveNwsGridpoint(
  lat: number,
  lng: number,
  userAgent: string
): Promise<{ office: string; gridX: number; gridY: number } | null> {
  const res = await fetch(`https://api.weather.gov/points/${lat},${lng}`, {
    headers: { "User-Agent": userAgent, Accept: "application/geo+json" },
  });
  if (!res.ok) return null;
  const json = (await res.json().catch(() => null)) as {
    properties?: { gridId?: string; gridX?: number; gridY?: number };
  } | null;
  const p = json?.properties;
  if (!p?.gridId || p.gridX === undefined || p.gridY === undefined) return null;
  return { office: p.gridId, gridX: p.gridX, gridY: p.gridY };
}

async function fetchHourlyPeriods(
  office: string,
  gridX: number,
  gridY: number,
  userAgent: string
): Promise<NwsPeriod[] | null> {
  const res = await fetch(
    `https://api.weather.gov/gridpoints/${office}/${gridX},${gridY}/forecast/hourly`,
    { headers: { "User-Agent": userAgent, Accept: "application/geo+json" } }
  );
  if (!res.ok) return null;
  const json = (await res.json().catch(() => null)) as {
    properties?: { periods?: NwsPeriod[] };
  } | null;
  return json?.properties?.periods ?? null;
}

function maxPrecipProbability(periods: NwsPeriod[], fromIso: string, toIso: string): number | null {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  let max: number | null = null;
  for (const period of periods) {
    const start = new Date(period.startTime).getTime();
    const end = new Date(period.endTime).getTime();
    if (end <= from || start >= to) continue;
    const value = period.probabilityOfPrecipitation?.value;
    if (typeof value === "number" && (max === null || value > max)) max = value;
  }
  return max;
}

/**
 * Resolves and caches an address's geocode + NWS gridpoint forever (a
 * fixed street address never moves), then answers however many forecast
 * lookups the caller needs against it. `forecastCache` lets one cron pass
 * share a single NWS forecast fetch across every appointment that resolves
 * to the same gridpoint, rather than re-fetching per event.
 */
export class NwsProvider implements WeatherProvider {
  constructor(
    private userAgent: string,
    private admin: ReturnType<typeof createAdminClient> = createAdminClient(),
    private forecastCache: Map<string, NwsPeriod[] | null> = new Map()
  ) {}

  async maxRainProbability(
    address: string,
    fromIso: string,
    toIso: string
  ): Promise<{ pop: number | null; error?: string }> {
    const normalized = normalizeAddress(address);
    if (!normalized) return { pop: null, error: "Empty address." };

    const { data: existing } = await this.admin
      .from("address_geocode")
      .select("*")
      .eq("normalized_address", normalized)
      .maybeSingle();
    let row = existing as GeocodeCacheRow | null;

    if (!row || row.lat === null || row.lng === null) {
      const geocoded = await geocodeViaCensus(address);
      if (!geocoded) return { pop: null, error: "Could not geocode address." };
      const { data: upserted } = await this.admin
        .from("address_geocode")
        .upsert({ normalized_address: normalized, lat: geocoded.lat, lng: geocoded.lng })
        .select("*")
        .maybeSingle();
      row = (upserted as GeocodeCacheRow | null) ?? {
        normalized_address: normalized,
        lat: geocoded.lat,
        lng: geocoded.lng,
        nws_office: null,
        nws_grid_x: null,
        nws_grid_y: null,
      };
    }

    if (!row.nws_office || row.nws_grid_x === null || row.nws_grid_y === null) {
      const grid = await resolveNwsGridpoint(row.lat!, row.lng!, this.userAgent);
      if (!grid) return { pop: null, error: "Address is outside NWS coverage (non-US?)." };
      await this.admin
        .from("address_geocode")
        .update({ nws_office: grid.office, nws_grid_x: grid.gridX, nws_grid_y: grid.gridY })
        .eq("normalized_address", normalized);
      row = { ...row, nws_office: grid.office, nws_grid_x: grid.gridX, nws_grid_y: grid.gridY };
    }

    const gridKey = `${row.nws_office}/${row.nws_grid_x},${row.nws_grid_y}`;
    let periods = this.forecastCache.get(gridKey);
    if (periods === undefined) {
      periods = await fetchHourlyPeriods(row.nws_office!, row.nws_grid_x!, row.nws_grid_y!, this.userAgent);
      this.forecastCache.set(gridKey, periods);
    }
    if (!periods) return { pop: null, error: "NWS forecast fetch failed." };

    return { pop: maxPrecipProbability(periods, fromIso, toIso) };
  }
}
