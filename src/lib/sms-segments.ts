// What a text message actually costs to send.
//
// Twilio bills per segment, not per message. Which alphabet the body fits
// in decides how big a segment is: the GSM-7 basic alphabet gives 160
// characters (153 once a message splits across segments), anything else
// forces UCS-2 at 70 (67 when split). One stray em dash, curly quote or
// emoji therefore more than doubles the price of an otherwise short text.

const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡" +
  "ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";

// These live in the GSM-7 extension table: still sendable as GSM-7, but
// each one takes two septets rather than one.
const GSM_EXTENDED = "^{}\\[~]|€";

export type SmsCost = {
  encoding: "GSM-7" | "UCS-2";
  units: number;
  segments: number;
  /** Characters left before this message costs another segment. */
  remaining: number;
};

export function smsCost(body: string): SmsCost {
  let septets = 0;
  let isGsm = true;
  for (const ch of body) {
    if (GSM_BASIC.includes(ch)) septets += 1;
    else if (GSM_EXTENDED.includes(ch)) septets += 2;
    else {
      isGsm = false;
      break;
    }
  }

  if (isGsm) {
    const segments = septets <= 160 ? 1 : Math.ceil(septets / 153);
    const capacity = segments === 1 ? 160 : segments * 153;
    return { encoding: "GSM-7", units: septets, segments, remaining: capacity - septets };
  }

  // UCS-2 counts UTF-16 code units, so anything outside the basic plane
  // (most emoji) costs two on its own.
  const units = [...body].reduce(
    (n, ch) => n + ((ch.codePointAt(0) ?? 0) > 0xffff ? 2 : 1),
    0
  );
  const segments = units <= 70 ? 1 : Math.ceil(units / 67);
  const capacity = segments === 1 ? 70 : segments * 67;
  return { encoding: "UCS-2", units, segments, remaining: capacity - units };
}

/**
 * The characters that knocked a message out of GSM-7, de-duplicated and in
 * the order they appear -- so the fix is "replace this exact character",
 * not "hunt through your message".
 */
export function nonGsmCharacters(body: string): string[] {
  const found: string[] = [];
  for (const ch of body) {
    if (GSM_BASIC.includes(ch) || GSM_EXTENDED.includes(ch)) continue;
    if (!found.includes(ch)) found.push(ch);
  }
  return found;
}
