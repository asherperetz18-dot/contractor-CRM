"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { setupHiddenCookie, type SetupItem } from "@/lib/setup-checklist";

const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * The setup checklist on the Dashboard (DECISIONS #136): what this
 * company still has to set up, each step linking to the page where it's
 * done. The page leaves it out once every step is done. Hide puts it
 * away on this browser only.
 */
export function SetupChecklist({ companyId, items }: { companyId: string; items: SetupItem[] }) {
  const router = useRouter();
  const done = items.filter((i) => i.done).length;

  function hide() {
    document.cookie = `${setupHiddenCookie(companyId)}=1; path=/; max-age=${ONE_YEAR}; samesite=lax`;
    router.refresh();
  }

  return (
    <section className="setup-checklist" aria-labelledby="setup-checklist-title">
      <div className="setup-head">
        <div>
          <h2 id="setup-checklist-title" className="setup-title">
            Finish setting up
          </h2>
          <p className="setup-sub">
            {done} of {items.length} done
          </p>
        </div>
        <button
          type="button"
          className="btn-ghost small"
          onClick={hide}
          title="Hides this list on this device. Every step stays in Settings."
        >
          Hide
        </button>
      </div>
      <div
        className="setup-bar"
        role="progressbar"
        aria-label="Setup progress"
        aria-valuemin={0}
        aria-valuemax={items.length}
        aria-valuenow={done}
      >
        <span style={{ width: `${Math.round((done / items.length) * 100)}%` }} />
      </div>
      <ol className="setup-list">
        {items.map((i) => (
          <li key={i.key} className={i.done ? "setup-item done" : "setup-item"}>
            <span className="setup-mark" aria-hidden="true">
              {i.done ? "✓" : ""}
            </span>
            <div className="setup-text">
              <span className="setup-item-title">{i.title}</span>
              {!i.done && <span className="setup-item-detail">{i.detail}</span>}
            </div>
            {i.done ? (
              <span className="setup-done">Done</span>
            ) : (
              <Link href={i.href} className="btn-primary small">
                Set up
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
