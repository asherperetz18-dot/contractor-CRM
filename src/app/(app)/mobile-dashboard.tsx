import Link from "next/link";

export type MobileModule = { label: string; href: string; icon: string };

/**
 * The phone's module launcher — the tile grid that has always been the
 * quick way around the app on a small screen (the sidebar is behind
 * the ☰ there). It renders below the real dashboard now: the task,
 * call, week and month widgets that used to live here duplicated what
 * Dashboard 2.0 shows properly (attention strip, call panel,
 * appointments panel), so they are gone rather than shown twice.
 */
export function MobileDashboard({ modules }: { modules: MobileModule[] }) {
  return (
    <div className="dash-mobile">
      <div className="mobile-widget">
        <h3 className="mobile-widget-title">Modules</h3>
        <div className="modules-grid">
          {modules.map((m) => (
            <Link href={m.href} className="module-tile" key={m.href}>
              <span className="module-tile-icon">{m.icon}</span>
              <span className="module-tile-label">{m.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
