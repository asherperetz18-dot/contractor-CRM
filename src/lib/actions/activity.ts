"use server";

import { createClient } from "@/lib/supabase/server";

export async function logActivityPing(
  sessionId: string,
  path: string,
  kind: "pageview" | "heartbeat"
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.from("activity_events").insert({
    user_id: user.id,
    session_id: sessionId,
    path,
    kind,
  });
}
