/**
 * Which stored copy of a company's Facebook Page token and app secret to
 * use, and what a save writes (DECISIONS #114).
 *
 * They used to sit in plain text in company_profile, which every member
 * of the company can read. Now:
 *   - the encrypted copy (meta_*_enc) is the one used;
 *   - a plain copy left in company_profile from before is still used,
 *     and flagged so the reader encrypts it and clears the plain one;
 *   - a plain copy migration 0193 moved into meta_secrets_legacy (a table
 *     no CRM user can read) is found the same way, and healed the same way.
 *
 * Pure -- the decrypt/encrypt functions are handed in -- so it is tested
 * on its own (page-secrets.test.ts).
 */

export type MetaSecretColumns = {
  meta_page_access_token?: string | null;
  meta_app_secret?: string | null;
  meta_page_access_token_enc?: string | null;
  meta_app_secret_enc?: string | null;
};

export type LegacyMetaSecrets = { page_access_token: string | null; app_secret: string | null } | null;

export type MetaSecrets = {
  pageAccessToken: string | null;
  appSecret: string | null;
  /** A plain copy exists somewhere: encrypt what's used and clear the rest. */
  needsHealing: boolean;
};

export function pickMetaSecrets(
  row: MetaSecretColumns,
  legacy: LegacyMetaSecrets,
  decrypt: (v: string | null | undefined) => string | null
): MetaSecrets {
  const pageAccessToken =
    decrypt(row.meta_page_access_token_enc) ?? row.meta_page_access_token ?? legacy?.page_access_token ?? null;
  const appSecret = decrypt(row.meta_app_secret_enc) ?? row.meta_app_secret ?? legacy?.app_secret ?? null;
  const needsHealing = Boolean(
    row.meta_page_access_token || row.meta_app_secret || legacy?.page_access_token || legacy?.app_secret
  );
  return { pageAccessToken, appSecret, needsHealing };
}

/**
 * The company_profile columns a save writes: the encrypted copy, and the
 * plain copy always cleared. A key left undefined is not touched; null
 * forgets it.
 */
export function metaSecretWrite(
  keys: { pageAccessToken?: string | null; appSecret?: string | null },
  encrypt: (v: string) => string | null
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  if (keys.pageAccessToken !== undefined) {
    out.meta_page_access_token_enc = keys.pageAccessToken ? encrypt(keys.pageAccessToken) : null;
    out.meta_page_access_token = null;
  }
  if (keys.appSecret !== undefined) {
    out.meta_app_secret_enc = keys.appSecret ? encrypt(keys.appSecret) : null;
    out.meta_app_secret = null;
  }
  return out;
}
