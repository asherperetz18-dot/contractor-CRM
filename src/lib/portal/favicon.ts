import type { Metadata } from "next";

/**
 * The portal tab's icon: the contractor's own logo when one is on file.
 * With none, nothing is declared and the root layout's AI Build Pros mark
 * stands.
 */
export function portalFavicon(logoUrl: string | null | undefined): Metadata {
  const url = logoUrl?.trim();
  return url ? { icons: { icon: url } } : {};
}
