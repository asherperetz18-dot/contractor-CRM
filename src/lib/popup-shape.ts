/**
 * The pure part of the popup watcher: which kinds exist, and how a poll's
 * worth of new things becomes the toasts that actually appear. No React,
 * no database -- so it runs under node --test.
 */

/** Which switch in the popup settings turns an item off. */
export type PopupKind = "message" | "money" | "job" | "lead" | "appointment" | "weather";

/**
 * Every kind, with the words people see for it. One list feeds both the
 * "⚙ Popups" switches and the filter tabs in the bell, so a kind can
 * never again have a switch but no tab -- which is how "Leads" sat in
 * the settings while the bell had nowhere to show a lead.
 */
export const POPUP_KINDS: { key: PopupKind; label: string; hint: string }[] = [
  { key: "message", label: "Texts", hint: "New customer texts, and texts that didn't deliver" },
  { key: "money", label: "Money", hint: "Payments received in the portal" },
  { key: "job", label: "Jobs", hint: "Signatures, proposal views, job steps assigned to you" },
  { key: "lead", label: "Leads", hint: "New leads coming in" },
  { key: "appointment", label: "Appointments", hint: "Appointments booked for you by a teammate" },
  { key: "weather", label: "Rain alerts", hint: "An outdoor appointment now has rain in the forecast" },
];

export type PopupToast = {
  /** Stable across polls, so the client never toasts one thing twice. */
  id: string;
  kind: PopupKind;
  icon: string;
  title: string;
  body: string;
  href: string;
  /** Stays on screen until dismissed: the rare, valuable ones. */
  sticky: boolean;
};

// Same kind, same poll, more than this many: one summary toast instead
// of a wall (a CSV import of 200 leads, a template that adds 8 steps).
export const GROUP_OVER = 2;

export const GROUP_LABEL: Record<PopupKind, { plural: string; href: string }> = {
  message: { plural: "text alerts", href: "/reply-inbox" },
  money: { plural: "payments received", href: "/payments" },
  job: { plural: "job updates", href: "/estimates" },
  lead: { plural: "new leads", href: "/contacts" },
  appointment: { plural: "appointments booked for you", href: "/calendar" },
  weather: { plural: "rain alerts", href: "/schedule" },
};

/**
 * Drops the kinds this browser switched off, then folds any burst of one
 * kind into a single summary toast. Order within a kind is kept; kinds
 * come out in the order they were first seen.
 */
export function shapeToasts(
  items: PopupToast[],
  on: Record<PopupKind, boolean>
): PopupToast[] {
  const kept = items.filter((i) => on[i.kind]);
  const byKind = new Map<PopupKind, PopupToast[]>();
  for (const i of kept) byKind.set(i.kind, [...(byKind.get(i.kind) ?? []), i]);

  const out: PopupToast[] = [];
  for (const [kind, group] of byKind) {
    if (group.length > GROUP_OVER) {
      const g = GROUP_LABEL[kind];
      out.push({
        id: `group:${kind}:${group[0].id}`,
        kind,
        icon: group[0].icon,
        title: `${group.length} ${g.plural}`,
        body: group.slice(0, 2).map((i) => i.title).join(" · ") + " · …",
        href: g.href,
        // A burst of payments is still money: keep it up until read.
        sticky: group.some((i) => i.sticky),
      });
    } else {
      out.push(...group);
    }
  }
  return out;
}
