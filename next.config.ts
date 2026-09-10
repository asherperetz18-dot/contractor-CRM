import type { NextConfig } from "next";

// Headers that are safe to enforce everywhere, immediately, with zero
// risk of breaking anything: none of them restrict which scripts,
// styles, images, or connections the app is allowed to load, so none of
// them depend on the domain/nonce audit that the *real* Content-
// Security-Policy needs first (see src/lib/security-headers.ts and
// src/lib/supabase/proxy.ts for that one -- it ships Report-Only until
// verified against a live dialer call and screen share).
const SECURITY_HEADERS = [
  // Belt-and-suspenders alongside the CSP's own `frame-ancestors 'none'`
  // -- older browsers that don't understand frame-ancestors still get
  // clickjacking protection from this. Safe: nothing in this app embeds
  // itself or expects to be embeddable (no iframe usage anywhere).
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Cross-origin navigations (e.g. clicking a customer's Street View
  // link, or Stripe Checkout's back button) still get the origin, just
  // not the full path/query -- same-origin navigations are unaffected.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // 2 years + preload, matching Vercel's all-HTTPS-already hosting --
  // this app has never been served over plain HTTP.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  // camera/microphone/display-capture stay on (self only): the in-app
  // Voice dialer needs microphone, screen-share needs all three. Every
  // other browser feature this app never touches is turned off.
  {
    key: "Permissions-Policy",
    value: [
      "camera=(self)",
      "microphone=(self)",
      "display-capture=(self)",
      "geolocation=()",
      "payment=()",
      "usb=()",
      "midi=()",
      "magnetometer=()",
      "gyroscope=()",
      "accelerometer=()",
      "interest-cohort=()",
    ].join(", "),
  },
  // Deliberately narrow: only directives that don't govern script/
  // style/image/connection sources, so this can enforce today without
  // the Twilio-domain and nonce-rollout risk the full policy carries.
  // object-src -- no Flash/plugin content anywhere. base-uri -- blocks
  // a <base> tag hijack from ever redirecting relative URLs. form-
  // action -- every form in this app posts to itself; Stripe Checkout
  // is reached by a server-issued redirect (stripe.checkout.sessions),
  // never a <form> submit, so this doesn't touch it.
  {
    key: "Content-Security-Policy",
    value: [
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "upgrade-insecure-requests",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  experimental: {
    // Next.js defaults Server Actions to a 1MB request body, which
    // silently rejects lead file uploads above ~1MB (below our own
    // 1500KB/20MB size checks in lead-files.ts). Raise the ceiling to
    // cover the largest case (20MB, once Google Drive is connected).
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
  async headers() {
    return [{ source: "/(.*)", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
