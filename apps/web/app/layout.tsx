import type { ReactNode } from "react";
import "./globals.css";

export const metadata = { title: "CapitalForge", description: "Çok oyunculu ekonomi oyunu" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr">
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
