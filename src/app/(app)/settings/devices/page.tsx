import { AdminGate } from "@/components/admin-gate";
import { DevicesView } from "./devices-view";

export const dynamic = "force-dynamic";

export default async function DevicesPage() {
  return (
    <AdminGate>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Signed-in Devices</h1>
          <p className="module-sub">
            Where your team is logged in, and how to cut a device off
          </p>
        </div>
      </div>
      <DevicesView />
    </AdminGate>
  );
}
