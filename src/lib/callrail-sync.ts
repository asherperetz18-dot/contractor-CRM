import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { leadForPhoneNumber, leadPhoneMatch } from "@/lib/data/lead-for-number";
import {
  phoneIndex,
  phoneMatchInIndex,
  rememberInIndex,
  type LeadPhoneRow,
  type PhoneMatch,
} from "@/lib/data/phone-match";
import { selectAll } from "@/lib/data/select-all";
import { notifyNewLead } from "@/lib/notify-new-lead";
import {
  CALLRAIL_API_BASE,
  callrailAuthHeader,
  getCallRailForCompany,
} from "@/lib/callrail-company";

type Admin = ReturnType<typeof createAdminClient>;

/** The slice of a CallRail call object this integration reads. */
export type CallRailCall = {
  id?: string | number;
  resource_id?: string;
  direction?: string;
  answered?: boolean | null;
  voicemail?: boolean;
  duration?: number | null;
  start_time?: string;
  customer_phone_number?: string;
  customer_name?: string | null;
  tracking_phone_number?: string;
  recording_player?: string | null;
  source?: string | null;
  campaign?: string | null;
  keywords?: string | null;
  medium?: string | null;
};

export type CallRailForm = {
  form_data?: Record<string, unknown>;
  form_url?: string | null;
  customer_phone_number?: string | null;
  customer_name?: string | null;
  customer_email?: string | null;
  source?: string | null;
  campaign?: string | null;
};

export type CallRailText = {
  source_number?: string;
  content?: string | null;
};

function splitName(name: string) {
  const parts = name.trim().split(/\s+/);
  return { first: parts[0] || "", last: parts.slice(1).join(" ") || "" };
}

/**
 * "Google Ads · spring-roofing · kitchen remodel" -- everything CallRail
 * knows about which marketing made the phone ring, in one line.
 */
export function marketingSourceLine(c: {
  source?: string | null;
  campaign?: string | null;
  keywords?: string | null;
}): string | null {
  const line = [c.source, c.campaign, c.keywords].map((v) => v?.trim()).filter(Boolean).join(" · ");
  return line || null;
}

/**
 * The lead source a CallRail contact files under. The raw CallRail
 * source string ("Google Ads", "Google My Business", "Direct") goes in
 * as-is -- Marketing Analytics groups leads by this exact text, and the
 * whole point of the integration is that those groups become true.
 */
function leadSource(source: string | null | undefined): string {
  return source?.trim() || "CallRail";
}

/** What creating a contact for a caller produced. `created` is false
 *  when the number turned out to be someone we already had -- either an
 *  existing card (leadId set) or several of them (leadId null). */
type LeadCreateResult = { leadId: string | null; created: boolean };

/** Supabase's error shape, only the parts read here. */
type QueryError = { code?: string; message?: string };

/** The migration adding create_lead_for_unknown_caller has not been run
 *  in this database yet. */
function isMissingFunction(error: QueryError | null): boolean {
  if (!error) return false;
  if (error.code === "PGRST202" || error.code === "42883") return true;
  return /schema cache|could not find the function|does not exist/i.test(error.message ?? "");
}

/**
 * The insert itself, guarded against two calls from the same new number
 * arriving at the same moment.
 *
 * create_lead_for_unknown_caller (migration 0129) takes an advisory lock
 * on (company, number), re-reads under it, and only inserts if nobody
 * has the number -- so the loser of the race is handed the winner's
 * contact instead of making a second one. Reading and writing from here
 * could not do that: whatever is read can be stale by the time the
 * insert lands.
 */
async function insertUnknownCallerLead(
  admin: Admin,
  companyId: string,
  input: {
    first: string;
    last: string;
    phone: string | null;
    email?: string | null;
    source: string;
    notes: string | null;
  }
): Promise<LeadCreateResult> {
  const { data, error } = await admin.rpc("create_lead_for_unknown_caller", {
    p_company_id: companyId,
    p_phone: input.phone ?? "",
    p_first_name: input.first,
    p_last_name: input.last,
    p_email: input.email ?? "",
    p_source: input.source,
    p_notes: input.notes,
  });

  if (!error) {
    const row = (Array.isArray(data) ? data[0] : data) as
      | { lead_id: string | null; created: boolean }
      | undefined;
    return { leadId: row?.lead_id ?? null, created: row?.created === true };
  }

  // Anything other than "the function is not there" is a real failure,
  // and it must not silently swallow a new caller: fall through to the
  // plain insert so the contact is still made, and log what went wrong.
  if (!isMissingFunction(error as QueryError)) {
    console.error("[callrail] create_lead_for_unknown_caller failed", error);
  } else {
    console.warn(
      "[callrail] run supabase/migrations/0129_one_contact_per_new_caller.sql in the Supabase SQL editor -- new contacts are unguarded until then"
    );
  }

  const { data: inserted, error: insertError } = await admin
    .from("leads")
    .insert({
      contact_type: "Individual",
      first_name: input.first || null,
      last_name: input.last || null,
      phone: input.phone || null,
      email: input.email || null,
      notes: input.notes,
      stage: "Unsorted",
      source: input.source,
      company_id: companyId,
    })
    .select("id")
    .single();
  if (insertError) return { leadId: null, created: false };
  return { leadId: (inserted as { id: string }).id, created: true };
}

async function createLeadFromCallRail(
  admin: Admin,
  companyId: string,
  input: {
    name: string | null;
    phone: string | null;
    email?: string | null;
    source: string;
    notes: string | null;
    /** True for historical imports: the lead is created, but nobody's
     *  phone buzzes about a call from weeks ago. The first backfill
     *  sent 45 alerts about old callers before this flag existed. */
    quiet?: boolean;
  }
): Promise<LeadCreateResult> {
  const { first, last } = splitName(input.name ?? "");
  const result = await insertUnknownCallerLead(admin, companyId, {
    first,
    last,
    phone: input.phone,
    email: input.email,
    source: input.source,
    notes: input.notes,
  });
  if (!result.created) return result;

  // Never allowed to fail the ingest -- the lead is already saved.
  if (!input.quiet) {
    await notifyNewLead(admin, {
      companyId,
      firstName: first,
      lastName: last,
      phone: input.phone ?? "",
      email: input.email ?? "",
      address: null,
      projectType: null,
      source: input.source,
      notes: input.notes,
    }).catch(() => ({ sent: 0 }));
  }

  return result;
}

/**
 * One finished CallRail call into call_logs -- and into the pipeline,
 * when the caller is nobody we know yet.
 *
 * Runs for both the webhook and the backfill, keyed on CallRail's call
 * id so the same call arriving twice lands as one row. Only inbound
 * calls: outbound dialing already lives on Twilio.
 */
export type CallProcessOpts = {
  /** Historical import: create leads without buzzing anyone's phone. */
  quiet?: boolean;
  /** Pre-built phone lookup for bulk sweeps -- per-call scans of the
   *  whole lead book would time a 90-day backfill out. */
  matchLead?: (phone: string) => PhoneMatch;
  registerLead?: (phone: string, id: string) => void;
};

export async function processCallRailCall(
  admin: Admin,
  companyId: string,
  call: CallRailCall,
  opts?: CallProcessOpts
): Promise<{ created?: boolean; skipped?: string }> {
  const callId = String(call.resource_id ?? call.id ?? "");
  if (!callId) return { skipped: "no call id" };
  if ((call.direction ?? "inbound") !== "inbound") return { skipped: "outbound" };

  const from = call.customer_phone_number ?? "";
  if (!from) return { skipped: "no caller number" };

  const marketing = marketingSourceLine(call);

  // Only the facts CallRail owns. Disposition and the lead link are
  // deliberately absent: a rep may have set the disposition or re-filed
  // the call by the time the 6-hour sweep re-reads it, and a sync must
  // never undo a human.
  const factsFromCallRail = {
    from_number: from,
    to_number: call.tracking_phone_number ?? "",
    status: call.answered ? "completed" : "missed",
    duration_seconds: Math.max(0, Math.round(Number(call.duration) || 0)),
    recording_url: call.recording_player || null,
    marketing_source: marketing,
  };

  // Have we imported this call before? Asked FIRST, ahead of anything
  // to do with contacts. The sweep re-reads the last two days of calls
  // four times a day, so a contact created above this line was a fresh
  // duplicate of the same caller on every pass.
  const { data: existing } = await admin
    .from("call_logs")
    .select("id")
    .eq("company_id", companyId)
    .eq("callrail_call_id", callId)
    .maybeSingle();

  if (existing) {
    await admin
      .from("call_logs")
      .update(factsFromCallRail)
      .eq("id", (existing as { id: string }).id);
    return { created: false };
  }

  // A new contact only for a number nobody has. When several contacts
  // share it the call is logged under the number alone and left for a
  // person to file -- guessing would put a call on a customer who was
  // never spoken to, and creating another card is how one caller turned
  // into three.
  const match = opts?.matchLead
    ? opts.matchLead(from)
    : await leadPhoneMatch(admin, companyId, from);
  let leadId = match.kind === "one" ? match.leadId : null;

  if (match.kind === "none") {
    // The lock inside create_lead_for_unknown_caller may reveal that
    // someone else just made this contact; then we file against theirs.
    const made = await createLeadFromCallRail(admin, companyId, {
      name: call.customer_name ?? null,
      phone: from,
      source: leadSource(call.source),
      notes: marketing ? `Called in via ${marketing}` : "Called in (CallRail)",
      quiet: opts?.quiet,
    });
    leadId = made.leadId;
    if (leadId) opts?.registerLead?.(from, leadId);
  }

  const { error } = await admin.from("call_logs").insert({
    ...factsFromCallRail,
    lead_id: leadId,
    rep_id: null,
    direction: "inbound",
    disposition: call.answered ? "No Disposition" : "No Answer",
    callrail_call_id: callId,
    company_id: companyId,
    ...(call.start_time ? { created_at: call.start_time } : {}),
  });
  if (error) {
    // A webhook and the backfill can race on the unique index; whoever
    // lost just refreshes the row the winner made.
    if (error.code === "23505") {
      await admin
        .from("call_logs")
        .update(factsFromCallRail)
        .eq("company_id", companyId)
        .eq("callrail_call_id", callId);
      return { created: false };
    }
    return { skipped: error.message };
  }
  return { created: true };
}

/**
 * Stamps a message onto an existing lead's notes. What a returning
 * customer wrote must land SOMEWHERE a person will read it -- dropping
 * it because they're "already a lead" is how "ready to start the
 * bathroom" goes unanswered.
 */
async function appendLeadNote(
  admin: Admin,
  companyId: string,
  leadId: string,
  note: string
): Promise<void> {
  const { data } = await admin
    .from("leads")
    .select("notes")
    .eq("id", leadId)
    .eq("company_id", companyId)
    .maybeSingle<{ notes: string | null }>();
  const existing = (data?.notes ?? "").trim();
  const stamped = `${new Date().toISOString().slice(0, 10)} — ${note}`;
  await admin
    .from("leads")
    .update({ notes: existing ? `${existing}\n\n${stamped}` : stamped })
    .eq("id", leadId)
    .eq("company_id", companyId);
}

/** The one lead with this email, or null -- mirroring the phone matcher's
 *  refusal to guess when several share it. */
async function leadForEmail(
  admin: Admin,
  companyId: string,
  email: string
): Promise<string | null> {
  const { data } = await admin
    .from("leads")
    .select("id")
    .eq("company_id", companyId)
    .ilike("email", email.trim())
    .limit(2);
  const rows = (data as { id: string }[]) ?? [];
  return rows.length === 1 ? rows[0].id : null;
}

/**
 * A CallRail form fill becomes a lead -- or, when the person already is
 * one, a note on their record.
 */
export async function processCallRailForm(
  admin: Admin,
  companyId: string,
  form: CallRailForm
): Promise<{ created?: boolean; skipped?: string }> {
  const fd = form.form_data ?? {};
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const phone = form.customer_phone_number || str(fd.phone) || str(fd.phone_number) || null;
  const email = form.customer_email || str(fd.email) || null;
  const name =
    form.customer_name || str(fd.name) || [str(fd.first_name), str(fd.last_name)].filter(Boolean).join(" ") || null;
  if (!phone && !email && !name) return { skipped: "empty form" };

  const message = str(fd.message) || str(fd.notes) || "";
  const noteText =
    ["Filled out a form (CallRail)", message, form.form_url ? `Form: ${form.form_url}` : ""]
      .filter(Boolean)
      .join("\n");

  const existingId =
    (phone ? await leadForPhoneNumber(admin, companyId, phone) : null) ??
    (email ? await leadForEmail(admin, companyId, email) : null);
  if (existingId) {
    await appendLeadNote(admin, companyId, existingId, noteText);
    return { skipped: "noted on existing lead" };
  }

  const made = await createLeadFromCallRail(admin, companyId, {
    name,
    phone,
    email,
    source: leadSource(form.source),
    notes: [message, form.form_url ? `Form: ${form.form_url}` : ""].filter(Boolean).join("\n") || null,
  });
  if (made.leadId && !made.created) {
    // They were already in the book after all -- the message goes on
    // their card rather than on a second one.
    await appendLeadNote(admin, companyId, made.leadId, noteText);
    return { skipped: "noted on existing lead" };
  }
  return made.created ? { created: true } : { skipped: "not created" };
}

/**
 * A text to a tracking number: a lead when the number is new, a note on
 * the lead when it isn't.
 */
export async function processCallRailText(
  admin: Admin,
  companyId: string,
  text: CallRailText
): Promise<{ created?: boolean; skipped?: string }> {
  const phone = text.source_number ?? "";
  if (!phone) return { skipped: "no number" };
  const body = text.content ? `Texted in: ${text.content.slice(0, 500)}` : "Texted a tracking number";
  const existing = await leadForPhoneNumber(admin, companyId, phone);
  if (existing) {
    await appendLeadNote(admin, companyId, existing, `${body} (CallRail)`);
    return { skipped: "noted on existing lead" };
  }
  const made = await createLeadFromCallRail(admin, companyId, {
    name: null,
    phone,
    source: "CallRail",
    notes: body,
  });
  if (made.leadId && !made.created) {
    await appendLeadNote(admin, companyId, made.leadId, `${body} (CallRail)`);
    return { skipped: "noted on existing lead" };
  }
  return made.created ? { created: true } : { skipped: "not created" };
}

/**
 * Re-pulls recent calls straight from the CallRail API and runs them
 * through the same processing as the webhook. CallRail does not retry a
 * failed webhook delivery, so without this a deploy moment or a hiccup
 * would silently swallow calls for good.
 */
export async function backfillCallRail(
  companyId: string,
  days = 3
): Promise<{ error?: string; processed: number; created: number }> {
  const creds = await getCallRailForCompany(companyId);
  if (!creds) return { error: "CallRail is not connected.", processed: 0, created: 0 };

  const admin = createAdminClient();
  const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  let processed = 0;
  let created = 0;

  // The whole phone book once, then in-memory matching -- the same
  // rules as leadPhoneMatch (last 10 digits, every phone field, and a
  // number several contacts share reported as "many" rather than as an
  // unknown caller).
  const allLeads = await selectAll<LeadPhoneRow>((f, t) =>
    admin
      .from("leads")
      .select("id, phone, phone2, phone3, second_contact_phone")
      .eq("company_id", companyId)
      .range(f, t)
  );
  const index = phoneIndex(allLeads);
  const opts: CallProcessOpts = {
    quiet: true,
    matchLead: (phone) => phoneMatchInIndex(index, phone),
    registerLead: (phone, id) => rememberInIndex(index, phone, id),
  };

  for (const crCompanyId of creds.callrailCompanyIds) {
    for (let page = 1; page <= 20; page++) {
      const url =
        `${CALLRAIL_API_BASE}/a/${encodeURIComponent(creds.accountId)}/calls.json` +
        `?company_id=${encodeURIComponent(crCompanyId)}` +
        `&start_date=${start}&per_page=250&page=${page}` +
        `&fields=${encodeURIComponent("source,campaign,keywords,medium,recording_player")}`;
      const res = await fetch(url, { headers: callrailAuthHeader(creds.apiKey) });
      if (!res.ok) return { error: `CallRail API ${res.status}`, processed, created };
      const body = (await res.json()) as { calls?: CallRailCall[]; total_pages?: number };
      for (const call of body.calls ?? []) {
        const r = await processCallRailCall(admin, companyId, call, opts);
        processed++;
        if (r.created) created++;
      }
      if (!body.total_pages || page >= body.total_pages) break;
    }
  }
  return { processed, created };
}
