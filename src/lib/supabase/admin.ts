import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

// Service-role client. Bypasses RLS entirely -- only import this from
// Server Actions/Route Handlers, and only for admin operations (creating
// auth users, uploading to Storage) that the anon/authenticated client
// can't do. Never expose this client or its key to the browser.
export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
