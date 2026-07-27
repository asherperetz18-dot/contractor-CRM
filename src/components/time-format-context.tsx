"use client";

import { createContext, useContext } from "react";
import type { TimeFormat } from "@/lib/data/types";

const TimeFormatContext = createContext<TimeFormat>("12h");

export function TimeFormatProvider({
  value,
  children,
}: {
  value: TimeFormat;
  children: React.ReactNode;
}) {
  return <TimeFormatContext.Provider value={value}>{children}</TimeFormatContext.Provider>;
}

export function useTimeFormat(): TimeFormat {
  return useContext(TimeFormatContext);
}
