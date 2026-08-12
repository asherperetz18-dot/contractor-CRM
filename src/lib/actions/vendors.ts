"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { selectAll } from "@/lib/data/select-all";
import type { Vendor } from "@/lib/data/types";

const COLUMNS =
  "id, company_id, name, trade, default_category, contact_name, phone, email, address, " +
  "license_number, insurance_expires_on, w9_on_file, w9_received_on, notes, qb_vendor_id, " +
  "is_active, created_at";

export async function getVendors(
  includeArchived = false
): Promise<{ error?: string; vendors?: Vendor[] }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  const rows = await selectAll<Vendor>((from, to) => {
    let q = supabase
      .from("vendors")
      .select(COLUMNS)
      .eq("company_id", profile.company_id)
      .order("name", { ascending: true });
    if (!includeArchived) q = q.eq("is_active", true);
    return q.range(from, to);
  });
  return { vendors: rows };
}

export type VendorFields = {
  name: string;
  trade?: string;
  defaultCategory?: string;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
  licenseNumber?: string;
  insuranceExpiresOn?: string;
  w9OnFile?: boolean;
  w9ReceivedOn?: string;
  notes?: string;
};

function toRow(fields: VendorFields) {
  return {
    name: fields.name.trim(),
    trade: fields.trade?.trim() || null,
    default_category: fields.defaultCategory?.trim() || null,
    contact_name: fields.contactName?.trim() || null,
    phone: fields.phone?.trim() || null,
    email: fields.email?.trim() || null,
    address: fields.address?.trim() || null,
    license_number: fields.licenseNumber?.trim() || null,
    insurance_expires_on: fields.insuranceExpiresOn || null,
    w9_on_file: !!fields.w9OnFile,
    w9_received_on: fields.w9ReceivedOn || null,
    notes: fields.notes?.trim() || null,
  };
}

/**
 * Creates a vendor, or reports the one that already has the name.
 *
 * The unique index is case-insensitive, so "home depot" collides with
 * "Home Depot" and Postgres raises 23505. Turning that into "already on
 * the list" rather than a constraint-violation string is the difference
 * between someone picking the existing vendor and someone typing
 * "Home Depot 2" to get past the error.
 */
export async function createVendor(
  fields: VendorFields
): Promise<{ error?: string; vendor?: Vendor; duplicateOf?: Vendor }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!fields.name?.trim()) return { error: "Enter a vendor name." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vendors")
    .insert({ ...toRow(fields), company_id: profile.company_id, created_by: profile.id })
    .select(COLUMNS)
    .returns<Vendor>()
    .single();

  if (error) {
    if (error.code === "23505") {
      const { data: existing } = await supabase
        .from("vendors")
        .select(COLUMNS)
        .eq("company_id", profile.company_id)
        .ilike("name", fields.name.trim())
        .returns<Vendor>()
        .maybeSingle();
      return {
        error: `${fields.name.trim()} is already on the vendor list.`,
        duplicateOf: existing ?? undefined,
      };
    }
    return { error: error.message };
  }

  revalidatePath("/estimates");
  revalidatePath("/settings/vendors");
  return { vendor: data as Vendor };
}

export async function updateVendor(
  vendorId: string,
  fields: VendorFields
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!fields.name?.trim()) return { error: "Enter a vendor name." };

  const supabase = await createClient();
  // Company-scoped and checked by row count: a server action is
  // reachable directly, so another company's vendor must not be one
  // guessed uuid from being rewritten.
  const { data, error } = await supabase
    .from("vendors")
    .update({ ...toRow(fields), updated_at: new Date().toISOString() })
    .eq("id", vendorId)
    .eq("company_id", profile.company_id)
    .select("id");
  if (error) {
    if (error.code === "23505") return { error: "Another vendor already has that name." };
    return { error: error.message };
  }
  if (!data?.length) return { error: "That vendor couldn't be updated." };

  revalidatePath("/estimates");
  revalidatePath("/settings/vendors");
  return {};
}

/**
 * Archives rather than deletes.
 *
 * A vendor with costs against it must not disappear from history because
 * nobody buys from them any more -- last year's job would silently lose
 * the name on its receipts.
 */
export async function setVendorActive(
  vendorId: string,
  isActive: boolean
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vendors")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("id", vendorId)
    .eq("company_id", profile.company_id)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "That vendor couldn't be updated." };

  revalidatePath("/estimates");
  revalidatePath("/settings/vendors");
  return {};
}
