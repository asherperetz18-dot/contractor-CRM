import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { loadCompanyWords } from "@/lib/load-company-words";
import { loadDocumentPdfBundle } from "./document-bundle";

/**
 * An invoice's PDF as an email attachment (DECISIONS #150): the same
 * document the Drive backup files and the customer's page prints. Null
 * when it can't be drawn -- the email still goes out, with its link.
 */
export async function invoicePdfAttachment(
  admin: ReturnType<typeof createAdminClient>,
  companyId: string,
  estimateId: string,
  docNumber: string
): Promise<{ filename: string; content: string } | null> {
  try {
    const words = await loadCompanyWords(admin, companyId);
    const loaded = await loadDocumentPdfBundle(admin, companyId, estimateId, words);
    if (!loaded) return null;
    const { renderDocumentPdf } = await import("./document-pdf");
    const bytes = await renderDocumentPdf(loaded.bundle);
    return { filename: `${docNumber.replace(/[\/:*?"<>|]/g, "-")}.pdf`, content: Buffer.from(bytes).toString("base64") };
  } catch {
    return null;
  }
}
