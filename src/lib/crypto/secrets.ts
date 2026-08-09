import "server-only";
import crypto from "crypto";

/**
 * Encryption for third-party credentials held on a company's behalf.
 *
 * Each contractor brings their own Stripe account, so this database holds
 * live secret keys belonging to other businesses. A database dump alone
 * must not yield a key that can move someone else's money, so the keys
 * are sealed under a platform key that exists only in the environment --
 * an attacker needs both.
 *
 * AES-256-GCM rather than CBC: it authenticates as well as encrypts, so
 * ciphertext tampered with in the database fails to decrypt instead of
 * silently producing a different key.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // 96 bits, the GCM standard
const KEY_BYTES = 32;

function platformKey(): Buffer | null {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) return null;
  let buf: Buffer;
  try {
    buf = Buffer.from(raw.trim(), "base64");
  } catch {
    return null;
  }
  // A short key would still "work" in the sense of not throwing, and
  // would weaken every secret stored under it.
  return buf.length === KEY_BYTES ? buf : null;
}

/** Whether secrets can be stored at all. False means refuse, never fall back to plaintext. */
export function encryptionAvailable(): boolean {
  return platformKey() !== null;
}

/**
 * Returns null when no usable key is configured, so callers must handle
 * the failure rather than receive something that looks encrypted.
 *
 * The "v1" prefix exists so the platform key can be rotated later
 * without guessing which scheme any given row was written with.
 */
export function encryptSecret(plaintext: string): string | null {
  const key = platformKey();
  if (!key || !plaintext) return null;

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}

export function decryptSecret(payload: string | null | undefined): string | null {
  const key = platformKey();
  if (!key || !payload) return null;

  const [version, ivPart, tagPart, ctPart] = payload.split(".");
  if (version !== "v1" || !ivPart || !tagPart || !ctPart) return null;

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivPart, "base64"));
    decipher.setAuthTag(Buffer.from(tagPart, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(ctPart, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Wrong key, or the row was tampered with. Either way this is not a
    // credential we can trust, so it does not exist.
    return null;
  }
}

/**
 * The tail of a key, for showing an admin which credential is installed
 * without ever handing the key back to a browser.
 */
export function secretTail(plaintext: string): string {
  return plaintext.slice(-4);
}
