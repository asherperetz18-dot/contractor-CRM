/**
 * Two-tier header strategy, split across two call sites:
 *
 * - The headers in `next.config.ts` (X-Frame-Options, HSTS, Referrer-
 *   Policy, Permissions-Policy, X-Content-Type-Options, and a narrow
 *   *enforcing* CSP) carry zero risk of breaking anything in this app --
 *   none of them restrict which scripts/styles/images/connections load,
 *   so they ship enforcing from day one.
 * - `reportOnlyCsp()` below is the strict, nonce-based policy that
 *   actually restricts script/style/image/connection sources. It ships
 *   as `Content-Security-Policy-Report-Only` (see src/lib/supabase/
 *   proxy.ts) rather than enforcing, because two things about it can't
 *   be verified from source alone in this environment: whether every
 *   real page load (in particular the Twilio Voice dialer's WebRTC
 *   signaling, and Next's own nonce-to-inline-script wiring on this
 *   specific Next version) actually matches the domains/mechanism
 *   below. Report-Only logs any mismatch to the browser console without
 *   blocking a single request, so the team can open the app -- run a
 *   test call on the dialer, open a screen share, import a CSV, look at
 *   a Drive-backed photo and a Street View address preview -- and watch
 *   for `[Report Only]` console entries before flipping this to a real
 *   `Content-Security-Policy` header (one line, see proxy.ts).
 */

function supabaseOrigins(): { https: string; wss: string } | null {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return null;
  try {
    const host = new URL(raw).host;
    return { https: `https://${host}`, wss: `wss://${host}` };
  } catch {
    return null;
  }
}

export function reportOnlyCsp(nonce: string): string {
  const supabase = supabaseOrigins();
  const isDev = process.env.NODE_ENV === "development";

  const directives = [
    `default-src 'self'`,
    // 'strict-dynamic' + a per-request nonce, matching Next's own
    // documented proxy-based CSP pattern (node_modules/next/dist/docs/
    // 01-app/02-guides/content-security-policy.md) -- Next auto-applies
    // this nonce to its own framework/page scripts once it sees this
    // header on the request, no manual wiring needed. 'unsafe-eval' is
    // dev-only (React's dev-mode error reconstruction; never shipped to
    // production, per the same doc).
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // The nonce covers <style> tags. It does not, and cannot, cover the
    // `style` HTML attribute -- that's `style-src-attr`, which has no
    // nonce mechanism at all, only 'unsafe-inline'. This app's
    // components set style={{...}} directly in 251 places across 83
    // files (measured, not estimated), so 'unsafe-inline' is a
    // deliberate, informed inclusion, not an oversight: a browser that
    // honors the nonce ignores 'unsafe-inline' for <style> *elements*
    // automatically (CSP Level 2+), so the tag-injection protection
    // stays real. The attribute form was never nonce-able in the first
    // place, on any CSP version, in any browser.
    `style-src 'self' 'nonce-${nonce}' 'unsafe-inline'`,
    `style-src-attr 'unsafe-inline'`,
    // blob: -- object-URL previews for picked-but-not-yet-uploaded files
    // (src/components/uploads/file-drop.tsx and friends). data: --
    // canvas-drawn signature images. drive.google.com -- Google-Drive-
    // backed lead photo thumbnails (leadPhotoThumbUrl). maps.googleapis
    // .com -- the Street View static image on a lead's address.
    `img-src 'self' blob: data:${supabase ? ` ${supabase.https}` : ""} https://drive.google.com https://maps.googleapis.com`,
    // Self-hosted (next/font/local) -- no Google Fonts dependency to
    // allow here at all.
    `font-src 'self'`,
    // Supabase: REST/Auth (https) + Realtime (wss -- the reply-inbox
    // messages panel and screen-share signaling both open a channel).
    // Twilio: the in-app Voice dialer's WebRTC signaling
    // (@twilio/voice-sdk). Twilio does not publish a specific CSP
    // domain list for the Voice SDK (checked; no such document exists),
    // so this scopes to the whole twilio.com domain rather than
    // guessing individual subdomains and silently breaking the dialer
    // on a wrong guess -- narrower than *, still real scoping. Revisit
    // narrower once Report-Only mode confirms exactly which hosts a
    // live call actually uses. See docs/DECISIONS.md #011 for the full
    // staged-rollout rationale and the checklist to clear before this
    // policy goes enforcing.
    `connect-src 'self'${supabase ? ` ${supabase.https} ${supabase.wss}` : ""} https://*.twilio.com wss://*.twilio.com`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    // upgrade-insecure-requests deliberately left out here: it has no
    // meaning in a Report-Only policy (there's no "violation" to
    // report -- a request either gets upgraded or it doesn't), and
    // Chromium logs a console error on every single page load saying
    // exactly that ("... is ignored when delivered in a report-only
    // policy") -- found via this repo's own e2e/public-smoke.spec.ts
    // console-error capture against real production. It stays in the
    // *enforcing* CSP (next.config.ts), where it actually takes effect.
  ];

  return directives.join("; ");
}
