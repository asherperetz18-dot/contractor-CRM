import { NextRequest, NextResponse } from "next/server";
import { getCronSecret } from "@/lib/cron-env";
import { buildBackup } from "@/lib/backup";

/**
 * Full data export, for the nightly backup job.
 *
 * Behind the same cron secret as the reminder jobs -- this returns every
 * customer record in the database, so it must never be reachable without
 * it. Responds with the JSON body so the caller can write it wherever it
 * keeps backups.
 */
export async function POST(req: NextRequest) {
  const cronSecret = getCronSecret();
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const backup = await buildBackup();
    // A backup that quietly omitted a table would look successful until
    // the day it was needed, so a partial export is reported as a failure.
    const failed = Object.keys(backup.skipped);
    return NextResponse.json(backup, {
      status: failed.length ? 500 : 200,
      headers: {
        "Content-Disposition": `attachment; filename="crm-backup-${backup.generatedAt.slice(0, 10)}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Backup failed." },
      { status: 500 }
    );
  }
}
