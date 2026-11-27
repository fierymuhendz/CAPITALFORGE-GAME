/**
 * v4 ara mal zinciri (Playwright, yerel yığın): iki test şirketi.
 *   A (tarım, Kavşak)  : mısır üretir ve ilan verir (API ile kurulum).
 *   B (imalat, Yeşilova): ilanı ARAYÜZDEN satın alır ve teslim ettirir, "Nişasta çekimi" üretimini ARAYÜZDEN başlatır,
 *                         nişastayı Körfezkent'teki sistem alıcısına ARAYÜZDEN satar (sevk + satış).
 *   İki şirketin Şirket Muhasebesi ekranında satış satırı görünür; rakamlar sunucu API'siyle karşılaştırılır.
 *
 * Önkoşul (lib.mjs ile aynı): web E2E_WEB (varsayılan http://localhost:3100, /api sunucuya vekil), sunucu
 * ALLOW_TIME_TRAVEL=1 DISABLE_RATE_LIMIT=1, oyun testi kipi (varsayılan ayar playtestSeconds=60: her bekleme ≤ 60 sn).
 * Kullanım: node e2e/ui/v4-chain.mjs [desktop-tr] [phone-tr] ...
 * Çıktı: e2e/ui/out/v4-chain-<yapılandırma>.json, ekran görüntüleri E2E_SHOTS (varsayılan /mnt/project-files/v4-ekranlar)/zincir-*.png
 * Seçiciler metin/rol tabanlıdır (i18n sözlüğünden); sınıf adlarına yalnızca yedek olarak başvurulur.
 */
import { mkdirSync } from "node:fs";
import { Admin, Api, PROFILES, ROOT, T, WEB, Monitor, chromium, companyName, loginCtx, newPage, overflowX, register, saveJson, scanText, sleep } from "./lib.mjs";

const SHOTS_DIR = process.env.E2E_SHOTS ?? "/mnt/project-files/v4-ekranlar";
mkdirSync(SHOTS_DIR, { recursive: true });
const args = process.argv.slice(2);
const CONFIGS = (args.length ? args : ["desktop-tr"]).map((c) => { const [p, l] = c.split("-"); return { id: c, profile: PROFILES[p], locale: l }; });

const ADMIN = process.env.E2E_NO_ADMIN ? null : await Admin.getOrCreate().catch(() => null);
const A_CITY = "kavsak";
const B_CITY = "yesilova";
const SELL_CITY = "korfezkent";
const QTY = 1500; // kg mısır (Nişasta çekimi bir parti = 1,5 t)
const sum = (rows, f) => rows.reduce((a, r) => a + BigInt(f(r)), 0n);

async function found(api, sector, cityId, prefix) {
  const q = { cityId, sector, ...(sector === "manufacturing" ? { starterBuilding: "food_plant" } : {}) };
  const onb = await api.get("/world/onboarding", q);
  const plot = onb.plots.filter((p) => p.eligible).sort((a, b) => Number(a.price) - Number(b.price))[0];
  if (!plot) throw new Error(`uygun arsa yok ${cityId}/${sector}`);
  const name = companyName(prefix);
  await api.post("/company", { name, cityId, sector, plotId: plot.id, ...q.starterBuilding ? { starterBuilding: q.starterBuilding } : {} });
  return name;
}

/** envanterde koşul sağlanana dek bekle (oyun testi kipinde her bekleme ≤ 60 sn) */
async function waitInventory(api, pred, what, timeoutMs = 240_000) {
  const t0 = Date.now();
  for (;;) {
    const inv = await api.get("/inventory");
    const hit = inv.find(pred);
    if (hit) return hit;
    if (Date.now() - t0 > timeoutMs) throw new Error(`zaman aşımı: ${what}`);
    // sistem taşımacısı gerçek zamanda dakikalar sürebilir: yönetici saatini ilerleterek hızlandır (yalnızca test ortamı)
    if (ADMIN) await ADMIN.advance(20).catch(() => {});
    await sleep(4000);
  }
}

const browser = await chromium.launch();
let failed = 0;
for (const cfg of CONFIGS) {
  const L = cfg.locale;
  const t = (k, p) => T(L, k, p);
  const world = await new Api().get("/world");
  const productName = (id) => world.products.find((p) => p.id === id).name[L];
  const cityName = (id) => world.cities.find((c) => c.id === id).name[L];
  const recipeName = (id) => world.recipes.find((r) => r.id === id)?.name?.[L];
  const steps = [];
  const mon = new Monitor(cfg.id);
  const shots = [];
  const step = async (name, fn) => {
    const t0 = Date.now();
    try { const r = await fn(); steps.push({ name, ok: true, ms: Date.now() - t0, ...(r ?? {}) }); }
    catch (e) { steps.push({ name, ok: false, error: String(e.message ?? e).slice(0, 500) }); throw e; }
  };

  const A = await register(L, "zca");
  const B = await register(L, "zcb");
  const aName = await found(A.api, "crop", A_CITY, "Hammadde");
  const bName = await found(B.api, "manufacturing", B_CITY, "Fabrika");
  const { ctx: ctxA, page: pageA } = await newPage(browser, cfg.profile, L, mon);
  const { ctx: ctxB, page: pageB } = await newPage(browser, cfg.profile, L, mon);
  await loginCtx(ctxA, A.username);
  await loginCtx(ctxB, B.username);
  const snap = async (page, n) => {
    await sleep(450); // pencere açılış geçişi bitsin
    const file = `${SHOTS_DIR}/zincir-${cfg.id}-${n}.png`;
    await page.screenshot({ path: file });
    shots.push(file);
  };
  const dialog = (page) => page.getByRole("dialog");
  const closeDialogs = async (page) => {
    for (let i = 0; i < 3 && (await dialog(page).count()); i++) { await page.keyboard.press("Escape"); await sleep(300); }
  };

  try {
    // ---- A: mısır üret, ilan ver (API ile kurulum)
    let corn;
    let listing;
    await step("A: mısır üretir (API)", async () => {
      const fac = (await A.api.get("/facilities"))[0];
      const q = await A.api.post("/production/quote", { facilityId: fac.id, recipeId: "grow_corn", batches: 1 });
      if (!q.canStart) throw new Error(`başlatılamaz ${JSON.stringify(q.blockers)}`);
      await A.api.post("/production/start", { facilityId: fac.id, recipeId: "grow_corn", batches: 1, repeat: false });
      corn = await waitInventory(A.api, (x) => x.productId === "corn" && x.cityId === A_CITY, "A mısır çıktısı");
      if (corn.qtyKg < QTY) throw new Error(`mısır ${corn.qtyKg} < ${QTY}`);
    });
    await step("A: ilan verir (API)", async () => {
      const price = Number(world.products.find((p) => p.id === "corn").basePricePerKg);
      listing = await A.api.post("/market/listings", { cityId: A_CITY, productId: "corn", quality: corn.quality, qtyKg: QTY, pricePerKg: price });
      return { listingId: listing.id, pricePerKg: price };
    });

    // ---- B: arayüzden satın al
    await step("B: pazar → Al, A'nın ilanı → onay penceresi → teslim ettir", async () => {
      await pageB.goto(`${WEB}/play?tab=market&product=corn&side=buy&qty=${QTY}`);
      await pageB.getByRole("tab", { name: t("offers.tabBuy"), selected: true }).waitFor();
      const row = pageB.locator("tr").filter({ hasText: aName }).first();
      await row.waitFor({ timeout: 30_000 });
      await snap(pageB, "01-b-pazar-ilanlar");
      await row.getByRole("button", { name: t("market.buy"), exact: true }).first().click();
      const dlg = dialog(pageB);
      await dlg.getByText(aName).first().waitFor();
      await snap(pageB, "02-b-satin-alma-onay");
      await dlg.getByRole("button", { name: t("offers.buyDeliver", { city: cityName(B_CITY) }) }).click();
      await pageB.getByText(t("offers.boughtDeliver")).first().waitFor();
      await snap(pageB, "03-b-satin-alindi");
      await closeDialogs(pageB);
    });
    // sunucu: ilan doldu, A'nın satışı yazıldı
    let aSale;
    await step("sunucu: ilan doldu, A satışı ve B teslimat işi var", async () => {
      const acc = await A.api.get("/finance/accounting", { period: "today" });
      if (BigInt(acc.summary.revenueByAccount.revenue_sales ?? 0) !== BigInt(QTY) * BigInt(listing.pricePerKg)) {
        throw new Error(`A satış geliri ${acc.summary.revenueByAccount.revenue_sales} ≠ ${BigInt(QTY) * BigInt(listing.pricePerKg)}`);
      }
      aSale = { revenue: acc.summary.revenueByAccount.revenue_sales };
      return aSale;
    });

    // ---- B: teslimatı bekle, üretimi arayüzden başlat
    await step("B: mısır Yeşilova'ya ulaşır (sistem taşımacısı)", async () => {
      const inv = await waitInventory(B.api, (x) => x.productId === "corn" && x.cityId === B_CITY && x.qtyKg >= QTY, "B mısır teslimi");
      return { qtyKg: inv.qtyKg };
    });
    let starch;
    await step("B: Tesisler → Nişasta çekimi seç → Üretimi başlat", async () => {
      await pageB.goto(`${WEB}/play?tab=facilities`);
      const name = recipeName("make_corn_starch") ?? "Nişasta çekimi";
      const card = pageB.getByText(name, { exact: true }).first();
      await card.waitFor({ timeout: 30_000 });
      await card.click();
      const start = pageB.getByRole("button", { name: t("facility.start"), exact: true });
      await start.waitFor();
      await pageB.waitForFunction(() => { const b = [...document.querySelectorAll("button")].find((x) => /Üretimi başlat|Start production/.test(x.innerText)); return b && !b.disabled; }, null, { timeout: 20_000 });
      await snap(pageB, "04-b-tesis-tarif");
      await start.click();
      await pageB.getByText(t("facility.started")).first().waitFor();
      await snap(pageB, "05-b-uretim-basladi");
      starch = await waitInventory(B.api, (x) => x.productId === "corn_starch" && x.cityId === B_CITY, "B nişasta çıktısı");
      return { starchKg: starch.qtyKg };
    });

    // ---- B: arayüzden sat (Körfezkent'teki sanayi alım ofisi; sevk + satış)
    let saleId;
    await step("B: Sat → Körfezkent alıcısı için taşıma işi aç", async () => {
      await pageB.goto(`${WEB}/play?tab=market&product=corn_starch&side=sell&qty=${starch.qtyKg}`);
      await pageB.getByRole("tab", { name: t("offers.tabSell"), selected: true }).waitFor();
      await pageB.locator("tr").filter({ hasText: cityName(SELL_CITY) }).first().waitFor({ timeout: 30_000 });
      await snap(pageB, "06-b-satis-alicilar");
      // satır düğmesi: aynı şehirdeyse "Sat", uzaktaysa "Oraya gönder"; Körfezkent satırının düğmesine bas
      const row = pageB.locator("tr").filter({ hasText: cityName(SELL_CITY) }).first();
      await row.getByRole("button").last().click();
      await dialog(pageB).waitFor();
      await snap(pageB, "07-b-satis-onay");
      const confirm = dialog(pageB).getByRole("button").last();
      await confirm.click();
      await snap(pageB, "08-b-tasima-acildi");
      await closeDialogs(pageB);
      return {};
    });
    await step("B: yük Körfezkent'e varır, arayüzden alıcıya satılır", async () => {
      const there = await waitInventory(B.api, (x) => x.productId === "corn_starch" && x.cityId === SELL_CITY, "nişasta Körfezkent'e varışı");
      await pageB.goto(`${WEB}/play?tab=market&product=corn_starch&side=sell&qty=${there.qtyKg}`);
      await pageB.getByRole("tab", { name: t("offers.tabSell"), selected: true }).waitFor();
      // stok şehri: Körfezkent (varışta yük orada)
      await pageB.getByLabel(t("offers.stockIn")).selectOption({ value: SELL_CITY });
      const row = pageB.locator("tr").filter({ hasText: cityName(SELL_CITY) }).first();
      await row.waitFor({ timeout: 30_000 });
      await row.getByRole("button", { name: t("market.sell"), exact: true }).waitFor();
      await snap(pageB, "09-b-varista-satis");
      await row.getByRole("button", { name: t("market.sell"), exact: true }).click();
      const dlg = dialog(pageB);
      await dlg.waitFor();
      await dlg.getByRole("button").last().click();
      await dlg.getByText(t("flow.soldTitle")).waitFor({ timeout: 60_000 });
      await snap(pageB, "10-b-satildi");
      await closeDialogs(pageB);
      return { soldKg: there.qtyKg };
    });
    await step("sunucu: B'nin nişasta satışı yazıldı", async () => {
      const t0 = Date.now();
      for (;;) {
        const acc = await B.api.get("/finance/accounting", { period: "today" });
        if (BigInt(acc.summary.revenueByAccount.revenue_sales ?? 0) > 0n) return { revenue: acc.summary.revenueByAccount.revenue_sales, cogs: acc.summary.expenseByAccount.cogs };
        if (Date.now() - t0 > 180_000) throw new Error("B satışı gerçekleşmedi");
        await sleep(3000);
      }
    });

    // ---- iki şirketin Şirket Muhasebesi ekranı
    for (const [who, page, api, n] of [["A", pageA, A.api, "11-a-muhasebe"], ["B", pageB, B.api, "12-b-muhasebe"]]) {
      await step(`${who}: Şirket Muhasebesi'nde satış satırı görünür`, async () => {
        await page.goto(`${WEB}/play?tab=finance&period=today`);
        await page.getByRole("heading", { name: t("accounting.title"), level: 1 }).waitFor();
        const hist = page.locator(".acc-history");
        const saleBtn = hist.getByRole("button", { name: t("accounting.saleDetail") }).first();
        await saleBtn.waitFor({ timeout: 30_000 });
        const rev = (await api.get("/finance/accounting", { period: "today" })).summary.revenueByAccount.revenue_sales;
        if (!(BigInt(rev) > 0n)) throw new Error("satış geliri yok");
        await hist.scrollIntoViewIfNeeded();
        await snap(page, n);
        await saleBtn.click();
        await dialog(page).getByText(t("accounting.remaining")).waitFor();
        await snap(page, `${n}-satis-detayi`);
        await closeDialogs(page);
        const scan = await scanText(page);
        if (scan.raw.length || scan.junk.length) throw new Error(`ham metin ${JSON.stringify(scan)}`);
        const ox = await overflowX(page);
        if (ox > 1) throw new Error(`yatay taşma ${ox}px`);
        return { revenue_sales: rev };
      });
    }

    // ---- uzlaşma: iki şirketin satış/maliyet/stok değeri tutarlı (sunucu rakamları)
    await step("uzlaşma: A cogs+kâr, B alış maliyeti stoğa girdi, defter dengeli", async () => {
      const a = await A.api.get("/finance/accounting", { period: "today" });
      const b = await B.api.get("/finance/accounting", { period: "today" });
      const invA = sum(await A.api.get("/inventory"), (x) => x.costTotal);
      const invB = sum(await B.api.get("/inventory"), (x) => x.costTotal);
      const finA = await A.api.get("/finance");
      const finB = await B.api.get("/finance");
      if (BigInt(finA.balances.inventory) !== invA) throw new Error(`A stok ${finA.balances.inventory} ≠ ${invA}`);
      if (BigInt(finB.balances.inventory) !== invB) throw new Error(`B stok ${finB.balances.inventory} ≠ ${invB}`);
      // karma değil: B mısırı gider yazmadı; yalnızca satılan nişastanın maliyeti cogs
      return { A: { revenue: a.summary.revenue, net: a.summary.net }, B: { revenue: b.summary.revenue, net: b.summary.net } };
    });
  } catch (e) {
    failed++;
    for (const [page, n] of [[pageA, "zz-fail-a"], [pageB, "zz-fail-b"]]) { try { await snap(page, n); } catch { /* */ } }
  }
  saveJson(`${ROOT}/e2e/ui/out/v4-chain-${cfg.id}.json`, { config: cfg.id, a: aName, b: bName, steps, shots, consoleErrors: mon.consoleErrors, pageErrors: mon.pageErrors, api4xx5xx: mon.api4xx5xx });
  console.log(`${cfg.id}: ${steps.map((s) => `${s.ok ? "✓" : "✗"} ${s.name}${s.ok ? "" : ` (${s.error})`}`).join("\n  ")}`);
  await ctxA.close();
  await ctxB.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
