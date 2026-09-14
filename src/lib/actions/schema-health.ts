"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { isStrictAdmin } from "@/lib/data/types";
import {
  EXPECTED_COLUMNS,
  buildDriftReport,
  type DriftReport,
  type ProbeOutcome,
} from "@/lib/schema-drift";

// The manifest's table/column names aren't statically known to the
// generated Database types (probing columns the types say exist would
// defeat the point -- the live database is what's in question), so the
// probes go through this narrow untyped view of the client.
type ProbeClient = {
  from(table: string): {
    select(column: string): {
      limit(n: number): PromiseLike<{ error: { code?: string; message: string } | null }>;
    };
  };
};

/**
 * Probe the live database for every column the deployed code expects.
 * One SELECT ... LIMIT 0 per column, service-role so RLS can't shadow a
 * missing column as an empty result. Strict Admin only -- the report
 * names internal table names.
 */
export async function checkSchemaDrift(): Promise<DriftReport | null> {
  const profile = await getCurrentProfile();
  if (!isStrictAdmin(profile)) return null;

  const admin = createAdminClient() as unknown as ProbeClient;
  const outcomes: ProbeOutcome[] = [];
  for (const probe of EXPECTED_COLUMNS) {
    const { error } = await admin.from(probe.table).select(probe.column).limit(0);
    outcomes.push({ ...probe, error });
  }
  return buildDriftReport(outcomes);
}
