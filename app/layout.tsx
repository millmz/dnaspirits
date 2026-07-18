import type { Metadata } from "next";
import { Oswald, Libre_Caslon_Text } from "next/font/google";
import "./globals.css";

const oswald = Oswald({
  variable: "--font-oswald",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const caslon = Libre_Caslon_Text({
  variable: "--font-caslon",
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "De Nada Tequila — Operations",
  description:
    "Supply chain, market intelligence, marketing, and finance for Tequila De Nada",
  // installable as a home-screen app on phones ("Add to Home Screen")
  manifest: "/manifest.json",
  icons: { icon: "/icon-192.png", apple: "/icon-180.png" },
  appleWebApp: { capable: true, title: "De Nada", statusBarStyle: "default" },
};

export const viewport = {
  themeColor: "#231F20",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${oswald.variable} ${caslon.variable}`}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
