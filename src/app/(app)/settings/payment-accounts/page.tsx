import { getCurrentProfile } from "@/lib/data/profile";
import { canManageBills } from "@/lib/data/types";
import { getPaymentAccounts } from "@/lib/actions/payment-accounts";
import { PaymentAccountsView } from "./payment-accounts-view";

export const dynamic = "force-dynamic";

/**
 * The accounts bill money comes out of -- the "Paid from" on every bill
 * payment. QuickBooks needs one on each Bill Payment, so recording it
 * from day one leaves every payment ready to sync.
 */
export default async function PaymentAccountsPage() {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const { ready, accounts, error } = await getPaymentAccounts(true);
  if (error) {
    return (
      <div className="empty-state">
        <p className="empty-label">Couldn&apos;t load payment accounts</p>
        <p className="empty-hint">{error}</p>
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="empty-state">
        <p className="empty-label">One database update first</p>
        <p className="empty-hint">
          Run <code>supabase/migrations/0176_bill_payment_accounts.sql</code> in the Supabase SQL
          editor, then reload this page. Until then bills save without a &ldquo;Paid from&rdquo;
          account.
        </p>
      </div>
    );
  }
  return <PaymentAccountsView accounts={accounts} canEdit={canManageBills(profile)} />;
}
