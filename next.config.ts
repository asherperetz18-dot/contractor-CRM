import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

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
  // Deliberately narrower than the usual "2 years + includeSubDomains +
  // preload" recipe. This app itself has never been served over plain
  // HTTP (Vercel), so the bare header is genuinely zero-risk -- but
  // includeSubDomains and preload are claims about infrastructure this
  // repo has no visibility into at all: there is no domain or subdomain
  // configuration committed anywhere (no vercel.json domains, no custom-
  // domain reference in any doc), so whether every subdomain under the
  // production apex is HTTPS-only can't be verified from here, and a
  // wrong "yes" is expensive to undo. includeSubDomains would apply this
  // policy to every subdomain, breaking any of them served over plain
  // HTTP or without a valid cert. preload is worse: once a domain is
  // accepted into Chromium's preload list, every major browser refuses
  // plain HTTP to it before ever making a request -- permanently, until
  // the site owner explicitly requests removal and every existing
  // browser install eventually updates, typically months. Six months
  // (15552000s) still gives a real HSTS guarantee -- once a browser has
  // seen this header, it upgrades every following visit to HTTPS for
  // that period even if a future request somehow arrived over HTTP.
  // Escalate deliberately, in order, once each step is actually true:
  // confirm every subdomain in active use is HTTPS-only -> add
  // includeSubDomains -> run it for a while -> only then consider
  // submitting to hstspreload.org.
  {
    key: "Strict-Transport-Security",
    value: "max-age=15552000",
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
  // Mirrors two of Vercel's own build-time vars into the client bundle --
  // the browser can't read VERCEL_GIT_COMMIT_SHA or VERCEL_ENV directly.
  // Every Sentry event (client or server) is tagged with the release, so
  // a spike right after a deploy is visible as "all on release X"; the
  // environment mirror keeps a client-side event on a Preview deploy
  // from being mistagged "production" (NODE_ENV reads "production" on
  // both). See src/lib/observability/context.ts.
  env: {
    NEXT_PUBLIC_APP_RELEASE: process.env.VERCEL_GIT_COMMIT_SHA,
    NEXT_PUBLIC_APP_ENV: process.env.VERCEL_ENV,
  },
  async headers() {
    return [{ source: "/(.*)", headers: SECURITY_HEADERS }];
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  widenClientFileUpload: true,
  // This repo builds with Turbopack, the default builder on this Next.js
  // version (see docs/DECISIONS.md #012-#013) -- Sentry's webpack-based
  // build-time instrumentation and sourcemap upload no-op under
  // Turbopack per @sentry/nextjs's own documented behavior. Error and
  // breadcrumb capture here is therefore deliberately manual
  // (src/lib/observability/, instrumentation.ts's onRequestError) rather
  // than relied on from this wrapper -- kept anyway since it's harmless
  // and would start working automatically if the build ever moves off
  // Turbopack.
});
