"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";

export async function logActivityPing(
  sessionId: string,
  path: string,
  kind: "pageview" | "heartbeat"
) {
  const profile = await getCurrentProfile();
  if (!profile) return;

  const supabase = await createClient();
  await supabase.from("activity_events").insert({
    user_id: profile.id,
    session_id: sessionId,
    path,
    kind,
    company_id: profile.company_id,
  });
}
