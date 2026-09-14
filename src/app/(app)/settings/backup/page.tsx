import { AdminGate } from "@/components/admin-gate";
import { countBackupRows } from "@/lib/backup";
import { BackupView } from "./backup-view";

// Never prerendered: the counts must reflect the live database, and a
// build-time render of this page once read every table in full and
// timed the whole deploy out (60s static-generation cap) the day 73k
// leads were imported.
export const dynamic = "force-dynamic";

export default async function BackupPage() {
  // Counts only -- the page shows what a backup would contain without
  // reading a single customer record just to render a table. The full
  // read stays in buildBackup(), reached only when a backup actually runs.
  const backup = await countBackupRows();

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
