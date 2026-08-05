"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  PAGE_REGISTRY,
  VISIBILITY_MANAGED_ROLES,
  defaultPageVisible,
  effectivePageVisible,
  type AppRole,
  type PageKey,
  type RolePageVisibilityRow,
} from "@/lib/data/types";
import { resetPageVisibility, setPageVisibilityBulk } from "@/lib/actions/role-visibility";

type Draft = Map<string, boolean>;

const cellKey = (role: AppRole, pageKey: PageKey) => `${role}:${pageKey}`;

function groupPages(pages: typeof PAGE_REGISTRY) {
  const groups = new Map<string, typeof PAGE_REGISTRY>();
  for (const page of pages) {
    if (!groups.has(page.group)) groups.set(page.group, []);
    groups.get(page.group)!.push(page);
  }
  return [...groups.entries()];
}

export function RoleVisibilityTable({ overrides }: { overrides: RolePageVisibilityRow[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  // Edits live here until saved, so a run of toggles costs one request
  // instead of one per checkbox.
  const [draft, setDraft] = useState<Draft>(() => new Map());
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [savedNote, setSavedNote] = useState("");

  const q = query.trim().toLowerCase();
  const visiblePages = useMemo(
    () => (q ? PAGE_REGISTRY.filter((p) => p.label.toLowerCase().includes(q)) : PAGE_REGISTRY),
    [q]
  );
  const grouped = groupPages(visiblePages);

  /** Saved value for a cell, ignoring anything unsaved. */
  function savedValue(role: AppRole, pageKey: PageKey) {
    return effectivePageVisible(role, pageKey, overrides);
  }

  /** What the cell shows right now, unsaved edits included. */
  function currentValue(role: AppRole, pageKey: PageKey) {
    const key = cellKey(role, pageKey);
    return draft.has(key) ? draft.get(key)! : savedValue(role, pageKey);
  }

  /** True when a saved override exists, i.e. it isn't the platform default. */
  function isOverridden(role: AppRole, pageKey: PageKey) {
    return overrides.some((o) => o.role === role && o.page_key === pageKey);
  }

  function setCell(role: AppRole, pageKey: PageKey, value: boolean) {
    setSavedNote("");
    setDraft((prev) => {
      const next = new Map(prev);
      const key = cellKey(role, pageKey);
      // Toggling back to the saved value drops it from the draft, so the
      // unsaved count only ever reflects real differences.
      if (value === savedValue(role, pageKey)) next.delete(key);
      else next.set(key, value);
      return next;
    });
  }

  function setColumn(role: AppRole, value: boolean) {
    for (const page of visiblePages) setCell(role, page.key, value);
  }

  function setRow(pageKey: PageKey, value: boolean) {
    for (const role of VISIBILITY_MANAGED_ROLES) setCell(role, pageKey, value);
  }

  async function save() {
    if (draft.size === 0) return;
    setPending(true);
    setError("");
    const changes = [...draft.entries()].map(([key, visible]) => {
      const [role, pageKey] = key.split(":");
      return { role: role as AppRole, pageKey: pageKey as PageKey, visible };
    });
    const result = await setPageVisibilityBulk(changes);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setDraft(new Map());
    setSavedNote(`Saved ${changes.length} change${changes.length === 1 ? "" : "s"}.`);
    startTransition(() => router.refresh());
  }

  async function resetAll() {
    setPending(true);
    setError("");
    const result = await resetPageVisibility({});
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setDraft(new Map());
    setSavedNote("All cells are back on the platform defaults.");
    startTransition(() => router.refresh());
  }

  const dirtyCount = draft.size;
  const overrideCount = overrides.length;

  return (
    <div>
      <div className="ur-breadcrumb">
        <Link href="/settings" className="ur-crumb-link">
          ⚙ Settings
        </Link>
        <span> › </span>
        <span>Role Visibility</span>
      </div>

      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Role Visibility</h1>
          <p className="module-sub">
            Choose which pages each role can open. Hidden pages are removed from the sidebar
            and blocked at the URL. Office and Admin always have full access.
          </p>
        </div>
      </div>

      <p className="rv-banner">
        🛡 This controls <strong>page visibility only</strong>. Your data stays protected by
        row-level security — turning a page on for a role never exposes another company&apos;s
        data.
      </p>

      <div className="rv-toolbar">
        <input
          className="rv-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search pages…"
        />
        <span className="hint-note rv-toolbar-note">
          {overrideCount === 0
            ? "Every cell is on its platform default."
            : `${overrideCount} cell${overrideCount === 1 ? "" : "s"} differ from the default (marked ●).`}
        </span>
        <button
          type="button"
          className="btn-ghost small"
          onClick={resetAll}
          disabled={pending || overrideCount === 0}
        >
          Reset all to defaults
        </button>
      </div>

      {error && <p className="error-note">{error}</p>}
      {savedNote && !error && <p className="cp-saved rv-saved">✓ {savedNote}</p>}

      <div className="table-scroll rv-scroll">
        <table className="data-table rv-table">
          <thead>
            <tr>
              <th className="rv-page-col">Page</th>
              {VISIBILITY_MANAGED_ROLES.map((role) => (
                <th key={role} className="center">
                  <div className="rv-role-head">
                    <span>{role}</span>
                    <span className="rv-bulk">
                      <button type="button" onClick={() => setColumn(role, true)} disabled={pending}>
                        All
                      </button>
                      <span aria-hidden="true">/</span>
                      <button
                        type="button"
                        onClick={() => setColumn(role, false)}
                        disabled={pending}
                      >
                        None
                      </button>
                    </span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grouped.length === 0 && (
              <tr>
                <td colSpan={VISIBILITY_MANAGED_ROLES.length + 1} className="rv-empty">
                  No pages match “{query}”.
                </td>
              </tr>
            )}
            {grouped.map(([group, pages]) => (
              <Fragment key={group}>
                <tr className="table-group-row">
                  <td colSpan={VISIBILITY_MANAGED_ROLES.length + 1}>{group.toUpperCase()}</td>
                </tr>
                {pages.map((page) => (
                  <tr key={page.key}>
                    <td className="rv-page-col">
                      <div className="rv-page-head">
                        <span>{page.label}</span>
                        <span className="rv-bulk">
                          <button
                            type="button"
                            onClick={() => setRow(page.key, true)}
                            disabled={pending}
                          >
                            All
                          </button>
                          <span aria-hidden="true">/</span>
                          <button
                            type="button"
                            onClick={() => setRow(page.key, false)}
                            disabled={pending}
                          >
                            None
                          </button>
                        </span>
                      </div>
                    </td>
                    {VISIBILITY_MANAGED_ROLES.map((role) => {
                      const checked = currentValue(role, page.key);
                      const dirty = draft.has(cellKey(role, page.key));
                      const overridden = isOverridden(role, page.key);
                      return (
                        <td
                          key={role}
                          className={"center rv-cell" + (dirty ? " rv-cell-dirty" : "")}
                          title={
                            dirty
                              ? "Unsaved change"
                              : overridden
                                ? "You set this — differs from the platform default"
                                : `Platform default (${defaultPageVisible(role, page.key) ? "visible" : "hidden"})`
                          }
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={pending}
                            onChange={(e) => setCell(role, page.key, e.target.checked)}
                          />
                          {(dirty || overridden) && (
                            <span className={dirty ? "rv-dot rv-dot-dirty" : "rv-dot"}>●</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {dirtyCount > 0 && (
        <div className="rv-savebar">
          <span>
            <strong>{dirtyCount}</strong> unsaved change{dirtyCount === 1 ? "" : "s"}
          </span>
          <span>
            <button
              type="button"
              className="btn-ghost small"
              onClick={() => setDraft(new Map())}
              disabled={pending}
            >
              Discard
            </button>
            <button type="button" className="btn-primary small" onClick={save} disabled={pending}>
              {pending ? "Saving…" : "Save changes"}
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
