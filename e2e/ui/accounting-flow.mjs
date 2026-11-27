/**
 * Yeni oyuncu: üretim → depo → satış → Şirket Muhasebesi (Playwright, düz node betiği).
 * Önkoşul: web E2E_WEB (varsayılan http://localhost:3100, /api sunucuya vekil), sunucu oyun testi kipinde
 * (pace.playtestSeconds ≤ 60) ve DISABLE_RATE_LIMIT=1.
 * Kullanım: node e2e/ui/accounting-flow.mjs [phone-tr desktop-tr phone-en desktop-en]
 * Sonuç: e2e/ui/out/accounting-<yapılandırma>.json, ekran görüntüleri docs/screenshots/e2e-acc-*.png
 */
import { Api, PROFILES, T, WEB, chromium, companyName, loginCtx, newPage, overflowX, register, saveJson, scanText, shot, sleep, ROOT, Monitor } from "./lib.mjs";

const args = process.argv.slice(2);
const CONFIGS = (args.length ? args : ["phone-tr", "desktop-tr", "phone-en", "desktop-en"]).map((c) => { const [p, l] = c.split("-"); return { id: c, profile: PROFILES[p], locale: l }; });
// yem bitkisinin aynı şehirde sistem alıcısı olan tarım şehirleri
const CITIES = ["yesilova", "kavsak", "akyayla"];

/** Sistem alıcılarının bütçesi tükenmesin diye her koşu başka şehirden başlar (E2E_HOME ile sabitlenebilir) */
async function foundCrop(api, n) {
  const order = process.env.E2E_HOME ? [process.env.E2E_HOME, ...CITIES] : [...CITIES.slice(n % CITIES.length), ...CITIES.slice(0, n % CITIES.length)];
  for (const cityId of order) {
    const onb = await api.get("/world/onboarding", { cityId, sector: "crop" });
    const plot = onb.plots.filter((p) => p.eligible).sort((a, b) => Number(a.price) - Number(b.price))[0];
    if (!plot) continue;
    await api.post("/company", { name: companyName("Hasat"), cityId, sector: "crop", plotId: plot.id });
    return cityId;
  }
  throw new Error("uygun arsa yok");
}

const browser = await chromium.launch();
let failed = 0;
for (const [cfgIndex, cfg] of CONFIGS.entries()) {
  const L = cfg.locale;
  const t = (k, p) => T(L, k, p);
  const phone = cfg.profile.name === "phone";
  const steps = [];
  const mon = new Monitor(cfg.id);
  const step = async (name, fn) => {
    const t0 = Date.now();
    try { const r = await fn(); steps.push({ name, ok: true, ms: Date.now() - t0, ...(r ?? {}) }); }
    catch (e) { steps.push({ name, ok: false, error: String(e.message ?? e).slice(0, 400) }); throw e; }
  };
  const { api, username } = await register(L, "acc");
  const city = await foundCrop(api, cfgIndex + Math.floor(Date.now() / 600_000));
  const { ctx, page } = await newPage(browser, cfg.profile, L, mon);
  await loginCtx(ctx, username);
  const tag = (n) => `acc-${cfg.id}-${n}`;
  const shots = [];
  const shotDlg = async (n) => { await sleep(450); return shot(page, tag(n)); }; // pencere açılış geçişi bitsin
  const tab = async (key) => {
    // telefonda alt gezinme / "Daha fazla", masaüstünde yan ray
    if (phone) {
      const direct = page.locator("nav.tabbar button", { hasText: t(key === "panels.facilities" ? "tabs.production" : key === "panels.inventory" ? "tabs.inventory" : "tabs.more") });
      await direct.first().click();
    } else await page.locator("nav.side-rail button", { hasText: t(key) }).first().click();
  };
  try {
    await step("home", async () => {
      await page.goto(`${WEB}/play`);
      await page.getByRole("heading", { level: 1 }).first().waitFor();
      shots.push(await shot(page, tag("01-home")));
    });
    await step("new company: accounting empty state", async () => {
      await page.getByRole("button", { name: t("accounting.open") }).first().click();
      await page.getByRole("heading", { name: t("accounting.title"), level: 1 }).waitFor();
      await page.getByText(t("accounting.emptyTitle")).first().waitFor();
      await page.getByText(t("accounting.cashNow")).first().waitFor();
      shots.push(await shot(page, tag("02-acc-empty")));
    });
    await step("start production", async () => {
      await page.goto(`${WEB}/play?tab=facilities`);
      const start = page.getByRole("button", { name: t("facility.start"), exact: true });
      await start.waitFor();
      await page.waitForFunction(() => { const b = [...document.querySelectorAll(".action-bar button")].pop(); return b && !b.disabled; }, null, { timeout: 15000 });
      shots.push(await shot(page, tag("03-facility")));
      await start.click();
      await page.getByText(t("facility.started")).first().waitFor();
    });
    await step("production completes (≤60 s) → open in storage", async () => {
      const btn = page.getByRole("button", { name: t("flow.openInStock") });
      await btn.waitFor({ timeout: 100_000 });
      shots.push(await shot(page, tag("04-done")));
      await btn.click();
      await page.getByRole("dialog").waitFor();
      const url = new URL(page.url());
      if (url.searchParams.get("tab") !== "inventory" || url.searchParams.get("product") !== "fodder") throw new Error(`url ${url.search}`);
      shots.push(await shotDlg("05-stock"));
    });
    let qty;
    await step("storage → market keeps product and quantity", async () => {
      await page.getByRole("dialog").getByRole("button", { name: t("inventory.sell") }).click();
      await page.waitForURL(/tab=market/);
      const url = new URL(page.url());
      qty = Number(url.searchParams.get("qty"));
      if (url.searchParams.get("product") !== "fodder" || url.searchParams.get("side") !== "sell" || !(qty > 0)) throw new Error(`url ${url.search}`);
      const fodderName = (await (await fetch(`${WEB}/api/world`)).json()).products.find((p) => p.id === "fodder").name[L];
      await page.waitForFunction((n) => [...document.querySelectorAll("input[role=combobox]")].some((i) => i.value === n), fodderName);
      // sayfa yenilemesi seçimi korur
      await page.reload();
      await page.waitForFunction((n) => [...document.querySelectorAll("input[role=combobox]")].some((i) => i.value === n), fodderName);
      await page.locator(".trade-quote").waitFor({ timeout: 20000 });
      shots.push(await shot(page, tag("06-market")));
      return { qty };
    });
    let saleId;
    await step("sell → sale accounting link", async () => {
      const sellNow = page.locator(".trade-quote-act button").first();
      const label = await sellNow.innerText();
      if (!label.includes(t("offers.sellNow", { q: "" }).trim().split(" ")[0])) {
        // en iyi alıcı uzak şehirdeyse aynı şehirdeki satış satırını kullan
        await page.getByRole("button", { name: t("market.sell"), exact: true }).first().click();
      } else await sellNow.click();
      const dlg = page.getByRole("dialog");
      await dlg.getByRole("button", { name: new RegExp(t("offers.sellNow", { q: "x" }).replace("x", ".*")) }).click();
      await page.getByRole("dialog").getByText(t("flow.soldTitle")).waitFor();
      shots.push(await shotDlg("07-sold"));
      await page.getByRole("button", { name: t("flow.openAccounting") }).click();
      await page.waitForURL(/tab=finance.*sale=/);
      saleId = new URL(page.url()).searchParams.get("sale");
      await page.getByRole("dialog").getByText(t("accounting.remaining")).waitFor();
      for (const k of ["accounting.collected", "accounting.cogs", "accounting.freight", "accounting.fees"]) await page.getByRole("dialog").getByText(t(k)).first().waitFor();
      shots.push(await shotDlg("08-sale-detail"));
      return { saleId };
    });
    await step("accounting page: periods, chart, history, reload, keyboard", async () => {
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "detached" });
      await page.goto(`${WEB}/play?tab=finance`);
      await page.getByRole("heading", { name: t("accounting.title"), level: 1 }).waitFor();
      const res = [];
      for (const p of ["today", "7d", "30d"]) {
        await page.getByRole("button", { name: t(`accounting.periods.${p}`), exact: true }).click();
        await page.waitForURL(new RegExp(`period=${p}`));
        await page.locator(".acc-chart svg").waitFor();
        const rev = await page.locator(".acc-figures > div").nth(1).innerText();
        const svgDays = await page.locator(".acc-chart svg g rect.acc-rev").count();
        res.push({ p, rev: rev.replace(/\s+/g, " "), svgDays });
        if (svgDays !== (p === "today" ? 1 : p === "7d" ? 7 : 30)) throw new Error(`grafik gün sayısı ${p}: ${svgDays}`);
      }
      shots.push(await shot(page, tag("09-acc-30d")));
      await page.reload();
      await page.getByRole("button", { name: t("accounting.periods.30d"), exact: true, pressed: true }).waitFor();
      // işlem geçmişindeki satış satırı satış ayrıntısını açar (klavyeyle)
      const saleBtn = page.locator(".acc-history").getByRole("button", { name: t("accounting.saleDetail") }).first();
      await saleBtn.focus();
      await page.keyboard.press("Enter");
      await page.getByRole("dialog").getByText(t("accounting.remaining")).waitFor();
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "detached" });
      const focused = await page.evaluate(() => document.activeElement?.textContent ?? "");
      const ox = await overflowX(page);
      if (ox > 1) throw new Error(`yatay taşma ${ox}px`);
      const scan = await scanText(page);
      if (scan.raw.length || scan.junk.length) throw new Error(`ham metin ${JSON.stringify(scan)}`);
      await page.evaluate(() => window.scrollTo(0, 0));
      shots.push(await shot(page, tag("10-acc-top")));
      await page.locator(".acc-history").scrollIntoViewIfNeeded();
      shots.push(await shot(page, tag("11-acc-history")));
      return { periods: res, focusAfterEscape: focused.slice(0, 40), overflowX: ox };
    });
    await step("legacy links: /play?tab=finance and ?tab=sales and loans", async () => {
      await page.goto(`${WEB}/play?tab=sales`);
      await page.getByRole("tab", { name: t("finance.sales"), selected: true }).waitFor();
      await page.getByRole("tab", { name: t("finance.loans") }).click();
      await page.getByRole("button", { name: t("finance.takeLoan") }).waitFor();
    });
    // sunucu rakamları: arayüzün gösterdiği satışla aynı
    const acc = await page.evaluate(async () => (await fetch("/api/finance/accounting?period=today")).json());
    const tr = await page.evaluate(async (id) => (await fetch(`/api/finance/sales/${id}`)).json(), saleId);
    steps.push({ name: "server figures", ok: true, summary: acc.summary, cashflow: acc.cashflow, cashNow: acc.cashNow, sale: tr.sale });
  } catch (e) {
    failed++;
    try { shots.push(await shot(page, tag("zz-fail"))); } catch { /* */ }
  }
  saveJson(`${ROOT}/e2e/ui/out/accounting-${cfg.id}.json`, { config: cfg.id, city, steps, shots, consoleErrors: mon.consoleErrors, pageErrors: mon.pageErrors, api4xx5xx: mon.api4xx5xx });
  console.log(`${cfg.id}: ${steps.map((s) => `${s.ok ? "✓" : "✗"} ${s.name}`).join(" | ")}`);
  await ctx.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
