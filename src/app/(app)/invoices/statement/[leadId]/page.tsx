import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { getRoleNamesCached } from "@/lib/data/company-chrome";
import { roleName } from "@/lib/role-names";
import { canViewFinancials } from "@/lib/data/accounting-access";
import { canManageBills } from "@/lib/data/types";
import { companyToday, getCompanyZone } from "@/lib/data/company-today";
import { clientName } from "@/lib/data/client-name";
import { loadCustomerStatement } from "@/lib/data/load-customer-statement";
import { PrintButton } from "@/components/print-button";
import { EmailStatementButton } from "./email-statement-button";
import { StatementDocument, type StatementCompany } from "./statement-document";

export const dynamic = "force-dynamic";

/**
 * One customer's statement (DECISIONS #153): every bill and payment, the
 * balance after each, and what is owed now -- printable, and sent by
 * email. Company money, so the same door as Invoices.
 */
export default async function CustomerStatementPage({ params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params;
  const profile = await getCurrentProfile();
  if (!profile) return null;

  if (!canViewFinancials(profile)) {
    const bookkeeping = roleName(await getRoleNamesCached(profile.company_id), "Bookkeeping");
    return (
      <div className="empty-state">
        <p className="empty-label">You don&apos;t have access to statements</p>
        <p className="empty-hint">
          A statement is company-wide money — {bookkeeping}, Office and Admin, or anyone switched on
          under Settings › Users &amp; Roles › View Financials.
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: lead }, { data: company }, today, zone] = await Promise.all([
    supabase
      .from("leads")
      .select("id, contact_type, first_name, last_name, company_name, address, email, second_contact_email")
      .eq("id", leadId)
      .eq("company_id", profile.company_id)
      .maybeSingle<{
        id: string;
        contact_type: string | null;
        first_name: string | null;
        last_name: string | null;
        company_name: string | null;
        address: string | null;
        email: string | null;
        second_contact_email: string | null;
      }>(),
    supabase
      .from("company_profile")
      .select("name, address, phone, email, logo_url")
      .eq("company_id", profile.company_id)
      .maybeSingle<StatementCompany>(),
    companyToday(),
    getCompanyZone(),
  ]);
  if (!lead) notFound();

  const statement = await loadCustomerStatement(supabase, profile.company_id, lead.id, { today, zone });
  const customer = clientName(lead) || "Customer";

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Statement — {customer}</h1>
          <p className="module-sub">
            Every bill and payment for this customer, and what they owe now. Print it, save it as a
            PDF, or email it to them.
          </p>
        </div>
        <div className="toolbar-actions">
          <Link href="/invoices" className="btn-ghost">
            Back to invoices
          </Link>
          <PrintButton label="Print / Save as PDF" title={`Statement - ${customer}`} />
          {canManageBills(profile) && <EmailStatementButton leadId={lead.id} hasEmail={!!(lead.email || lead.second_contact_email)} />}
        </div>
      </div>

      <StatementDocument
        company={company ?? null}
        customer={customer}
        address={lead.address}
        today={today}
        statement={statement}
      />
    </div>
  );
}
