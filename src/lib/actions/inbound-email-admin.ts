"use server";

import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { isAdminRole } from "@/lib/data/types";

export type InboundEmailStatus = {
  /** The full forwarding address, or null until a token is generated. */
  address: string | null;
  /** Whether the platform's receiving domain is configured at all. */
  domainReady: boolean;
};

function inboundDomain(): string | null {
  const d = process.env.INBOUND_EMAIL_DOMAIN?.trim();
  return d || null;
}

export async function getInboundEmailStatus(): Promise<InboundEmailStatus | null> {
  const profile = await getCurrentProfile();
  if (!profile || !isAdminRole(profile)) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from("company_profile")
    .select("inbound_email_token")
    .eq("company_id", profile.company_id)
    .maybeSingle<{ inbound_email_token: string | null }>();

  const domain = inboundDomain();
  const token = data?.inbound_email_token ?? null;
  return {
    address: domain && token ? `leads-${token}@${domain}` : null,
    domainReady: !!domain,
  };
}

/**
 * Mints (or replaces) this company's forwarding address. Regenerating
 * kills the old address instantly -- the token is the only credential,
 * so a leaked address is fixed by one click.
 */
export async function regenerateInboundEmailToken(): Promise<{
  error?: string;
  address?: string;
}> {
  const profile = await getCurrentProfile();
  if (!profile || !isAdminRole(profile)) return { error: "Admins only." };
  const domain = inboundDomain();
  if (!domain) return { error: "The platform's receiving domain isn't configured yet." };

  const token = crypto.randomBytes(12).toString("hex");
  const admin = createAdminClient();
  const { error } = await admin
    .from("company_profile")
    .update({ inbound_email_token: token })
    .eq("company_id", profile.company_id);
  if (error) return { error: error.message };

  revalidatePath("/settings/inbound-email");
  return { address: `leads-${token}@${domain}` };
}
