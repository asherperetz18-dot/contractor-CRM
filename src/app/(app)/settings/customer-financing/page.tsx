import { AdminGate } from "@/components/admin-gate";
import { getFinancingSettings } from "@/lib/actions/financing";
import { FinancingForm, FinancingOfferForm, LendersForm } from "./financing-form";

export const dynamic = "force-dynamic";

/** The lender the company's customers apply to (DECISIONS #161). */
export default async function CustomerFinancingPage() {
  const settings = await getFinancingSettings();
  return (
    <AdminGate>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Customer Financing</h1>
          <p className="module-sub">
            Let customers apply for financing with your lenders, from their estimates and contracts.
          </p>
        </div>
      </div>
      {/* Several lenders, once 0220 has run (DECISIONS #170); before it,
          the one lender as before, and how to get the list. */}
      {settings?.lenders.ready ? (
        <LendersForm lenders={settings.lenders.list} />
      ) : (
        settings && (
          <>
            <FinancingForm initial={settings} />
            <p className="est-tax-note">
              To offer more than one lender, run 0220_financing_lenders.sql in Supabase. Your lender above moves into the
              list on its own.
            </p>
          </>
        )
      )}
      {/* Who sees it, and what it costs (DECISIONS #169). */}
      {settings && <FinancingOfferForm initial={settings.offer} feePerLender={settings.lenders.ready} />}
    </AdminGate>
  );
}
