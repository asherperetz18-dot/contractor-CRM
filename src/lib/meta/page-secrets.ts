import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret, encryptionAvailable, encryptSecret } from "@/lib/crypto/secrets";
import { metaSecretWrite, pickMetaSecrets, type MetaSecretColumns, type MetaSecrets } from "./page-secrets-rules";

/**
 * The one place that reads and writes a company's Facebook Page token and
 * app secret (DECISIONS #114). Server-only, with the service role: the
 * values never reach a browser, and company members can't read them.
 */

type Admin = ReturnType<typeof createAdminClient>;
type MetaKeys = { pageAccessToken?: string | null; appSecret?: string | null };

const ENC_COLUMNS = "meta_page_access_token, meta_app_secret, meta_page_access_token_enc, meta_app_secret_enc";
const PLAIN_COLUMNS = "meta_page_access_token, meta_app_secret";

/** Migration 0193 hasn't run yet: the encrypted columns aren't there. */
function encColumnsMissing(message: string | undefined): boolean {
  return /meta_page_access_token_enc|meta_app_secret_enc/.test(message ?? "");
}

/** Every key given has an encrypted copy (encryptSecret answers null without APP_ENCRYPTION_KEY). */
function encryptedAll(keys: MetaKeys, write: Record<string, string | null>): boolean {
  if (keys.pageAccessToken && !write.meta_page_access_token_enc) return false;
  if (keys.appSecret && !write.meta_app_secret_enc) return false;
  return true;
}

/**
 * A key saved or forgotten replaces the copy 0193 moved aside, so an old
 * token never comes back from there. Best effort: before 0193 the table
 * doesn't exist, and that is fine.
 */
async function clearLegacy(admin: Admin, companyId: string, keys: MetaKeys) {
  const clear: Record<string, null> = {};
  if (keys.pageAccessToken !== undefined) clear.page_access_token = null;
  if (keys.appSecret !== undefined) clear.app_secret = null;
  if (Object.keys(clear).length) await admin.from("meta_secrets_legacy").update(clear).eq("company_id", companyId);
}

/**
 * The company's Page token and app secret, decrypted. A plain copy left
 * from before 0193 -- in company_profile, or moved by 0193 into the
 * locked meta_secrets_legacy table -- is used and then encrypted in place.
 * Works before 0193 has run too, so a lead is never dropped for it.
 */
export async function loadMetaSecrets(companyId: string, admin: Admin = createAdminClient()): Promise<MetaSecrets> {
  let row: MetaSecretColumns;
  const full = await admin.from("company_profile").select(ENC_COLUMNS).eq("company_id", companyId).maybeSingle();
  if (full.error) {
    const plain = await admin.from("company_profile").select(PLAIN_COLUMNS).eq("company_id", companyId).maybeSingle();
    row = (plain.data as MetaSecretColumns | null) ?? {};
  } else {
    row = (full.data as MetaSecretColumns | null) ?? {};
  }

  const legacyRes = await admin
    .from("meta_secrets_legacy")
    .select("page_access_token, app_secret")
    .eq("company_id", companyId)
    .maybeSingle();
  const legacy = legacyRes.error
    ? null
    : (legacyRes.data as { page_access_token: string | null; app_secret: string | null } | null);

  const secrets = pickMetaSecrets(row, legacy, decryptSecret);

  // Encrypt what is used and clear every plain copy -- only once 0193 has
  // run (the encrypted columns exist), and never at the cost of a key: if
  // either can't be encrypted, both stay as they are.
  if (secrets.needsHealing && !full.error) {
    const keys = { pageAccessToken: secrets.pageAccessToken, appSecret: secrets.appSecret };
    const write = metaSecretWrite(keys, encryptSecret);
    if (encryptedAll(keys, write)) {
      // Only if nothing was saved since the read, so a key saved meanwhile
      // is never overwritten by the old one.
      let heal = admin.from("company_profile").update(write).eq("company_id", companyId);
      for (const col of ["meta_page_access_token_enc", "meta_app_secret_enc"] as const) {
        const was = row[col];
        heal = was ? heal.eq(col, was) : heal.is(col, null);
      }
      const { data: healed, error } = await heal.select("company_id");
      if (!error && healed?.length && legacy) {
        await admin.from("meta_secrets_legacy").delete().eq("company_id", companyId);
      }
    }
  }
  return secrets;
}

/**
 * Saves the Page token and/or app secret, encrypted, along with any other
 * company_profile columns in `extra`, in one update. undefined leaves a
 * key as it is; null forgets it. Answers the database's own error message,
 * so a caller can still recognise a missing 0178 column.
 */
export async function saveMetaSecrets(
  companyId: string,
  keys: MetaKeys,
  extra: Record<string, unknown> = {},
  admin: Admin = createAdminClient()
): Promise<{ error?: string }> {
  if ((keys.pageAccessToken || keys.appSecret) && !encryptionAvailable()) {
    return {
      error:
        "Credential encryption isn't configured on the server (APP_ENCRYPTION_KEY), so Facebook keys can't be stored safely.",
    };
  }
  const write = metaSecretWrite(keys, encryptSecret);
  if (!encryptedAll(keys, write)) return { error: "Could not encrypt the Facebook key. Nothing was saved." };

  const patch: Record<string, unknown> = { ...extra, ...write };
  let res = await admin.from("company_profile").update(patch).eq("company_id", companyId).select("company_id");
  if (res.error && encColumnsMissing(res.error.message)) {
    // Deployed before 0193 was run: store it the way it always was. 0193
    // then moves it out of reach and the next read encrypts it.
    const plain: Record<string, unknown> = { ...extra };
    if (keys.pageAccessToken !== undefined) plain.meta_page_access_token = keys.pageAccessToken;
    if (keys.appSecret !== undefined) plain.meta_app_secret = keys.appSecret;
    res = await admin.from("company_profile").update(plain).eq("company_id", companyId).select("company_id");
  }
  if (res.error) return { error: res.error.message };
  if (!res.data?.length) return { error: "Could not save." };
  await clearLegacy(admin, companyId, keys);
  return {};
}
