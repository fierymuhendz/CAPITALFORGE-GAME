/** Yönetici sayfaları yerleşim denetimi: node e2e/ui/admin-layout-audit.mjs <çıktı klasörü> [genişlikler] */
import { mkdirSync } from "node:fs";
import { WEB, chromium, Admin, PASSWORD } from "./lib.mjs";
const out = process.argv[2] ?? "docs/screenshots/v3";
const widths = (process.argv[3] ?? "320,390,1366").split(",").map(Number);
mkdirSync(out, { recursive: true });
const admin = await Admin.getOrCreate();
const browser = await chromium.launch();
for (const w of widths) {
  const ctx = await browser.newContext({ viewport: { width: w, height: w < 800 ? 800 : 900 }, locale: "en-US" });
  await ctx.addCookies([{ name: "cf_session", value: admin.api.cookie.replace("cf_session=", ""), url: WEB }]);
  const page = await ctx.newPage();
  await page.goto(`${WEB}/admin`, { waitUntil: "networkidle" });
  for (const tab of ["overview", "alerts", "search", "connections", "cases", "catalog", "audit", "time"]) {
    await page.getByRole("tab", { name: new RegExp(`^${tab}$`, "i") }).click().catch(() => {});
    await page.waitForTimeout(500);
    const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    console.log(w, tab, "docOverflow", o);
    if (tab === "overview" || tab === "catalog") await page.screenshot({ path: `${out}/admin-${w}-${tab}.png` });
  }
  await ctx.close();
}
await browser.close();
