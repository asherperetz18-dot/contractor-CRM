import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { selectAll } from "./select-all";
import { INVOICE_DOC_COLUMNS, INVOICE_DOC_FILTER, INVOICE_STAGE_COLUMNS, type InvoiceStageLite } from "./invoice-rows";
import {
  buildStatement,
  type CustomerStatement,
  type StatementCredit,
  type StatementDoc,
  type StatementPayment,
} from "./customer-statement";

/**
 * The rows behind one customer's statement (DECISIONS #153): their
 * documents that carry bills, the billed stages on them and the payments
 * filed to them -- this company's, this customer's, nothing else. Read as
 * the signed-in person, so row level security narrows them as always.
 */

type Db = Awaited<ReturnType<typeof createClient>>;

const IN_CHUNK = 150;

async function forChunks<T>(ids: string[], read: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) out.push(...(await read(ids.slice(i, i + IN_CHUNK))));
  return out;
}

export const STATEMENT_PAYMENT_COLUMNS =
  "estimate_id, estimate_payment_id, kind, status, amount_cents, method, reference, paid_at, created_at, stripe_session_id, stripe_payment_intent_id";

export async function loadCustomerStatement(
  supabase: Db,
  companyId: string,
  leadId: string,
  opts: { today: string; zone: string }
): Promise<CustomerStatement> {
  const docs = await selectAll<StatementDoc>((f, t) =>
    supabase
      .from("estimates")
      .select(`${INVOICE_DOC_COLUMNS}, deposit_cents`)
      .eq("company_id", companyId)
      .eq("lead_id", leadId)
      .or(INVOICE_DOC_FILTER)
      .order("id")
      .range(f, t)
  );
  const ids = docs.map((d) => d.id);
  const [stages, payments, credits] = await Promise.all([
    forChunks(ids, (chunk) =>
      selectAll<InvoiceStageLite>((f, t) =>
        supabase
          .from("estimate_payments")
          .select(INVOICE_STAGE_COLUMNS)
          .eq("company_id", companyId)
          .in("estimate_id", chunk)
          .not("requested_at", "is", null)
          .order("id")
          .range(f, t)
      )
    ),
    forChunks(ids, (chunk) =>
      selectAll<StatementPayment>((f, t) =>
        supabase
          .from("portal_payments")
          .select(STATEMENT_PAYMENT_COLUMNS)
          .eq("company_id", companyId)
          .in("estimate_id", chunk)
          .order("id")
          .range(f, t)
      )
    ),
    // Credits on their bills (0209, DECISIONS #154); none before it.
    forChunks(ids, (chunk) =>
      selectAll<StatementCredit>((f, t) =>
        supabase
          .from("bill_credits")
          .select("estimate_payment_id, amount_cents, reason, created_at")
          .eq("company_id", companyId)
          .in("estimate_id", chunk)
          .order("id")
          .range(f, t)
      )
    ),
  ]);
  return buildStatement(docs, stages, payments, opts, credits);
}
