"use client";

import { useEffect } from "react";
import { captureError } from "@/lib/observability/sentry";

/**
 * The root-layout error boundary -- catches anything that escapes every
 * route segment's own error.tsx (there are none of those yet either).
 * Renders its own <html>/<body> with no access to the app's global
 * styles or theme, per Next's own docs, so this stays deliberately bare.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    captureError(error, { route: "global-error" });
  }, [error]);

  return (
    <html>
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "3rem 1.5rem", textAlign: "center" }}>
        <h2 style={{ marginBottom: "0.5rem" }}>Something went wrong.</h2>
        <p style={{ color: "#666", marginBottom: "1.5rem" }}>
          The error has been reported. Try again, or reload the page.
        </p>
        <button
          onClick={() => retry()}
          style={{
            padding: "0.5rem 1.25rem",
            borderRadius: "6px",
            border: "1px solid #ccc",
            background: "#fff",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
