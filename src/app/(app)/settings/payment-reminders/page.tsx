import Link from "next/link";
import { AdminGate } from "@/components/admin-gate";
import { getBillReminderSettings } from "@/lib/actions/settings";
import { PaymentRemindersForm } from "./payment-reminders-form";

export const dynamic = "force-dynamic";

export default async function PaymentRemindersPage() {
  const settings = await getBillReminderSettings();
  return (
    <AdminGate>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Payment Reminders</h1>
          <p className="module-sub">
            Remind customers about bills they still owe, automatically: invoices, and stages of a
            contract you&apos;ve billed. See every bill on <Link href="/invoices">Invoices</Link>.
          </p>
        </div>
      </div>
      {settings && <PaymentRemindersForm initial={settings} />}
    </AdminGate>
  );
}
