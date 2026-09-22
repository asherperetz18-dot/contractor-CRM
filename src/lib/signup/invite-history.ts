/**
 * The pure half of the Platform Admin invite history: what state a
 * signup_invites row is in, and how the card's tabs and search narrow
 * the list. Kept free of Supabase so node:test can reach it.
 */

export type InviteSource = "stripe" | "manual";

export type InviteHistoryRow = {
  id: string;
  email: string;
  company_name: string | null;
  source: InviteSource;
  created_at: string;
  invite_sent_at: string | null;
  expires_at: string;
  consumed_at: string | null;
  company_id: string | null;
  /** Who clicked Send on a manual invite; null for a paid signup. */
  sent_by_name: string | null;
};

export type InviteStatus = "set_up" | "pending" | "expired" | "send_failed";

export const INVITE_STATUS_LABEL: Record<InviteStatus, string> = {
  set_up: "Set up",
  pending: "Pending",
  expired: "Expired",
  send_failed: "Send failed",
};

/**
 * Order matters: a redeemed link is Set up even if its expiry has since
 * passed, and a row the email never left for is a failure whatever the
 * clock says -- nobody is holding a link that could still be opened.
 */
export function inviteStatus(row: InviteHistoryRow, now: number): InviteStatus {
  if (row.consumed_at) return "set_up";
  if (!row.invite_sent_at) return "send_failed";
  if (new Date(row.expires_at).getTime() < now) return "expired";
  return "pending";
}

export type InviteTab = "all" | InviteStatus;

export function filterInviteHistory(
  rows: InviteHistoryRow[],
  tab: InviteTab,
  search: string,
  now: number
): InviteHistoryRow[] {
  const q = search.trim().toLowerCase();
  return rows.filter((r) => {
    if (tab !== "all" && inviteStatus(r, now) !== tab) return false;
    if (!q) return true;
    return r.email.toLowerCase().includes(q) || (r.company_name ?? "").toLowerCase().includes(q);
  });
}

/** Whether a fresh link on the same row makes sense: never for a redeemed one. */
export function canResendInvite(row: InviteHistoryRow, now: number): boolean {
  return inviteStatus(row, now) !== "set_up";
}
