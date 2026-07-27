"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  PAGE_REGISTRY,
  VISIBILITY_MANAGED_ROLES,
  effectivePageVisible,
  type AppRole,
  type PageKey,
  type RolePageVisibilityRow,
} from "@/lib/data/types";
import { setPageVisibility } from "@/lib/actions/role-visibility";

function groupPages() {
  const groups = new Map<string, typeof PAGE_REGISTRY>();
  for (const page of PAGE_REGISTRY) {
    if (!groups.has(page.group)) groups.set(page.group, []);
    groups.get(page.group)!.push(page);
  }
  return [...groups.entries()];
}

export function RoleVisibilityTable({ overrides }: { overrides: RolePageVisibilityRow[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [localOverrides, setLocalOverrides] = useState(overrides);
  const [pendingCell, setPendingCell] = useState<string | null>(null);
  const [error, setError] = useState("");

  const grouped = groupPages();

  async function toggle(role: AppRole, pageKey: PageKey, checked: boolean) {
    const cellId = `${role}:${pageKey}`;
    const previous = localOverrides;
    setPendingCell(cellId);
    setError("");
    setLocalOverrides((prev) => {
      const next = prev.filter((o) => !(o.role === role && o.page_key === pageKey));
      next.push({ id: cellId, role, page_key: pageKey, visible: checked });
      return next;
    });
    const result = await setPageVisibility(role, pageKey, checked);
    setPendingCell(null);
    if (result.error) {
      setLocalOverrides(previous);
      setError(result.error);
      return;
    }
    startTransition(() => router.refresh());
  }

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

      {error && <p className="error-note">{error}</p>}

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Page</th>
              {VISIBILITY_MANAGED_ROLES.map((role) => (
                <th key={role} className="center">
                  {role}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grouped.map(([group, pages]) => (
              <Fragment key={group}>
                <tr className="table-group-row">
                  <td colSpan={VISIBILITY_MANAGED_ROLES.length + 1}>{group.toUpperCase()}</td>
                </tr>
                {pages.map((page) => (
                  <tr key={page.key}>
                    <td>{page.label}</td>
                    {VISIBILITY_MANAGED_ROLES.map((role) => {
                      const cellId = `${role}:${page.key}`;
                      const checked = effectivePageVisible(role, page.key, localOverrides);
                      return (
                        <td key={role} className="center">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={pendingCell === cellId}
                            onChange={(e) => toggle(role, page.key, e.target.checked)}
                          />
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
    </div>
  );
}
