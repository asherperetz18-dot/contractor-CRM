import { AdminGate } from "@/components/admin-gate";
import { getGoogleDriveStatus } from "@/lib/actions/google-drive";
import { getCurrentProfile } from "@/lib/data/profile";
import { createAdminClient } from "@/lib/supabase/admin";
import { CloudStorageView } from "./cloud-storage-view";

export type DriveCategoryStat = {
  name: string;
  synced: number;
  total: number;
  syncedBytes: number;
};

/**
 * How much of each category already lives in Drive -- the reference
 * product's Sync Status block, computed from lead_files. Photos is
 * anything a camera made; Documents is the rest. Contracts and
 * Proposals join once the app can render its own documents to PDF.
 */
async function driveCategoryStats(): Promise<DriveCategoryStat[]> {
  const profile = await getCurrentProfile();
  if (!profile) return [];
  const admin = createAdminClient();
  const rows: { storage_provider: string | null; content_type: string | null; file_size: number | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await admin
      .from("lead_files")
      .select("storage_provider, content_type, file_size")
      .eq("company_id", profile.company_id)
      .range(from, from + 999)
      .returns<{ storage_provider: string | null; content_type: string | null; file_size: number | null }[]>();
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  const stats: Record<string, DriveCategoryStat> = {
    Photos: { name: "Photos", synced: 0, total: 0, syncedBytes: 0 },
    Documents: { name: "Documents", synced: 0, total: 0, syncedBytes: 0 },
  };
  for (const r of rows) {
    const cat =
      r.content_type?.startsWith("image/") || r.content_type?.startsWith("video/")
        ? "Photos"
        : "Documents";
    stats[cat].total += 1;
    if (r.storage_provider === "google_drive") {
      stats[cat].synced += 1;
      stats[cat].syncedBytes += r.file_size ?? 0;
    }
  }
  const out = [stats.Photos, stats.Documents];

  // Documents-as-PDFs: signed paperwork and live proposals. Isolated
  // query so this page keeps working before migration 0098 adds the
  // sync columns -- the two cards just don't appear yet.
  const { data: docs, error: docsError } = await admin
    .from("estimates")
    .select("kind, status, updated_at, drive_pdf_id, drive_pdf_synced_at")
    .eq("company_id", profile.company_id)
    .returns<
      { kind: string | null; status: string; updated_at: string; drive_pdf_id: string | null; drive_pdf_synced_at: string | null }[]
    >();
  if (!docsError && docs) {
    const contracts: DriveCategoryStat = { name: "Contracts", synced: 0, total: 0, syncedBytes: 0 };
    const proposals: DriveCategoryStat = { name: "Proposals", synced: 0, total: 0, syncedBytes: 0 };
    for (const d of docs) {
      const bucket =
        d.status === "Signed"
          ? contracts
          : (d.kind ?? "contract") === "contract" && (d.status === "Sent" || d.status === "Viewed")
            ? proposals
            : null;
      if (!bucket) continue;
      bucket.total += 1;
      const fresh =
        !!d.drive_pdf_id &&
        !!d.drive_pdf_synced_at &&
        new Date(d.drive_pdf_synced_at).getTime() >= new Date(d.updated_at).getTime();
      if (fresh) bucket.synced += 1;
    }
    out.push(contracts, proposals);
  }
  return out;
}

export default async function CloudStoragePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const status = await getGoogleDriveStatus();
  const categories = status.connected && !status.expired ? await driveCategoryStats() : [];

  return (
    <AdminGate>
      <CloudStorageView
        connected={status.connected}
        email={status.email}
        expired={status.expired}
        connectError={error}
        categories={categories}
      />
    </AdminGate>
  );
}
