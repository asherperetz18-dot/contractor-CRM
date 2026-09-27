"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { Capacitor } from "@capacitor/core";
import { webOnlyView } from "@/lib/app-store/web-only";

// Where the page runs never changes after load, so there is nothing to
// subscribe to. The server (and the first hydration paint) can't know,
// hence null there.
const emptySubscribe = () => () => {};

/**
 * Shows its children on the website and `fallback` inside the phone app.
 *
 * For anything that signs a company up for, renews, or manages the AI
 * Build Pro subscription: Google Play requires in-app subscriptions to
 * go through Play Billing and bars pointing people to another way to
 * pay, so the app must not show them (DECISIONS #087). A fallback must
 * not point at the website to pay either. `no-sales-in-app.test.ts`
 * fails on a screen that sells without this wrapper.
 */
export function WebOnly({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  const inApp = useSyncExternalStore(emptySubscribe, () => Capacitor.isNativePlatform(), () => null);
  const view = webOnlyView(inApp);
  if (view === "content") return <>{children}</>;
  if (view === "fallback") return <>{fallback}</>;
  return null;
}
