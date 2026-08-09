import type { Metadata } from "next";
import { Oswald, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const oswald = Oswald({
  variable: "--font-oswald",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
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
