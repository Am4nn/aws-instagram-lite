import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import { themeScript } from "../lib/theme";
import { ClockProvider } from "../components/ui/Time";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata = { title: "Instagram-lite" };
// Every page is personal (rendered per request from the login cookie): nothing is pre-rendered at build time.
export const dynamic = "force-dynamic";
export const viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // data-theme is set by the inline script before React hydrates, hence suppressHydrationWarning.
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body><ClockProvider now={Date.now()}>{children}</ClockProvider></body>
    </html>
  );
}
