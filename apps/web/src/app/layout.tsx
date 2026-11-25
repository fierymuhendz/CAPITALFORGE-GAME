import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/inter";
import "@fontsource-variable/space-grotesk";
import "../ui/ui.css";
import { AppProvider } from "@/lib/app";
import { ViewportVars } from "@/ui/Viewport";

export const metadata: Metadata = {
  title: "Capital Forge",
  description: "Capital Forge: build a company, trade, haul and out-think the market.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#0d1014", interactiveWidget: "resizes-content" };

const themeScript = `try{var t=localStorage.getItem("cf-theme");document.documentElement.dataset.theme=t==="light"?"light":"dark"}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr" data-theme="dark" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body><ViewportVars /><AppProvider>{children}</AppProvider></body>
    </html>
  );
}
