import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCronSecret } from "@/lib/cron-env";
import { bearerToken, sameSecret } from "@/lib/cron-token";

/**
 * Who may start a scheduled job (DECISIONS #140). Either:
 * - the database's own scheduler (Supabase Cron, migration 0203), with
 *   the token it made and keeps in its vault, which the database checks
 *   itself (`crm_job_token_ok`), so no copy of it lives anywhere else; or
 * - anyone holding CRON_SECRET: the "Run workflow" buttons on GitHub.
 *
 * Null when the caller may go ahead; otherwise the reply to send.
 */
export async function refuseCronCaller(req: NextRequest): Promise<NextResponse | null> {
  const token = bearerToken(req.headers.get("authorization"));
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const secret = getCronSecret();
  if (secret && sameSecret(token, secret)) return null;
  if (await databaseTokenMatches(token)) return null;
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

/** Before 0203 has run, or on any error, no database token matches. */
async function databaseTokenMatches(token: string): Promise<boolean> {
  try {
    const { data, error } = await createAdminClient().rpc("crm_job_token_ok", { token });
    return !error && data === true;
  } catch {
    return false;
  }
}
