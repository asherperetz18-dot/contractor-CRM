import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { isAdminRole } from "@/lib/data/types";

// Deletes every contact in one pipeline stage, in batches. 66k rows
// cannot go through the per-lead trash snapshot (66k snapshots) or one
// DELETE statement (statement timeout), so this hard-deletes id-batches
// until the stage is empty or the time budget is spent, then reports
// what's left — the browser keeps calling while `remaining > 0`, so no
// single request has to survive the whole job. The CSV export next to
// this button is the backup; the confirm in the UI says so.
export const maxDuration = 60;

// Spend at most this long deleting per request; the rest of maxDuration
// is headroom for the count query and slow batches already in flight.
const TIME_BUDGET_MS = 20_000;
// Ids ride in the query string, so a delete batch has to stay small
// enough for a URL. 200 uuids ≈ 7KB — comfortably under server limits.
const DELETE_CHUNK = 200;
const SELECT_PAGE = 1000;

export async function POST(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!isAdminRole(profile)) {
    return NextResponse.json({ error: "Office or Admin only." }, { status: 403 });
  }

  let body: { stage?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const stage = typeof body.stage === "string" ? body.stage.trim() : "";
  if (!stage) return NextResponse.json({ error: "Missing stage." }, { status: 400 });

  // Runs as the signed-in user, so the leads_delete RLS policy — not
  // just the role check above — has the final word on every batch.
  const supabase = await createClient();
  const companyId = profile.company_id;
  const started = Date.now();
  let deleted = 0;

  while (Date.now() - started < TIME_BUDGET_MS) {
    const { data: idRows, error: selectError } = await supabase
      .from("leads")
      .select("id")
      .eq("company_id", companyId)
      .eq("stage", stage)
      .order("id")
      .limit(SELECT_PAGE);
    if (selectError) {
      return NextResponse.json({ error: selectError.message, deleted }, { status: 500 });
    }
    const ids = ((idRows as { id: string }[]) ?? []).map((r) => r.id);
    if (ids.length === 0) break;

    for (let i = 0; i < ids.length; i += DELETE_CHUNK) {
      const chunk = ids.slice(i, i + DELETE_CHUNK);
      const { error: deleteError, count: deletedNow } = await supabase
        .from("leads")
        .delete({ count: "exact" })
        .eq("company_id", companyId)
        .eq("stage", stage)
        .in("id", chunk);
      if (deleteError) {
        return NextResponse.json({ error: deleteError.message, deleted }, { status: 500 });
      }
      // RLS refusing the delete surfaces as "0 rows deleted", not as an
      // error. Without this check the loop would re-select the same ids
      // until the budget ran out, and the browser would retry forever.
      if (!deletedNow) {
        return NextResponse.json(
          { error: "Nothing was deleted — you may not have permission to delete contacts.", deleted },
          { status: 403 }
        );
      }
      deleted += deletedNow;
      if (Date.now() - started >= TIME_BUDGET_MS) break;
    }
  }

  const { count } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("stage", stage);
  const remaining = count ?? 0;

  if (deleted > 0) {
    revalidatePath("/pipeline");
    revalidatePath("/contacts");
    revalidatePath("/settings/pipeline-stages");
  }

  return NextResponse.json({ deleted, remaining });
}
