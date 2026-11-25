/**
 * Kuruluş sihirbazı görünürlük denetimi (şirket kurmaz, arsa tüketmez):
 * arsa seçildiğinde fiyat, konum ve kaynağa/müşteriye uzaklık ekranda (kaydırmadan) görünüyor mu?
 * Kullanım: node e2e/ui/wizard-visibility.mjs  -> e2e/ui/out/wizard-visibility.json
 */
import { PROFILES, Monitor, T, WEB, chromium, newPage, register, loginCtx, saveJson, shot, ROOT, sleep } from "./lib.mjs";

const world = await (await fetch(`${WEB}/api/world`)).json();
const CITY = process.env.E2E_WIZ_CITY ?? "yesilova";
const out = [];
const browser = await chromium.launch();
for (const [pn, profile] of Object.entries(PROFILES)) {
  for (const L of ["tr", "en"]) {
    const t = (k, p) => T(L, k, p);
    const mon = new Monitor(`${pn}-${L}`);
    const { page } = await newPage(browser, profile, L, mon, L === "tr" ? "en" : "tr");
    await page.goto(`${WEB}/register`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: L.toUpperCase(), exact: true }).click();
    const u = `e2ewiz${Date.now().toString(36).slice(-6)}`;
    await page.getByLabel(t("auth.username")).fill(u);
    await page.getByLabel(t("auth.password")).fill("E2ePassw0rd!xyz");
    await page.getByRole("button", { name: t("auth.register"), exact: true }).click();
    await page.waitForURL("**/found");
    await page.getByLabel(t("found.companyName")).fill("Gorunurluk Testi");
    const next = () => page.getByRole("button", { name: t("common.next"), exact: true }).click();
    await next();
    await page.locator("button.card", { hasText: world.cities.find((c) => c.id === CITY).name[L] }).first().click();
    await next();
    await page.locator("button.card", { hasText: t("sector.crop") }).first().click();
    await next();
    await page.locator(".plotgrid button.plot:not(.bad):not(.taken)").first().click();
    const detail = page.locator(".card", { has: page.getByText(t("found.distCenter")) }).last();
    await detail.waitFor();
    await sleep(300);
    const r = await detail.evaluate((el) => {
      const b = el.getBoundingClientRect();
      const bar = [...document.querySelectorAll("div")].find((d) => getComputedStyle(d).position === "sticky" && d.querySelector("button"));
      const barTop = bar ? bar.getBoundingClientRect().top : innerHeight;
      return { top: Math.round(b.top), bottom: Math.round(b.bottom), vh: innerHeight, visibleBeforeStickyBar: Math.max(0, Math.min(b.bottom, barTop) - Math.max(b.top, 0)), height: Math.round(b.height) };
    });
    const shotPath = await shot(page, `${pn}-${L}-wizard-detail-after-select`);
    const frac = r.height ? r.visibleBeforeStickyBar / r.height : 0;
    // liste görünümü: kartlarda kaynağa/müşteriye uzaklık var mı
    await page.getByRole("button", { name: t("found.viewList"), exact: true }).click();
    const listText = await page.locator(".cards .card").first().innerText();
    const listHasDist = listText.includes(t("found.nearSupply")) || listText.includes(t("found.nearBuyers"));
    out.push({ cfg: `${pn}-${L}`, detailVisibleFraction: Number(frac.toFixed(2)), detailRect: r, listCardShowsResourceCustomerDistance: listHasDist, listCardText: listText.replace(/\s+/g, " "), shot: shotPath });
    console.log(`${pn}-${L}: ayrıntı kartı kaydırmadan görünen oran ${frac.toFixed(2)}; liste kartında kaynak/müşteri uzaklığı: ${listHasDist}`);
    await page.context().close();
  }
}
await browser.close();
saveJson(`${ROOT}/e2e/ui/out/wizard-visibility.json`, out);
