import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

/**
 * The fonts are in the repo, not fetched from Google at build time.
 *
 * next/font/google downloads the woff2 files during the build, which
 * makes every deploy depend on fonts.gstatic.com answering. It does not
 * always: two production deploys failed inside 20 seconds on 404s for
 * Inter, and one of them was a commit that changed nothing but a .sql
 * file. A build that cannot fail on its own code should not fail on
 * somebody else's CDN.
 *
 * These are the same files Google serves, and they are variable fonts --
 * one file per family covers every weight, which is why a range is
 * declared rather than three copies of the same 48KB. Both licences
 * (SIL OFL) permit self-hosting.
 */
const oswald = localFont({
  src: "./fonts/oswald.woff2",
  variable: "--font-oswald",
  weight: "500 700",
  display: "swap",
});

const inter = localFont({
  src: "./fonts/inter.woff2",
  variable: "--font-inter",
  weight: "400 600",
  display: "swap",
});

const jetbrainsMono = localFont({
  src: "./fonts/jetbrains-mono.woff2",
  variable: "--font-jetbrains-mono",
  weight: "400 500",
  display: "swap",
});

// Kept static (no per-request DB/cookie lookup here) so public routes
// like /login stay prerenderable. The per-company favicon (company
// logo) is resolved in the authenticated (app) layout instead, which
// already knows the signed-in user's current company and is dynamic
// anyway.
export const metadata: Metadata = {
  title: "Contractor CRM",
  description: "Contractor CRM",
  // The product's own mark, for every page reached without signing in --
  // login, the customer portal, and whatever a search engine crawls.
  // Without it those pages declared no icon at all, so Google fell back
  // to the only logo it had ever seen from this app: one customer's
  // company logo, which then represented the whole product in search
  // results.
  //
  // Deliberately config-based rather than a src/app/icon.svg file:
  // file-based icons outrank metadata and would permanently override the
  // per-company favicon the (app) layout sets for signed-in users. Here
  // the child layout's icons still win, and this only fills the gap.
  icons: { icon: "/aibuildpros-icon.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${oswald.variable} ${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
