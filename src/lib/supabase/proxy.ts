import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSigningKeys } from "@/lib/supabase/jwks";

// /portal is the customer-facing Client Portal. It runs on its own
// magic-link session (see lib/portal/session.ts), not Supabase Auth, so it
// must not be bounced to the staff login page.
// /get-started, /welcome and /register are the self-serve signup: whoever
// walks them has no account yet by definition, so bouncing them to the
// login page would close the only door in.
const PUBLIC_PATHS = [
  "/login",
  "/auth",
  "/portal",
  "/forgot-password",
  "/reset-password",
  "/get-started",
  "/welcome",
  "/register",
];

export async function updateSession(request: NextRequest) {
  // Rebuilt fresh each time (not snapshotted once) so it always reflects
  // request.cookies.set() calls made by the Supabase setAll callback below.
  function buildResponse() {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-pathname", request.nextUrl.pathname);
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  let response = buildResponse();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = buildResponse();
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getClaims rather than getUser. This runs on every request in the
  // app, and getUser spends a network call asking the Auth API to
  // validate a token we can verify ourselves: this project signs with
  // ES256, so the signature is checked here against a cached public key.
  //
  // Refreshing still happens. With no token passed, getClaims reads the
  // session first, which is what renews an expired one and writes the
  // new cookies through the setAll callback above -- the reason this
  // proxy exists at all.
  // The key set is handed in rather than fetched: supabase-js caches it
  // on the client, and a fresh client is built for every request, so it
  // was fetching the same document from Supabase on every one.
  const { data: claims } = await supabase.auth.getClaims(undefined, {
    jwks: await getSigningKeys(),
  });

  const isPublicPath = PUBLIC_PATHS.some((path) =>
    request.nextUrl.pathname.startsWith(path)
  );

  if (!claims && !isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return response;
}
