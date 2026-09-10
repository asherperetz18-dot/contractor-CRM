import { createLeadFileUploadUrl, recordLeadFile } from "@/lib/actions/lead-files";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { downscaleImage } from "@/lib/images/downscale";

/**
 * One lead file, from the browser straight into storage.
 *
 * The same three steps every upload surface was writing by hand: shrink
 * a phone photo before it leaves the device, get a one-time signed URL
 * (a file posted through a server action dies at Vercel's ~4.5MB body
 * limit), push the bytes, then record the row. Runs in the browser.
 */
export async function uploadLeadFileDirect(
  leadId: string,
  original: File,
  opts?: {
    /** Ties the photo to a specific visit. */
    eventId?: string | null;
    /** Files it under one job (estimate/contract). */
    estimateId?: string | null;
  }
): Promise<{ error?: string; fileName?: string }> {
  const file = await downscaleImage(original);

  const signed = await createLeadFileUploadUrl(leadId, file.name, file.size);
  if (signed.error || !signed.path || !signed.token) {
    return { error: signed.error ?? "could not start that upload" };
  }

  const { error: uploadError } = await createBrowserClient()
    .storage.from("lead-files")
    .uploadToSignedUrl(signed.path, signed.token, file, {
      contentType: file.type || undefined,
    });
  if (uploadError) {
    // The storage project's own upload ceiling surfaces here, and it is
    // the one limit this app cannot raise for itself.
    return {
      error: /exceeded the maximum allowed size/i.test(uploadError.message)
        ? "larger than the storage limit on this project"
        : uploadError.message,
    };
  }

  const recorded = await recordLeadFile(
    leadId,
    signed.path,
    file.name,
    file.size,
    file.type || null,
    opts?.eventId ?? null,
    opts?.estimateId ?? null
  );
  if (recorded.error) return { error: recorded.error };
  return { fileName: file.name };
}
