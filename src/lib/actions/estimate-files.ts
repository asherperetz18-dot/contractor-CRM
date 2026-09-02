"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { selectAll } from "@/lib/data/select-all";
import { canEditChecklists, type EstimatePhoto, type LeadPhoto } from "@/lib/data/types";

const JOINED =
  "id, estimate_id, estimate_item_id, lead_file_id, caption, sort_order, " +
  "lead_files ( file_name, file_url, content_type, file_path, storage_provider )";

/**
 * Refuses to change a document the customer has already signed.
 *
 * The contract text is frozen at signature and the photos have to be
 * too. A photo that can be swapped afterwards makes the signed document
 * evidence of nothing -- which matters most on a change order, where the
 * picture of what was found behind the wall is the whole justification
 * for the charge.
 */
async function assertUnsigned(
  supabase: Awaited<ReturnType<typeof createClient>>,
  estimateId: string,
  companyId: string
): Promise<{ error?: string }> {
  const { data } = await supabase
    .from("estimates")
    .select("status")
    .eq("id", estimateId)
    .eq("company_id", companyId)
    .maybeSingle<{ status: string }>();
  if (!data) return { error: "That document couldn't be found." };
  if (data.status === "Signed") {
    return { error: "This is signed — its photos are part of what was agreed and can't change." };
  }
  return {};
}

export async function getEstimatePhotos(
  estimateId: string
): Promise<{ error?: string; photos?: EstimatePhoto[] }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("estimate_files")
    .select(JOINED)
    .eq("estimate_id", estimateId)
    .eq("company_id", profile.company_id)
    .order("sort_order", { ascending: true })
    .returns<
      (Omit<EstimatePhoto, "file_name" | "file_url" | "content_type"> & {
        lead_files: {
          file_name: string;
          file_url: string;
          content_type: string | null;
          file_path: string | null;
          storage_provider: string | null;
        } | null;
      })[]
    >();
  if (error) return { error: error.message };

  return {
    photos: (data ?? []).map((r) => ({
      id: r.id,
      estimate_id: r.estimate_id,
      estimate_item_id: r.estimate_item_id,
      lead_file_id: r.lead_file_id,
      caption: r.caption,
      sort_order: r.sort_order,
      file_name: r.lead_files?.file_name ?? "Photo",
      file_url: r.lead_files?.file_url ?? "",
      content_type: r.lead_files?.content_type ?? null,
      file_path: r.lead_files?.file_path ?? null,
      storage_provider: r.lead_files?.storage_provider ?? null,
    })),
  };
}

/** The job's photos, for picking from rather than uploading again. */
export async function getLeadPhotos(
  leadId: string
): Promise<{ error?: string; photos?: LeadPhoto[] }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  const rows = await selectAll<LeadPhoto>((from, to) =>
    supabase
      .from("lead_files")
      .select("id, file_name, file_url, content_type, created_at, file_path, storage_provider")
      .eq("lead_id", leadId)
      .eq("company_id", profile.company_id)
      // Pictures and PDFs. Plans, permits and spec sheets belong on a
      // proposal for the same reason a photograph does -- they are the
      // reason for the price -- and this was images only, so a rep who
      // uploaded the drawings to the contact could not attach them.
      .or("content_type.like.image/%,content_type.eq.application/pdf")
      .order("created_at", { ascending: false })
      .range(from, to)
  );
  return { photos: rows };
}

/**
 * The paperwork of ONE job: files filed under this contract, plus the
 * customer's not-yet-filed documents offered separately -- a customer
 * with two contracts must never see job A's permit under job B, but a
 * file nobody has filed yet should be one click from its home, not
 * hidden.
 */
export async function getJobDocuments(
  leadId: string,
  estimateId: string
): Promise<{ error?: string; filed?: LeadPhoto[]; unfiled?: LeadPhoto[] }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  const rows = await selectAll<LeadPhoto & { estimate_id: string | null }>((from, to) =>
    supabase
      .from("lead_files")
      .select("id, file_name, file_url, content_type, created_at, file_path, storage_provider, estimate_id")
      .eq("lead_id", leadId)
      .eq("company_id", profile.company_id)
      // Documents means "not media": images live in the Photos modal,
      // site video with the visit. A file with no recorded type is
      // kept -- an untyped permit beats a hidden one.
      .or(
        "content_type.is.null,and(content_type.not.like.image/%,content_type.not.like.video/%)"
      )
      .order("created_at", { ascending: false })
      .range(from, to)
  );
  return {
    filed: rows.filter((r) => r.estimate_id === estimateId),
    // Files filed under a DIFFERENT contract are someone else's
    // paperwork and appear nowhere here.
    unfiled: rows.filter((r) => r.estimate_id === null),
  };
}

/**
 * The photos of ONE job, split the same way the documents are: filed
 * under this contract, and the customer's unfiled pictures offered
 * separately for one-click filing.
 */
export async function getJobPhotos(
  leadId: string,
  estimateId: string
): Promise<{ error?: string; filed?: LeadPhoto[]; unfiled?: LeadPhoto[] }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  const rows = await selectAll<LeadPhoto & { estimate_id: string | null }>((from, to) =>
    supabase
      .from("lead_files")
      .select("id, file_name, file_url, content_type, created_at, file_path, storage_provider, estimate_id")
      .eq("lead_id", leadId)
      .eq("company_id", profile.company_id)
      .like("content_type", "image/%")
      .order("created_at", { ascending: false })
      .range(from, to)
  );
  return {
    filed: rows.filter((r) => r.estimate_id === estimateId),
    unfiled: rows.filter((r) => r.estimate_id === null),
  };
}

/**
 * Files a document under a job (or back to the customer with null).
 * Same roles that shape checklists: the people who run the paperwork.
 */
export async function fileDocumentUnderJob(
  leadFileId: string,
  estimateId: string | null
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canEditChecklists(profile)) {
    return { error: "Only Office, Admin or Production users can file documents." };
  }

  const admin = createAdminClient();
  const { data: file } = await admin
    .from("lead_files")
    .select("id, lead_id")
    .eq("id", leadFileId)
    .eq("company_id", profile.company_id)
    .maybeSingle<{ id: string; lead_id: string }>();
  if (!file) return { error: "That file couldn't be found." };

  if (estimateId) {
    // The target must be a document on the SAME customer.
    const { data: est } = await admin
      .from("estimates")
      .select("id")
      .eq("id", estimateId)
      .eq("lead_id", file.lead_id)
      .eq("company_id", profile.company_id)
      .maybeSingle();
    if (!est) return { error: "That job doesn't belong to this customer." };
  }

  const { error } = await admin
    .from("lead_files")
    .update({ estimate_id: estimateId })
    .eq("id", leadFileId);
  if (error) return { error: error.message };
  revalidatePath("/projects");
  return {};
}

export async function attachEstimatePhoto(input: {
  estimateId: string;
  leadFileId: string;
  estimateItemId?: string | null;
  caption?: string;
}): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  const frozen = await assertUnsigned(supabase, input.estimateId, profile.company_id);
  if (frozen.error) return frozen;

  const { error } = await supabase.from("estimate_files").insert({
    company_id: profile.company_id,
    estimate_id: input.estimateId,
    estimate_item_id: input.estimateItemId || null,
    lead_file_id: input.leadFileId,
    caption: input.caption?.trim() || null,
    created_by: profile.id,
  });
  if (error) {
    // The unique index caught a second attach of the same photo. Always a
    // mis-click, and it would have printed twice on the customer's copy.
    if (error.code === "23505") return { error: "That photo is already on this document." };
    return { error: error.message };
  }

  revalidatePath("/estimates");
  return {};
}

export async function updateEstimatePhoto(
  photoId: string,
  changes: { caption?: string; estimateItemId?: string | null }
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("estimate_files")
    .select("estimate_id")
    .eq("id", photoId)
    .eq("company_id", profile.company_id)
    .maybeSingle<{ estimate_id: string }>();
  if (!row) return { error: "That photo couldn't be found." };

  const frozen = await assertUnsigned(supabase, row.estimate_id, profile.company_id);
  if (frozen.error) return frozen;

  const patch: Record<string, unknown> = {};
  if (changes.caption !== undefined) patch.caption = changes.caption.trim() || null;
  if (changes.estimateItemId !== undefined) patch.estimate_item_id = changes.estimateItemId || null;

  const { data, error } = await supabase
    .from("estimate_files")
    .update(patch)
    .eq("id", photoId)
    .eq("company_id", profile.company_id)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "That photo couldn't be updated." };

  revalidatePath("/estimates");
  return {};
}

/**
 * Takes the photo off the document. The file itself stays on the job --
 * removing it from a proposal is not a reason to lose the photograph.
 */
export async function detachEstimatePhoto(photoId: string): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("estimate_files")
    .select("estimate_id")
    .eq("id", photoId)
    .eq("company_id", profile.company_id)
    .maybeSingle<{ estimate_id: string }>();
  if (!row) return { error: "That photo couldn't be found." };

  const frozen = await assertUnsigned(supabase, row.estimate_id, profile.company_id);
  if (frozen.error) return frozen;

  const { data, error } = await supabase
    .from("estimate_files")
    .delete()
    .eq("id", photoId)
    .eq("company_id", profile.company_id)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "That photo couldn't be removed." };

  revalidatePath("/estimates");
  return {};
}
