import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { leadPhoneMatch } from "@/lib/data/lead-for-number";
import { createLeadForCaller } from "@/lib/callrail-sync";
import {
  cdrsToCalls,
  extensionRepMap,
  nsDatetime,
  shouldAlertNewLead,
  type NsCdr,
  type PrimeCallCall,
} from "@/lib/primecall";
import {
  domainPath,
  getPrimeCallForCompany,
  nsFetch,
  recordingAccessUrl,
  type CompanyPrimeCall,
} from "@/lib/primecall-company";

type Admin = ReturnType<typeof createAdminClient>;

/** What call_logs.recording_url holds for a PrimeCall recording. The
 *  audio URL NetSapiens hands out can expire, so the row keeps the call
 *  id and the recording proxy asks for a fresh URL on every play. */
export const PRIMECALL_RECORDING_PREFIX = "primecall:";

const PAGE = 1000;

/** Every CDR of one type in the window, all pages. */
async function readCdrs(
  creds: CompanyPrimeCall,
  type: "Inbound" | "Missed" | "Outbound",
  from: Date,
  to: Date
): Promise<NsCdr[] | { error: string }> {
  const rows: NsCdr[] = [];
  for (let start = 0; start < 50 * PAGE; start += PAGE) {
    const q = new URLSearchParams({
      "datetime-start": nsDatetime(from),
      "datetime-end": nsDatetime(to),
      type,
      limit: String(PAGE),
      start: String(start),
    });
    const res = await nsFetch(creds, `${domainPath(creds.domain)}/cdrs?${q}`);
    if (!res) return { error: "Couldn't reach PrimeCall." };
    // No calls in the window can come back as 404 rather than [].
    if (res.status === 404) break;
    if (!res.ok) return { error: `PrimeCall API answered ${res.status}.` };
    const page = (await res.json().catch(() => [])) as NsCdr[];
    if (!Array.isArray(page)) break;
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

/** Extension -> CRM user for this company, matched on email. */
async function repsByExtension(admin: Admin, creds: CompanyPrimeCall, companyId: string) {
  const res = await nsFetch(creds, `${domainPath(creds.domain)}/users?limit=1000`);
  if (!res?.ok) return new Map<string, string>();
  const nsUsers = (await res.json().catch(() => [])) as { user?: string; "email-address"?: string }[];
  const { data } = await admin
    .from("company_members")
    .select("profiles(id, email)")
    .eq("company_id", companyId);
  const members = ((data ?? []) as unknown as { profiles: { id: string; email: string | null } | null }[])
    .map((r) => r.profiles)
    .filter((p): p is { id: string; email: string | null } => !!p);
  return extensionRepMap(Array.isArray(nsUsers) ? nsUsers : [], members);
}

async function findRecording(creds: CompanyPrimeCall, call: PrimeCallCall): Promise<string | null> {
  for (const id of call.recordingCallIds) {
    if (await recordingAccessUrl(creds, id)) return `${PRIMECALL_RECORDING_PREFIX}${id}`;
  }
  return null;
}

type ExistingRow = {
  id: string;
  primecall_call_id: string;
  status: string;
  duration_seconds: number;
  recording_url: string | null;
  rep_id: string | null;
};

async function existingRows(admin: Admin, companyId: string, ids: string[]) {
  const map = new Map<string, ExistingRow>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await admin
      .from("call_logs")
      .select("id, primecall_call_id, status, duration_seconds, recording_url, rep_id")
      .eq("company_id", companyId)
      .in("primecall_call_id", ids.slice(i, i + 200));
    for (const r of (data as ExistingRow[]) ?? []) map.set(r.primecall_call_id, r);
  }
  return map;
}

/**
 * Pulls the company's PrimeCall calls for the last `minutes` and files
 * each one: into call_logs, onto the matching contact, and -- for an
 * inbound caller nobody has -- into the pipeline as a new lead, through
 * the same race-guarded path CallRail uses.
 *
 * Both the live webhook and the 15-minute sweep run this; it is keyed on
 * PrimeCall's call id, so re-reading a call only refreshes its facts.
 * Outbound desk-phone calls are logged only to numbers already in the
 * contact book -- a call to the lumber yard is not a customer.
 */
export async function syncPrimeCall(
  companyId: string,
  minutes: number,
  opts?: { quiet?: boolean }
): Promise<{ error?: string; processed: number; created: number }> {
  const creds = await getPrimeCallForCompany(companyId);
  if (!creds) return { error: "PrimeCall is not connected.", processed: 0, created: 0 };

  const now = new Date();
  const from = new Date(now.getTime() - minutes * 60_000);
  const inbound = await readCdrs(creds, "Inbound", from, now);
  if ("error" in inbound) return { error: inbound.error, processed: 0, created: 0 };
  const missed = await readCdrs(creds, "Missed", from, now);
  if ("error" in missed) return { error: missed.error, processed: 0, created: 0 };
  const outbound = await readCdrs(creds, "Outbound", from, now);
  if ("error" in outbound) return { error: outbound.error, processed: 0, created: 0 };

  // Inbound and Missed are merged BEFORE grouping: one ring-group call
  // can have a missed leg and an answered leg, and it's one call.
  const calls = [
    ...cdrsToCalls([...inbound, ...missed], "inbound"),
    ...cdrsToCalls(outbound, "outbound"),
  ];
  if (!calls.length) return { processed: 0, created: 0 };

  const admin = createAdminClient();
  const existing = await existingRows(admin, companyId, calls.map((c) => c.callId));
  const reps = calls.some((c) => c.extension)
    ? await repsByExtension(admin, creds, companyId)
    : new Map<string, string>();

  let created = 0;
  for (const call of calls) {
    if (await fileCall(admin, creds, companyId, call, existing.get(call.callId), reps, now, opts?.quiet)) {
      created++;
    }
  }
  return { processed: calls.length, created };
}

/** One call into call_logs; true when a new row was written. */
async function fileCall(
  admin: Admin,
  creds: CompanyPrimeCall,
  companyId: string,
  call: PrimeCallCall,
  row: ExistingRow | undefined,
  reps: Map<string, string>,
  now: Date,
  quiet: boolean | undefined
): Promise<boolean> {
  const status = call.answered ? "completed" : "missed";
  const repId = call.extension ? reps.get(call.extension) ?? null : null;

  // Seen before: refresh only the facts PrimeCall owns. Disposition and
  // the lead link belong to the reps once the row exists -- a sync must
  // never undo a human. A leg that finished after the first read can
  // turn "missed" into "completed", so that's what this catches.
  if (row) {
    const changed = row.status !== status || row.duration_seconds !== call.durationSeconds;
    const needsRecording = call.answered && !row.recording_url;
    const needsRep = !row.rep_id && !!repId;
    if (!changed && !needsRecording && !needsRep) return false;
    await admin
      .from("call_logs")
      .update({
        status,
        duration_seconds: call.durationSeconds,
        ...(needsRecording ? { recording_url: await findRecording(creds, call) } : {}),
        ...(needsRep ? { rep_id: repId } : {}),
      })
      .eq("id", row.id);
    return false;
  }

  const match = await leadPhoneMatch(admin, companyId, call.externalNumber);
  if (call.direction === "outbound" && match.kind === "none") return false;
  let leadId = match.kind === "one" ? match.leadId : null;

  if (call.direction === "inbound" && match.kind === "none") {
    const made = await createLeadForCaller(admin, companyId, {
      name: call.callerName,
      phone: call.externalNumber,
      source: "PrimeCall",
      notes: call.answered ? "Called in (PrimeCall)" : "Called in and wasn't answered (PrimeCall)",
      quiet: quiet || !shouldAlertNewLead(call.startedAt, now),
    });
    leadId = made.leadId;
  }

  const inbound = call.direction === "inbound";
  const { error } = await admin.from("call_logs").insert({
    lead_id: leadId,
    rep_id: repId,
    direction: call.direction,
    from_number: inbound ? call.externalNumber : call.companyNumber,
    to_number: inbound ? call.companyNumber : call.externalNumber,
    status,
    duration_seconds: call.durationSeconds,
    disposition: call.answered ? "No Disposition" : "No Answer",
    recording_url: call.answered ? await findRecording(creds, call) : null,
    primecall_call_id: call.callId,
    company_id: companyId,
    ...(call.startedAt ? { created_at: call.startedAt } : {}),
  });
  // The webhook and the sweep can race on the unique index; the loser's
  // call is already filed.
  if (error && error.code !== "23505") {
    console.error("[primecall] call_logs insert failed", error);
    return false;
  }
  return !error;
}
