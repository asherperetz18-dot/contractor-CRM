import { AdminGate } from "@/components/admin-gate";
import { getGoogleDriveStatus } from "@/lib/actions/google-drive";
import { CloudStorageView } from "./cloud-storage-view";

export default async function CloudStoragePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const status = await getGoogleDriveStatus();

  return (
    <AdminGate>
      <CloudStorageView
        connected={status.connected}
        email={status.email}
        connectError={error}
      />
    </AdminGate>
  );
}
