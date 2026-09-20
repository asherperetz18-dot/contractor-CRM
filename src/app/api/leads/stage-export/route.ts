import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { isAdminRole } from "@/lib/data/types";
import {
  STAGE_EXPORT_COLUMNS,
  csvLine,
  stageExportFilename,
  type StageExportLead,
} from "@/lib/stage-export";

// A stage can hold the whole imported book (66k+ rows, ~15MB of CSV).
// That is too big for one buffered serverless response and too many
// rows for one select, so this streams: page after page is fetched and
// written straight into the response. A route handler rather than a
// Server Action because an action buffers its whole answer into a React
// payload — a download link is also the one thing a browser can save
// straight to disk.
export const maxDuration = 60;

const PAGE = 1000;

export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return new NextResponse("Not signed in.", { status: 401 });
  if (!isAdminRole(profile)) {
    return new NextResponse("Office or Admin only.", { status: 403 });
  }

  const stage = new URL(request.url).searchParams.get("stage")?.trim() ?? "";
  if (!stage) return new NextResponse("Missing stage.", { status: 400 });

  // Runs as the signed-in user: RLS scopes the read to their company
  // even before the explicit company_id filter below.
  const supabase = await createClient();
  const companyId = profile.company_id;
  // id rides along for the keyset cursor; it is not a CSV column.
  const columns = ["id", ...STAGE_EXPORT_COLUMNS.map((c) => c.key)].join(", ");

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(
          encoder.encode(STAGE_EXPORT_COLUMNS.map((c) => c.header).join(","))
        );
        // Keyset pagination ("id past the last one seen"), not offsets:
        // OFFSET re-scans everything it skips, which over a 66k-row
        // stage turns 66 pages into quadratic work — and a row inserted
        // or deleted mid-export shifts every later offset, silently
        // dropping or doubling rows in the one file that is the backup.
        let lastId = "";
        for (;;) {
          let query = supabase
            .from("leads")
            .select(columns)
            .eq("company_id", companyId)
            .eq("stage", stage)
            .order("id")
            .limit(PAGE);
          if (lastId) query = query.gt("id", lastId);
          const { data, error } = await query;
          if (error) throw new Error(error.message);
          const rows = (data as unknown as (StageExportLead & { id: string })[]) ?? [];
          if (rows.length > 0) {
            controller.enqueue(
              encoder.encode("\n" + rows.map(csvLine).join("\n"))
            );
            lastId = rows[rows.length - 1].id;
          }
          if (rows.length < PAGE) break;
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${stageExportFilename(stage)}"`,
      "Cache-Control": "no-store",
    },
  });
}
