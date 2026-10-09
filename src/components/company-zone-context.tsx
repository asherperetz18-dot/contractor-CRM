"use client";

import { createContext, useCallback, useContext } from "react";
import { isoDateInZone } from "@/lib/company-clock";
import { isoDay } from "@/lib/data/date-range";

/**
 * The company's IANA zone, handed down once by the app layout from the
 * cached company row it already reads (the same way as the time format).
 * Null outside the app shell.
 */
const CompanyZoneContext = createContext<string | null>(null);

export function CompanyZoneProvider({
  value,
  children,
}: {
  value: string;
  children: React.ReactNode;
}) {
  return <CompanyZoneContext.Provider value={value}>{children}</CompanyZoneContext.Provider>;
}

/**
 * Today on the company's calendar, read when it's called -- a default
 * date, the Calendar's today. The same day on the server's first draw
 * and in the browser, so it hydrates cleanly; the UTC date
 * (`toISOString`) it replaces was already tomorrow from 5pm Pacific.
 * Outside the app shell, the browser's own day.
 */
export function useCompanyToday(): () => string {
  const zone = useContext(CompanyZoneContext);
  return useCallback(() => (zone ? isoDateInZone(new Date(), zone) : isoDay(new Date())), [zone]);
}
