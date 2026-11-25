/**
 * Yerleşim denetimi: her panel için belge taşması, görünüm dışına taşan/kırpılan denetimler, ekran görüntüsü.
 * Kullanım: node e2e/ui/layout-audit.mjs <çıktı klasörü> [genişlikler virgüllü] [hesap anahtarı]
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { ROOT, WEB, chromium, loginCtx } from "./lib.mjs";

const outDir = process.argv[2] ?? "/tmp/cf/pt/before";
const widths = (process.argv[3] ?? "390,1440").split(",").map(Number);
const acctKey = process.argv[4] ?? "ptfab";
const locales = (process.env.LOCALES ?? "tr").split(",");
const accts = JSON.parse(readFileSync(`${ROOT}/e2e/ui/out/playtest-accounts.json`, "utf8"));
mkdirSync(outDir, { recursive: true });
const TABS = (process.env.TABS ?? "city,company,facilities,inventory,market,contracts,logistics,finance,research,notifications,account").split(",");
const H = { 320: 640, 390: 844, 640: 800, 768: 1024, 844: 390, 1366: 768, 1440: 900, 1920: 1080 };

export async function audit(page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    const vw = de.clientWidth;
    const docOverflow = de.scrollWidth - vw;
    const issues = [];
    const isVisible = (el) => { const s = getComputedStyle(el); return s.visibility !== "hidden" && s.display !== "none" && el.getClientRects().length > 0; };
    const clipAncestor = (el) => { let p = el.parentElement; while (p && p !== document.body) { const s = getComputedStyle(p); if (/(auto|scroll)/.test(s.overflowX)) return "scroll"; if (/(hidden|clip)/.test(s.overflowX)) return p; p = p.parentElement; } return null; };
    for (const el of document.querySelectorAll("button, a, input, select, textarea, [role=button], .num, b, h1, h2, h3, h4, td, th")) {
      if (!isVisible(el)) continue;
      if (el.closest(".skip")) continue;
      { const th = el.closest("thead"); if (th && th.getBoundingClientRect().width <= 2) continue; }
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      const anc = clipAncestor(el);
      if (anc === "scroll") continue; // kasıtlı kaydırma kabı
      if (r.right > vw + 1 || r.left < -1) { issues.push({ kind: "offscreen", tag: el.tagName, text: (el.innerText || el.getAttribute("aria-label") || "").slice(0, 40), left: Math.round(r.left), right: Math.round(r.right) }); continue; }
      if (anc && anc !== "scroll") { const ar = anc.getBoundingClientRect(); if (r.right > ar.right + 1 || r.left < ar.left - 1) issues.push({ kind: "clipped", tag: el.tagName, text: (el.innerText || "").slice(0, 40), by: anc.className.toString().slice(0, 40) }); }
      if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflowX !== "visible" && !/(auto|scroll)/.test(getComputedStyle(el).overflowX) && (el.tagName === "BUTTON" || el.tagName === "TD")) issues.push({ kind: "text-cut", tag: el.tagName, text: (el.innerText || "").slice(0, 40) });
    }
    // kasıtsız yatay kaydırma: panel/diyalog gövdesi taşıyor mu
    for (const el of document.querySelectorAll(".pane-body, .sheet-body")) if (isVisible(el) && el.scrollWidth > el.clientWidth + 1) issues.push({ kind: "body-hscroll", tag: el.tagName, text: el.className.toString().slice(0, 30) + " " + (el.scrollWidth - el.clientWidth) });
    return { vw, docOverflow, issues: issues.slice(0, 30), nIssues: issues.length };
  });
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
const browser = await chromium.launch();
const report = [];
for (const locale of locales) for (const w of widths) {
  const ctx = await browser.newContext({ viewport: { width: w, height: H[w] ?? 900 }, deviceScaleFactor: 1, locale: locale === "tr" ? "tr-TR" : "en-US", timezoneId: "Europe/Istanbul", hasTouch: w < 800, isMobile: w < 800 });
  await ctx.addInitScript((l) => { try { localStorage.setItem("cf-locale", l); localStorage.setItem("cf-graphics", "low"); } catch {} }, locale);
  await loginCtx(ctx, accts[acctKey].username);
  await ctx.request.patch(`${WEB}/api/account/prefs`, { headers: { "x-cf-intent": "1", "content-type": "application/json" }, data: { locale } });
  const page = await ctx.newPage();
  for (const tab of TABS) {
    const url = tab === "city" ? `${WEB}/play` : `${WEB}/play?tab=${tab}`;
    await page.goto(url, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(1200);
    const a = await audit(page);
    const file = `${outDir}/${acctKey}-${locale}-${w}-${tab}.png`;
    await page.screenshot({ path: file });
    report.push({ locale, w, tab, ...a });
    console.log(`${locale} ${w} ${tab}: docOverflow=${a.docOverflow} issues=${a.nIssues} ${a.issues.slice(0, 4).map((x) => `${x.kind}:${x.tag}:${x.text}`).join(" | ")}`);
  }
  await ctx.close();
}
await browser.close();
writeFileSync(`${outDir}/report-${acctKey}.json`, JSON.stringify(report, null, 1));
}
