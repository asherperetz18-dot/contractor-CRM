"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/lib/actions/auth";
import type { MobileIconName, MoreSection } from "@/lib/mobile-tabs";
import { MobileIcon, type ChromeIconName } from "./mobile-icon";
import { MORE_STATE_EVENT, MORE_TOGGLE_EVENT } from "./phone-tab-bar";

// The top bar's tools, by the data-tool key the layout wraps each in.
// On a phone their icons are hidden (mobile.css) and these rows stand in
// for them: a tap closes the sheet and clicks the real, hidden button, so
// every tool still opens from where it has always lived -- one instance,
// its own panels and its once-a-day daily brief untouched. The dialer is
// not here: it stays in the phone's top bar (DECISIONS #109).
const TOOLS: { key: string; label: string; icon: MobileIconName | ChromeIconName; tone: string }[] = [
  { key: "ai", label: "AI assistant", icon: "spark", tone: "schedule" },
  { key: "daily-brief", label: "Daily brief", icon: "sun", tone: "accounting" },
  { key: "live-users", label: "Who's online", icon: "online", tone: "staff" },
  { key: "screen-share", label: "Share my screen", icon: "screen", tone: "dispatch" },
  { key: "request-screen", label: "See a teammate's screen", icon: "eye", tone: "dispatch" },
  { key: "admin-tools", label: "Admin tools", icon: "tools", tone: "home" },
  { key: "help", label: "Video tutorials", icon: "video", tone: "production" },
];

function toolTrigger(key: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.tool-slot[data-tool="${key}"] .topbar-icon-btn`);
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/**
 * Everything the bottom tabs leave out (DECISIONS #089): every page the
 * person can open, as colored tiles by department; the top bar's tools;
 * the account (company switcher, sign out); the legal links Google Play
 * wants reachable in the app. Opened by the tab bar's More button.
 */
export function MoreSheet({
  sections,
  userName,
  companyName,
  version,
  companySwitcher,
}: {
  sections: MoreSection[];
  userName: string;
  companyName: string;
  version: string;
  companySwitcher?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [tools, setTools] = useState<typeof TOOLS>([]);
  const pathname = usePathname();
  const [lastPathname, setLastPathname] = useState(pathname);
  const closeRef = useRef<HTMLButtonElement>(null);

  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setOpen(false);
  }

  useEffect(() => {
    function onToggle() {
      // Which tools this person has is whatever the top bar rendered for
      // them -- read at open, so this list can never drift from it.
      setTools(TOOLS.filter((t) => toolTrigger(t.key)));
      setOpen((o) => !o);
    }
    window.addEventListener(MORE_TOGGLE_EVENT, onToggle);
    return () => window.removeEventListener(MORE_TOGGLE_EVENT, onToggle);
  }, []);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent(MORE_STATE_EVENT, { detail: { open } }));
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  function runTool(key: string) {
    setOpen(false);
    // After the sheet is gone, so the tool's panel opens on a clear screen.
    requestAnimationFrame(() => toolTrigger(key)?.click());
  }

  return (
    <>
      <div className="more-backdrop" onClick={() => setOpen(false)} />
      <div className="more-sheet" role="dialog" aria-modal="true" aria-labelledby="more-sheet-title">
        <div className="more-head">
          <h2 id="more-sheet-title" className="more-title">
            More
          </h2>
          <button
            ref={closeRef}
            type="button"
            className="more-close"
            aria-label="Close"
            onClick={() => setOpen(false)}
          >
            <MobileIcon name="close" />
          </button>
        </div>

        <div className="more-body">
          {sections.map((s) => (
            <section key={s.label} className="more-section" data-mtone={s.tone}>
              <h3 className="more-section-title">{s.label}</h3>
              <div className="more-grid">
                {s.items.map((i) => (
                  <Link
                    key={i.href}
                    href={i.href}
                    className="more-tile"
                    aria-current={pathname === i.href ? "page" : undefined}
                    onClick={() => setOpen(false)}
                  >
                    <span className="more-tile-icon">
                      <MobileIcon name={i.icon} />
                    </span>
                    <span className="more-tile-label">{i.label}</span>
                  </Link>
                ))}
              </div>
            </section>
          ))}

          {tools.length > 0 && (
            <section className="more-section" data-mtone="tools">
              <h3 className="more-section-title">Tools</h3>
              <div className="more-list">
                {tools.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    className="more-row"
                    data-mtone={t.tone}
                    onClick={() => runTool(t.key)}
                  >
                    <span className="more-row-icon">
                      <MobileIcon name={t.icon} />
                    </span>
                    <span className="more-row-label">{t.label}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="more-account" aria-label="Account">
            <div className="more-account-row">
              <span className="more-avatar" aria-hidden="true">
                {initials(userName)}
              </span>
              <div className="more-account-names">
                <span className="more-account-name">{userName}</span>
                {companyName && <span className="more-account-company">{companyName}</span>}
              </div>
            </div>
            {companySwitcher && <div className="more-switcher">{companySwitcher}</div>}
            <form action={logout}>
              <button type="submit" className="more-signout">
                <MobileIcon name="signout" size={20} />
                Sign out
              </button>
            </form>
          </section>

          <p className="more-legal">
            <a href="/privacy">Privacy</a>
            <a href="/delete-account">Delete account</a>
            <span>v{version}</span>
          </p>
        </div>
      </div>
    </>
  );
}
