"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { FUNNEL_CARD_KEYS, mergeSavedOrder } from "@/lib/data/funnel-order";

/**
 * Saves the dragged order of the Estimates funnel cards on the person's
 * profile, so the arrangement follows the login instead of one
 * browser's localStorage.
 *
 * Own row only, enforced by the profiles_update_self policy as well as
 * the id filter here -- a card order is nobody's to set for a
 * colleague.
 */
export async function saveFunnelOrder(order: string[]): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  // Whatever the client sent, what is stored is exactly the known card
  // keys: unknown names dropped, missing ones restored to their default
  // spot. Same reconciliation the read side runs, so the two agree.
  const clean = mergeSavedOrder(
    FUNNEL_CARD_KEYS,
    (Array.isArray(order) ? order : []).filter((k): k is string => typeof k === "string")
  );

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ estimate_funnel_order: clean })
    .eq("id", profile.id);
  return error ? { error: "The card order couldn't be saved." } : {};
}
