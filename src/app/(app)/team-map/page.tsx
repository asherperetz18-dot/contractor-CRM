import { AdminGate } from "@/components/admin-gate";
import { TeamMapView } from "./team-map-view";

export const dynamic = "force-dynamic";

export default async function TeamMapPage() {
  return (
    <AdminGate>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Team Map</h1>
          <p className="module-sub">Everyone on the clock, live. People off the clock aren&apos;t shown.</p>
        </div>
      </div>
      <TeamMapView />
    </AdminGate>
  );
}
