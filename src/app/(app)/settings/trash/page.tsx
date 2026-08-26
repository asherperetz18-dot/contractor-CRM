import { AdminGate } from "@/components/admin-gate";
import { listLeadTrash } from "@/lib/actions/lead-trash";
import { TrashView } from "./trash-view";

export const dynamic = "force-dynamic";

export default async function TrashSettingsPage() {
  const { entries } = await listLeadTrash();
  return (
    <AdminGate>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Trash</h1>
          <p className="module-sub">
            Deleted contacts are kept here for 30 days — restore brings back the contact with
            its estimates, appointments, notes, tasks, files, and texts
          </p>
        </div>
      </div>
      <TrashView entries={entries ?? []} />
    </AdminGate>
  );
}
