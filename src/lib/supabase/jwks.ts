import "server-only";
import type { createClient } from "@/lib/supabase/server";

/**
 * This project's public signing keys, fetched once per server instance
 * rather than once per request.
 *
 * Verifying the session locally still cost a network call, which rather
 * defeated the point. supabase-js caches the key set on the client
 * object, and this app builds a fresh client for every request -- so the
 * cache was always empty and getClaims fetched
 * /auth/v1/.well-known/jwks.json again every time, from the proxy and
 * again from the page render. The document is one elliptic-curve public
 * key that changes only when somebody rotates it, and Supabase serves it
 * uncached (cf-cache-status: DYNAMIC), so it was a real round trip to
 * the origin on every request in the application.
 *
 * Holding it at module scope means it survives for the life of the
 * server instance instead of the life of one request.
 *
 * Rotation still works without anyone thinking about it: getClaims looks
 * in the key set it is handed, and if the token's kid is not there it
 * falls through to fetching the current set itself. A stale cache costs
 * one request the old behaviour, not a failure.
 */

/**
 * Exactly what getClaims accepts, derived from its own signature rather
 * than restated here -- the JWK type lives in a transitive dependency,
 * and a hand-written copy of it would drift silently. `import type`, so
 * this stays a compile-time reference and adds no runtime import.
 */
type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;
type Jwks = NonNullable<
  NonNullable<Parameters<SupabaseServerClient["auth"]["getClaims"]>[1]>["jwks"]
>;

// Matches supabase-js's own TTL for the same document.
const TTL_MS = 10 * 60 * 1000;

let cached: Jwks | null = null;
let cachedAt = 0;
// Shared so a cold instance taking several requests at once fetches once
// rather than once per request.
let inFlight: Promise<Jwks | null> | null = null;

async function fetchJwks(): Promise<Jwks | null> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  try {
    const res = await fetch(`${base}/auth/v1/.well-known/jwks.json`);
    if (!res.ok) return null;
    const json = (await res.json()) as Jwks;
    return Array.isArray(json?.keys) ? json : null;
  } catch {
    // Returning null hands the job back to getClaims, which fetches the
    // set itself. Never let this be the reason a request fails.
    return null;
  }
}

export async function getSigningKeys(): Promise<Jwks | undefined> {
  const now = Date.now();
  if (cached && now - cachedAt < TTL_MS) return cached;
  if (!inFlight) {
    inFlight = fetchJwks().finally(() => {
      inFlight = null;
    });
  }
  const fresh = await inFlight;
  if (fresh) {
    cached = fresh;
    cachedAt = now;
    return fresh;
  }
  // Serve a stale set rather than none: getClaims will refetch anyway if
  // the key it needs is missing.
  return cached ?? undefined;
}
