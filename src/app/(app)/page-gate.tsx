"use client";

import { usePathname } from "next/navigation";
import {
  canSeePage,
  pathToPageKey,
  type AppRole,
  type RolePageVisibilityRow,
} from "@/lib/data/types";

/**
 * The role-visibility gate around every page's content.
 *
 * A client component on purpose: this decision used to be made in the
 * server layout, and a layout renders ONCE -- in-app navigation swaps
 * only the page underneath it. So whoever hard-landed on a hidden page
 * carried "Page not available" to every page they clicked afterwards
 * (URL and sidebar moved, content never did), and in the other
 * direction a hidden page reached by in-app click rendered fine.
 * Reading the live pathname re-decides on every navigation, both ways.
 */
export function PageGate({
  roles,
  overrides,
  children,
}: {
  roles: AppRole[];
  overrides: RolePageVisibilityRow[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const pageKey = pathToPageKey(pathname);
  const blocked = !!pageKey && !canSeePage({ roles }, pageKey, overrides);

  if (blocked) {
    return (
      <div className="empty-state">
        <p className="empty-label">Page not available</p>
        <p className="empty-hint">
          Your role doesn&apos;t have access to this page. Contact an admin if you think
          this is a mistake.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
