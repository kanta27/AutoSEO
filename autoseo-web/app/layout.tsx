import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AutoSEO — Autonomous SEO + GEO",
  description:
    "An autonomous SEO & GEO agent that researches, writes, publishes, and keeps optimizing — 24/7, across Google and every AI answer engine.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
