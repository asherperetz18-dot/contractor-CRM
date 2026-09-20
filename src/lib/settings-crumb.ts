import type { SettingsSectionDef } from "./data/settings-catalog";

/**
 * The "⚙ Settings › Page" crumb every settings page shows above its
 * title. The settings layout renders it once for the whole tree, so no
 * page can ship without a way back to the grid again; the pure decisions
 * live here so they are tested.
 */

const SETTINGS_ROOT = "/settings/";

/** Which routes get the crumb: everything under the grid. The grid
 *  itself does not link to itself. */
export function isSettingsSubPage(pathname: string): boolean {
  return pathname.startsWith(SETTINGS_ROOT) && pathname.length > SETTINGS_ROOT.length;
}

/** The name the crumb shows: the title of the tile the grid opened the
 *  page from, so the crumb reads exactly what was clicked and there is
 *  one list of settings pages, not two. When two tiles open the same
 *  page the first one names it. null for a route no tile points at. */
export function settingsPageTitle(
  pathname: string,
  sections: SettingsSectionDef[]
): string | null {
  for (const sec of sections) {
    for (const card of sec.cards) {
      if (card.href === pathname) return card.title;
    }
  }
  return null;
}
