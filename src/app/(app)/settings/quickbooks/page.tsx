import { AdminGate } from "@/components/admin-gate";
import { getQuickBooksSettings } from "@/lib/actions/quickbooks";
import { QuickBooksView } from "./quickbooks-view";

export const dynamic = "force-dynamic";
// Send now sends up to 40 bills and payments while the page waits.
export const maxDuration = 60;

/** Connecting QuickBooks Online and matching accounts (DECISIONS #172); sending bills (#173). */
export default async function QuickBooksPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const settings = await getQuickBooksSettings();
  return (
    <AdminGate>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">QuickBooks</h1>
          <p className="module-sub">Send your bills, invoices and payments to QuickBooks Online, so nobody types them twice.</p>
        </div>
      </div>
      {settings && <QuickBooksView settings={settings} justConnected={sp.connected === "1"} connectError={sp.error ?? null} />}
    </AdminGate>
  );
}
