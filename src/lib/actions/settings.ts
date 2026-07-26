"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type CompanyProfileInput = {
  name: string;
  address: string;
  email: string;
  phone: string;
  website: string;
  license_holder_name: string;
  license_number: string;
  license_state: string;
  license_type: string;
  timezone: string;
};

export async function saveCompanyProfile(input: CompanyProfileInput) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("company_profile")
    .update({
      name: input.name || null,
      address: input.address || null,
      email: input.email || null,
      phone: input.phone || null,
      website: input.website || null,
      license_holder_name: input.license_holder_name || null,
      license_number: input.license_number || null,
      license_state: input.license_state || null,
      license_type: input.license_type || null,
      timezone: input.timezone,
    })
    .eq("id", 1);

  if (error) return { error: error.message };
  revalidatePath("/settings/company-profile");
  return {};
}

const MAX_LOGO_BYTES = 1.5 * 1024 * 1024;
const ALLOWED_LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

export async function uploadLogo(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "No file provided." };
  if (!ALLOWED_LOGO_TYPES.includes(file.type)) {
    return { error: "Please choose an image file (PNG, JPEG, WebP, or SVG)." };
  }
  if (file.size > MAX_LOGO_BYTES) {
    return { error: "Image is too large — please use one under 1.5MB." };
  }

  const admin = createAdminClient();
  const ext = file.name.split(".").pop() || "png";
  const path = `company/logo-${Date.now()}.${ext}`;

  const { error: uploadError } = await admin.storage
    .from("logos")
    .upload(path, file, { contentType: file.type, upsert: true });
  if (uploadError) return { error: uploadError.message };

  const {
    data: { publicUrl },
  } = admin.storage.from("logos").getPublicUrl(path);

  const supabase = await createClient();
  const { error } = await supabase
    .from("company_profile")
    .update({ logo_url: publicUrl })
    .eq("id", 1);
  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  return { url: publicUrl };
}

export async function removeLogo() {
  const supabase = await createClient();
  const { error } = await supabase
    .from("company_profile")
    .update({ logo_url: null })
    .eq("id", 1);
  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  return {};
}
