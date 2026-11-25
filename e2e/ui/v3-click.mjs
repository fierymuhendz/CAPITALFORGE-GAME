/**
 * v3 tıklama turu (gerçek uçlar): pazar al+teslim, tesis iş başlat, sözleşme karşılaştır+kabul, taşıma panosu kabul.
 * Kullanım: node e2e/ui/v3-click.mjs <outDir> <phone|desktop> <tr|en>
 */
import { readFileSync, mkdirSync } from "node:fs";
import { ROOT, WEB, T, chromium, devices, loginCtx } from "./lib.mjs";
import { audit } from "./layout-audit.mjs";
const [outDir = "/tmp/cf/click", prof = "phone", L = "tr"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const accts = JSON.parse(readFileSync(`${ROOT}/e2e/ui/out/playtest-accounts.json`, "utf8"));
const ctxOpts = prof === "phone" ? { ...devices["iPhone 13"], deviceScaleFactor: 1 } : { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 };
const browser = await chromium.launch();
const log = [];
let cur = null;
let sub = "";
const S = (x) => { sub = x; };
const ok = (step, d = "") => { log.push(`OK   ${step} ${d}`); console.log(`OK   ${prof}-${L} ${step} ${d}`); };
const bad = (step, e) => { if (cur && !String(step).startsWith("layout")) cur.screenshot({ path: `${outDir}/${prof}-${L}-FAIL-${step.replace(/\W+/g, "_")}.png` }).catch(() => {}); log.push(`FAIL ${step} ${e}`); console.log(`FAIL ${prof}-${L} ${step} [${sub}] ${String(e).split("\n")[0].slice(0, 200)}`); };
async function session(key) {
  const ctx = await browser.newContext({ ...ctxOpts, locale: L === "tr" ? "tr-TR" : "en-US", timezoneId: "Europe/Istanbul" });
  await ctx.addInitScript((l) => { try { localStorage.setItem("cf-graphics", "low"); localStorage.setItem("cf-locale", l); } catch {} }, L);
  await loginCtx(ctx, accts[key].username);
  await ctx.request.patch(`${WEB}/api/account/prefs`, { headers: { "x-cf-intent": "1", "content-type": "application/json" }, data: { locale: L } });
  const page = await ctx.newPage(); page.setDefaultTimeout(15000); cur = page;
  return { ctx, page };
}
const shot = async (page, n) => { await page.screenshot({ path: `${outDir}/${prof}-${L}-${n}.png` }); const a = await audit(page); if (a.docOverflow > 0 || a.nIssues) bad(`layout ${n}`, JSON.stringify(a.issues.slice(0, 3)) + ` doc=${a.docOverflow}`); };
const btn = (page, key, params) => page.getByRole("button", { name: T(L, key, params) });

// 1) Pazar: tahıl al ve Körfezkent'e teslim ettir
try {
  const { page } = await session("ptfab");
  await page.goto(`${WEB}/play?tab=market`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: T(L, "offers.tabBuy"), exact: true }).click();
  S("chip"); await page.getByRole("button", { name: new RegExp(L === "tr" ? "Tahıl" : "Grain") }).first().click();
  const qty = page.getByRole("spinbutton").first().or(page.locator("input[inputmode]").first());
  S("qty"); await qty.fill("4");
  await page.waitForTimeout(1500);
  await shot(page, "1-market-offers");
  S("rowbuy"); await page.getByRole("button", { name: T(L, "market.buy"), exact: true }).first().click();
  await page.waitForTimeout(800);
  await shot(page, "2-market-confirm");
  const go = page.getByRole("button", { name: new RegExp(`^(${T(L, "offers.buyDeliver", { city: ".*" })}|${T(L, "offers.buyHere")})`) });
  S("confirm"); await go.first().click();
  await page.waitForTimeout(1500);
  await shot(page, "3-market-bought");
  ok("pazar al+teslim");
  await page.context().close();
} catch (e) { bad("pazar al+teslim", e); }

// 2) Tesis: iş başlat
try {
  const { page } = await session("ptnew");
  await page.goto(`${WEB}/play?tab=facilities`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: T(L, "facility.startJob") }).first().click();
  await page.waitForTimeout(1500);
  await shot(page, "4-facility-recipe");
  await page.getByRole("button", { name: T(L, "facility.start"), exact: true }).first().click();
  await page.waitForTimeout(1500);
  await shot(page, "5-facility-started");
  ok("tesis iş başlat");
  await page.context().close();
} catch (e) { bad("tesis iş başlat", e); }

// 3) Sözleşme: gelen teklifi karşılaştır ve kabul et
try {
  const { page } = await session("ptfab");
  await page.goto(`${WEB}/play?tab=contracts`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: T(L, "contracts.mine") }).click().catch(() => page.getByRole("button", { name: T(L, "contracts.mine") }).click());
  await page.waitForTimeout(800);
  S("open contract"); await page.getByText(L === "tr" ? "Çiğ süt" : "Raw milk").first().click();
  await page.waitForTimeout(1500);
  await shot(page, "6-contract-compare");
  S("accept"); await page.getByRole("button", { name: T(L, "contracts.accept"), exact: true }).first().click();
  await page.waitForTimeout(800);
  const confirm = page.getByRole("button", { name: T(L, "contracts.accept"), exact: true });
  if (await confirm.count() > 0 && await confirm.last().isVisible()) await confirm.last().click().catch(() => {});
  await page.waitForTimeout(1500);
  await shot(page, "7-contract-accepted");
  ok("sözleşme karşılaştır+kabul");
  await page.context().close();
} catch (e) { bad("sözleşme", e); }

// 4) Taşıma panosu
try {
  const { page } = await session("pthaul");
  await page.goto(`${WEB}/play?tab=logistics`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: T(L, "logistics.board") }).click().catch(() => page.getByRole("button", { name: T(L, "logistics.board") }).click());
  await page.waitForTimeout(1500);
  await shot(page, "8-freight-board");
  await page.getByRole("button", { name: T(L, "logistics.accept"), exact: true }).first().click();
  await page.waitForTimeout(800);
  await shot(page, "9-freight-accept");
  const c2 = page.getByRole("button", { name: T(L, "logistics.accept"), exact: true });
  if (await c2.count()) await c2.last().click().catch(() => {});
  await page.waitForTimeout(1500);
  ok("taşıma işi kabul");
  await page.context().close();
} catch (e) { bad("taşıma", e); }

// 5) Şehir: kendi binaya dokun
try {
  const { page } = await session("ptfarm");
  await page.goto(`${WEB}/play`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await shot(page, "10-city");
  const chip = page.locator("[data-facility-chip], .fac-chip, button:has-text('▶'), button:has-text('II')").first();
  if (await chip.count()) { await chip.click(); await page.waitForTimeout(1200); await shot(page, "11-city-building"); ok("şehir bina seçimi"); } else bad("şehir bina seçimi", "çip bulunamadı");
  await page.context().close();
} catch (e) { bad("şehir", e); }
await browser.close();
