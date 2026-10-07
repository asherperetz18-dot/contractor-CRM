import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { selectAll } from "./select-all";
import { financedContracts } from "./financed-contracts";
import {
  INVOICE_DOC_COLUMNS,
  INVOICE_DOC_FILTER,
  INVOICE_PAYMENT_COLUMNS,
  INVOICE_STAGE_COLUMNS,
  buildInvoiceRows,
  type InvoiceDocLite,
  type InvoicePaymentLite,
  type InvoiceRow,
  type InvoiceStageLite,
} from "./invoice-rows";

/**
 * The rows behind Invoices and Money to Collect (DECISIONS #148), read
 * once and the same way for both: signed and cancelled documents and
 * draft invoices (#149), billed
 * stages and the payments filed to them -- only the columns the rows are
 * built from -- plus the customers they name. Read as the signed-in
 * person, so row level security narrows them as always.
 */

type Db = Awaited<ReturnType<typeof createClient>>;

/** How many ids go in one in() filter, so a long list can't outgrow the request URL. */
const IN_CHUNK = 150;

async function forChunks<T>(ids: string[], read: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) out.push(...(await read(ids.slice(i, i + IN_CHUNK))));
  return out;
}

export type InvoiceLead = {
  id: string;
  contact_type: string | null;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  address: string | null;
  assigned_to: string | null;
};

export async function loadInvoiceRows(
  supabase: Db,
  companyId: string,
  today: string,
  opts: { views?: boolean } = {}
): Promise<{
  rows: InvoiceRow[];
  docs: InvoiceDocLite[];
  payments: InvoicePaymentLite[];
  leadById: Map<string, InvoiceLead>;
  /** Contracts paying with financing (DECISIONS #166), with their lender. */
  financed: Map<string, string>;
}> {
  const [docs, stages, payments, financed] = await Promise.all([
    selectAll<InvoiceDocLite>((f, t) =>
      supabase
        .from("estimates")
        .select(INVOICE_DOC_COLUMNS)
        .eq("company_id", companyId)
        .or(INVOICE_DOC_FILTER)
        .order("id")
        .range(f, t)
    ),
    selectAll<InvoiceStageLite>((f, t) =>
      supabase
        .from("estimate_payments")
        .select(INVOICE_STAGE_COLUMNS)
        .eq("company_id", companyId)
        .not("requested_at", "is", null)
        .order("id")
        .range(f, t)
    ),
    selectAll<InvoicePaymentLite>((f, t) =>
      supabase
        .from("portal_payments")
        .select(INVOICE_PAYMENT_COLUMNS)
        .eq("company_id", companyId)
        .not("estimate_payment_id", "is", null)
        .order("id")
        .range(f, t)
    ),
    // Their bills read Financing, not Overdue (#167). Before 0217, none.
    financedContracts(supabase, companyId),
  ]);

  // When each bill was last sent (0206, DECISIONS #150), for the Invoices
  // page's Sent. Its own read, so a database without 0206 -- or any
  // trouble here -- only means every bill reads Billed.
  const sentByStage = new Map<string, string>();
  if (opts.views) {
    const sends = await selectAll<{ id: string; sent_at: string }>((f, t) =>
      supabase
        .from("estimate_payments")
        .select("id, sent_at")
        .eq("company_id", companyId)
        .not("sent_at", "is", null)
        .not("requested_at", "is", null)
        .order("id")
        .range(f, t)
    );
    for (const s of sends) sentByStage.set(s.id, s.sent_at);
  }

  let rows = buildInvoiceRows(docs, stages, payments, new Map(), today, sentByStage, financed);

  // Whether the customer has opened a bill since it went out -- asked
  // only about the documents with a bill still waiting on that answer.
  if (opts.views) {
    const waiting = rows.filter((r) => r.status === "billed" || r.status === "sent");
    const docIds = [...new Set(waiting.map((r) => r.docId))];
    if (docIds.length) {
      const since = waiting.reduce((min, r) => (r.billedAt < min ? r.billedAt : min), waiting[0].billedAt);
      const views = await forChunks(docIds, (chunk) =>
        selectAll<{ estimate_id: string; viewed_at: string }>((f, t) =>
          supabase
            .from("estimate_views")
            .select("estimate_id, viewed_at")
            .eq("company_id", companyId)
            .in("estimate_id", chunk)
            .gte("viewed_at", since)
            .order("viewed_at", { ascending: false })
            .range(f, t)
        )
      );
      const lastView = new Map<string, string>();
      for (const v of views) if (!lastView.has(v.estimate_id)) lastView.set(v.estimate_id, v.viewed_at);
      if (lastView.size) rows = buildInvoiceRows(docs, stages, payments, lastView, today, sentByStage, financed);
    }
  }

  const leads = await loadInvoiceLeads(supabase, companyId, rows.map((r) => r.leadId));
  return { rows, docs, payments, leadById: new Map(leads.map((l) => [l.id, l])), financed };
}

/** The customers a set of bills names: only those, never the whole book. */
export async function loadInvoiceLeads(supabase: Db, companyId: string, ids: string[]): Promise<InvoiceLead[]> {
  return forChunks([...new Set(ids.filter(Boolean))], (chunk) =>
    selectAll<InvoiceLead>((f, t) =>
      supabase
        .from("leads")
        .select("id, contact_type, first_name, last_name, company_name, address, assigned_to")
        .eq("company_id", companyId)
        .in("id", chunk)
        .range(f, t)
    )
  );
}
