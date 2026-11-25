/**
 * v3 karar ekranları: sunucu uçları yerelde yoksa (eski sürüm) /market/offers ve /finance/outcomes yanıtları
 * taklit edilerek yerleşim ve metinler görsel olarak denetlenir.
 * Kullanım: node e2e/ui/v3-mock-shots.mjs <çıktı klasörü> [hesap anahtarı] ; LOCALES=tr,en ; WIDTHS=390,1366
 */
import { readFileSync, mkdirSync } from "node:fs";
import { ROOT, WEB, chromium, loginCtx } from "./lib.mjs";

const out = process.argv[2] ?? "docs/screenshots/v3";
const acct = process.argv[3] ?? "ptfab";
const locales = (process.env.LOCALES ?? "en").split(",");
const widths = (process.env.WIDTHS ?? "390,1366").split(",").map(Number);
const accts = JSON.parse(readFileSync(`${ROOT}/e2e/ui/out/playtest-accounts.json`, "utf8"));
mkdirSync(out, { recursive: true });
const row = (n, o) => ({ orderId: `o${n}`, companyName: "Anadolu Gıda Ticaret Anonim Şirketi", isSystem: n === 1, cityId: ["korfezkent", "yesilova", "akyayla"][n % 3], km: n % 3 ? 120 * n : 0, quality: 2, availableKg: 12000, fillKg: n === 2 ? 1000 : 4000, pricePerKg: "4500", goods: "18000000", freight: n % 3 ? "2400000" : "0", loads: n === 2 ? 2 : 1, truckCapacityKg: 5000, fee: "180000", total: "20400000", perKg: "5100", profit: "1250000", etaMinutes: n % 3 ? 95 * n : 0, arrivesAt: new Date(Date.now() + 3600e3).toISOString(), notes: n === 2 ? ["PARTIAL", "SPLIT_LOADS"] : n % 3 ? [] : ["SAME_CITY"], ...o });
const offers = (side) => ({ side, productId: "flour", cityId: "korfezkent", qtyKg: 4000, fromCityId: "korfezkent", stockKg: 4000, avgCostPerKg: "3900", rows: [1, 2, 3, 4].map((n) => row(n)), bestOrderId: "o1", fastestOrderId: "o3" });
const fig = (x) => ({ qtyKg: 4000, revenue: "20000000", goods: null, freight: "300000", fees: "200000", cost: "15000000", profit: "4500000", minutes: 120, at: null, ...x });
const outcomes = [
  { id: "x1", kind: "production", refType: "job", refId: "j", productId: "flour", recipeId: "mill_flour", cityId: "korfezkent", destCityId: null, createdAt: new Date().toISOString(), status: "settled", expected: fig({}), actual: fig({ profit: "3900000", revenue: "19000000" }), saleIds: [], ledgerTransactionIds: ["t1"] },
  { id: "x2", kind: "purchase", refType: "trade", refId: "t", productId: "grain", recipeId: null, cityId: "yesilova", destCityId: "korfezkent", createdAt: new Date().toISOString(), status: "pending", expected: fig({ revenue: null, profit: null }), actual: null, saleIds: [], ledgerTransactionIds: [] },
];

const browser = await chromium.launch();
for (const locale of locales) for (const w of widths) {
  const ctx = await browser.newContext({ viewport: { width: w, height: w < 800 ? 844 : 900 }, locale: locale === "tr" ? "tr-TR" : "en-US", hasTouch: w < 800, isMobile: w < 800 });
  await ctx.addInitScript((l) => { try { localStorage.setItem("cf-locale", l); localStorage.setItem("cf-graphics", "low"); } catch {} }, locale);
  await loginCtx(ctx, accts[acct].username);
  await ctx.route("**/api/market/offers**", (r) => r.fulfill({ json: offers(new URL(r.request().url()).searchParams.get("side")) }));
  await ctx.route("**/api/finance/outcomes**", (r) => r.fulfill({ json: outcomes }));
  const page = await ctx.newPage();
  const shots = [["market", "market"], ["finance", "finance"], ["facilities", "facilities"]];
  for (const [tab, name] of shots) {
    await page.goto(`${WEB}/play?tab=${tab}`, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(1000);
    if (tab === "market") {
      await page.locator("table.tbl tbody tr, .tbl tr").first().waitFor({ timeout: 4000 }).catch(() => {});
      await page.screenshot({ path: `${out}/mock-${locale}-${w}-market-buy.png` });
      await page.getByRole("button", { name: /^(Buy|Al)$/ }).first().click().catch(() => {});
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${out}/mock-${locale}-${w}-market-buysheet.png` });
      await page.keyboard.press("Escape");
      await page.getByRole("tab", { name: /^(Sell|Sat)$/ }).click().catch(() => {});
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${out}/mock-${locale}-${w}-market-sell.png` });
    } else if (tab === "finance") {
      await page.getByRole("tab", { name: /^(Results|Sonuçlar)$/ }).click().catch(() => {});
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${out}/mock-${locale}-${w}-finance-results.png` });
    } else {
      await page.getByRole("button", { name: /^(Start job|İş başlat)$/ }).first().click().catch(() => {});
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${out}/mock-${locale}-${w}-facility.png` });
    }
    const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    console.log(locale, w, tab, "docOverflow", o);
  }
  await ctx.close();
}
await browser.close();
