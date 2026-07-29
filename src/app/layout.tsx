import type { Metadata } from "next";
import { Oswald, Inter, JetBrains_Mono } from "next/font/google";
import { createAdminClient } from "@/lib/supabase/admin";
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

export async function generateMetadata(): Promise<Metadata> {
  // Public route, no session -- there's exactly one company today, so
  // this is the one company_profile row. Once a second company exists
  // this needs a real per-tenant resolution (e.g. by hostname).
  const admin = createAdminClient();
  const { data } = await admin.from("company_profile").select("logo_url").single();
  const logoUrl = (data as { logo_url: string | null } | null)?.logo_url;

  return {
    title: "Contractor CRM",
    description: "Contractor CRM",
    icons: logoUrl ? { icon: logoUrl } : undefined,
  };
}

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
