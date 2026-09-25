/**
 * Whether a company's Stripe account can actually take a payment.
 *
 * "Saved" is not "connected": the Pay button needs the key decrypted,
 * and a key stored under a different APP_ENCRYPTION_KEY is saved but
 * unusable. Settings must say so rather than "Connected".
 */
export function stripeConnectionState(
  savedEnc: string | null | undefined,
  readable: boolean
): "connected" | "unreadable" | "none" {
  if (!savedEnc) return "none";
  return readable ? "connected" : "unreadable";
}
