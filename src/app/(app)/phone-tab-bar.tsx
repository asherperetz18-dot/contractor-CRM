"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { isTabActive, type MobileTab } from "@/lib/mobile-tabs";
import { MobileIcon } from "./mobile-icon";

/** The More sheet listens for this and answers with MORE_STATE_EVENT. */
export const MORE_TOGGLE_EVENT = "crm:more-toggle";
export const MORE_STATE_EVENT = "crm:more-state";

/**
 * The phone layout's bottom tab bar (DECISIONS #089): the four pages this
 * person uses most, one thumb-tap away, and More for everything else.
 * Drawn only at phone width (mobile.css); desktop and tablet keep the
 * sidebar. It sits in the app shell's column below the page rather than
 * floating over it, so it never covers the end of a list.
 */
export function PhoneTabBar({ tabs }: { tabs: MobileTab[] }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    const onState = (e: Event) => setMoreOpen(!!(e as CustomEvent<{ open: boolean }>).detail?.open);
    window.addEventListener(MORE_STATE_EVENT, onState);
    return () => window.removeEventListener(MORE_STATE_EVENT, onState);
  }, []);

  return (
    <nav className="phone-tabbar" aria-label="Main">
      {tabs.map((t) => {
        const active = !moreOpen && isTabActive(pathname, t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={"phone-tab" + (active ? " active" : "")}
            data-mtone={t.tone}
            aria-current={active ? "page" : undefined}
          >
            <span className="phone-tab-pill">
              <MobileIcon name={t.icon} />
            </span>
            <span className="phone-tab-label">{t.label}</span>
          </Link>
        );
      })}
      <button
        type="button"
        className={"phone-tab" + (moreOpen ? " active" : "")}
        data-mtone="more"
        aria-expanded={moreOpen}
        aria-haspopup="dialog"
        onClick={() => window.dispatchEvent(new CustomEvent(MORE_TOGGLE_EVENT))}
      >
        <span className="phone-tab-pill">
          <MobileIcon name="more" />
        </span>
        <span className="phone-tab-label">More</span>
      </button>
    </nav>
  );
}
