import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Music Box — one record for this moment",
  description: "A tactile wall of songs that finds one record for right now.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
