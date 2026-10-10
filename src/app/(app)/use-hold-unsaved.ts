"use client";

import { useEffect, useRef } from "react";
import { holdUnsaved } from "@/lib/unsaved-work";

/**
 * While `dirty`, the window's unsaved work is held app-wide: a popup
 * alert runs `leave` (the window's own question) before navigating, and
 * the browser asks before a reload or closing the tab (DECISIONS #203).
 */
export function useHoldUnsaved(dirty: boolean, leave: () => boolean | Promise<boolean>) {
  // The latest check, so a hold taken on one render asks with today's state.
  const latest = useRef(leave);
  useEffect(() => {
    latest.current = leave;
  });
  useEffect(() => (dirty ? holdUnsaved(() => latest.current()) : undefined), [dirty]);
}
