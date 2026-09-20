import type { SettingsCardDef, SettingsSectionDef } from "./data/settings-catalog";

/**
 * The "recently used" row on the Settings grid: the last cards this
 * browser opened, newest first, shown as shortcut chips where the
 * static category labels sat. Pure list logic lives here so it is
 * tested; reading and writing localStorage stays in the grid.
 *
 * Cards are remembered by id — the route for a linked card, "logo" for
 * the logo modal — never by copied content, so a stored entry can only
 * ever show what the live catalog (and the viewer's role) still allows.
 */

export const RECENTS_CAP = 8;

/** What a click may record. A "SOON" placeholder has no page and no
 *  modal worth returning to, so it has no id and is never remembered. */
export function recentId(card: Pick<SettingsCardDef, "href" | "key">): string | null {
  return card.href ?? card.key ?? null;
}

export function pushRecent(list: string[], id: string): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, RECENTS_CAP);
}

/** Stored ids back to live cards, in click order. An id the catalog no
 *  longer carries (renamed, removed) silently drops out, and an
 *  admin-only card drops for a non-admin — losing the Admin role must
 *  also empty it out of this row. */
export function resolveRecents(
  list: string[],
  sections: SettingsSectionDef[],
  isAdmin: boolean
): SettingsCardDef[] {
  const byId = new Map<string, SettingsCardDef>();
  for (const sec of sections) {
    for (const card of sec.cards) {
      const id = recentId(card);
      if (id !== null) byId.set(id, card);
    }
  }
  const out: SettingsCardDef[] = [];
  for (const id of list) {
    const card = byId.get(id);
    if (card && (!card.adminOnly || isAdmin)) out.push(card);
  }
  return out;
}
