import { NextResponse } from "next/server";
import { version } from "../../../../package.json";
import { notesForVersion } from "@/lib/release-notes";

// Never cached and never prerendered. A cached answer here would be the
// old version telling everyone they are up to date, which is the one
// thing this route must not do.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * What version is currently deployed, and what changed in it.
 *
 * The client compares `version` against the version it was loaded with.
 * Those differ exactly when a deploy has happened since the tab was
 * opened -- the browser is still running the old bundle while this route
 * is served by the new one -- and the popup it then shows lists `notes`,
 * so "refresh to get the update" says what the update is.
 *
 * Deliberately says nothing else. It is called on a timer by every open
 * tab, so it stays a public, cheap, non-authenticated read of a number
 * that is already printed in the sidebar and notes that are already on
 * every signed-in screen.
 */
export async function GET() {
  const release = notesForVersion(version);
  return NextResponse.json(
    { version, notes: release?.notes ?? [] },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
