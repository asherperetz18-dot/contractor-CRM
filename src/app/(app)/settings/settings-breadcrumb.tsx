"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SETTINGS_SECTIONS } from "@/lib/data/settings-catalog";
import { isSettingsSubPage, settingsPageTitle } from "@/lib/settings-crumb";

/**
 * "⚙ Settings › Page", the way back to the grid from any settings page.
 * Rendered by the settings layout, never by a page: eighteen pages once
 * carried their own copy and twenty had none.
 */
export function SettingsBreadcrumb() {
  const pathname = usePathname();
  if (!isSettingsSubPage(pathname)) return null;
  const title = settingsPageTitle(pathname, SETTINGS_SECTIONS);
  return (
    <div className="ur-breadcrumb">
      <Link href="/settings" className="ur-crumb-link">
        ⚙ Settings
      </Link>
      {title && (
        <>
          <span> › </span>
          <span>{title}</span>
        </>
      )}
    </div>
  );
}
