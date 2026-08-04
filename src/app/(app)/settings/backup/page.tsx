import { AdminGate } from "@/components/admin-gate";
import { buildBackup } from "@/lib/backup";
import { BackupView } from "./backup-view";

export default async function BackupPage() {
  // Counts only -- the page shows what a backup would contain without
  // shipping every customer record to the browser just to render a table.
  const backup = await buildBackup();

  return (
    <AdminGate>
      <BackupView
        counts={backup.counts}
        skipped={backup.skipped}
        totalRows={backup.totalRows}
      />
    </AdminGate>
  );
}
