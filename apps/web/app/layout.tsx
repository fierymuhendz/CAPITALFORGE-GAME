import type { ReactNode } from "react";

export const metadata = { title: "CapitalForge", description: "Çok oyunculu ekonomi oyunu" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: 24 }}>{children}</body>
    </html>
  );
}
