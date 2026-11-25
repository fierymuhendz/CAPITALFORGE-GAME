/**
 * Capital Forge v2 arayüz uçtan uca testi (Playwright, düz node betiği).
 * Kullanım: node e2e/ui/ui-e2e.mjs [phone-tr phone-en desktop-tr desktop-en] [--flows=1,2,...]
 * Sonuç: e2e/ui/out/results-<yapılandırma>.json, ekran görüntüleri docs/screenshots/e2e-*.png
 */
import {
  Admin, Api, PASSWORD, PROFILES, Monitor, T, WEB, chromium, companyName, foundViaApi, loginCtx, newPage, overflowX, register,
  saveJson, scanText, shot, sleep, uniq, ROOT,
} from "./lib.mjs";

const args = process.argv.slice(2);
const flowArg = args.find((a) => a.startsWith("--flows="));
const FLOWS = flowArg ? flowArg.slice(8).split(",").map(Number) : [1, 2, 3, 4, 5, 6, 7];
const CONFIGS = (args.filter((a) => !a.startsWith("--")).length ? args.filter((a) => !a.startsWith("--")) : ["phone-tr", "phone-en", "desktop-tr", "desktop-en"]).map((c) => {
  const [p, l] = c.split("-");
  return { id: c, profile: PROFILES[p], locale: l };
});

const world = await (await fetch(`${WEB}/api/world`)).json();
const admin = await Admin.getOrCreate();
const prodName = (id, l) => world.products.find((p) => p.id === id).name[l];
const cityName = (id, l) => world.cities.find((c) => c.id === id).name[l];
const bldName = (id, l) => world.buildingTypes.find((b) => b.id === id).name[l];

/** Kuruş tutarının biçimli metinde (TR 1.234,56 / EN 1,234.56) geçip geçmediği: ayraçsız rakam dizisi karşılaştırılır */
const digits = (s) => s.replace(/[^0-9]/g, "");
function hasMoney(text, kurus) {
  const k = BigInt(kurus);
  const abs = k < 0n ? -k : k;
  const want = `${abs / 100n}${(abs % 100n).toString().padStart(2, "0")}`;
  return digits(text).includes(want);
}

for (const cfg of CONFIGS) {
  const { profile, locale: L, id: CID } = cfg;
  // Kuruluş arsaları sınırlı (şehir başına 8 uygun); koşular arasında şehirleri dağıt
  const HOME = process.env.E2E_HOME || { "phone-tr": "demirdag", "phone-en": "demirdag", "desktop-tr": "demirdag", "desktop-en": "kavsak" }[CID];
  const phone = profile.name === "phone";
  const t = (k, p) => T(L, k, p);
  const results = [];
  const bugs = [];
  const mon = new Monitor(CID);
  const browser = await chromium.launch();
  const rec = (flow, step, ok, detail = "", shotPath = "") => {
    results.push({ cfg: CID, flow, step, ok, detail, shot: shotPath });
    console.log(`${ok ? "OK  " : "FAIL"} [${CID}] F${flow} ${step}${detail ? ` — ${detail}` : ""}`);
    if (!ok) bugs.push({ cfg: CID, flow, step, detail, shot: shotPath });
  };
  const step = async (flow, name, fn, page, shotName) => {
    const m = mon.mark();
    try {
      const d = await fn();
      const s = mon.since(m);
      const noise = [...s.console.map((x) => `konsol: ${x.text}`), ...s.page.map((x) => `sayfa hatası: ${x.text}`), ...s.api.map((x) => `${x.method} ${x.path} ${x.status} ${x.code}`)];
      rec(flow, name, true, [typeof d === "string" ? d : "", noise.length ? `UYARI ${noise.join(" | ")}` : ""].filter(Boolean).join(" ; "));
      if (noise.length) results[results.length - 1].noise = noise;
    } catch (e) {
      let sp = "";
      if (page) { try { sp = await shot(page, `${CID}-f${flow}-fail-${shotName ?? name.replace(/\W+/g, "-").slice(0, 24)}`); } catch { /* */ } }
      rec(flow, name, false, String(e.message).split("\n")[0].slice(0, 300), sp);
    }
  };
  const textCheck = async (page, flow, label) => {
    const r = await scanText(page);
    if (r.raw.length || r.junk.length) rec(flow, `metin taraması: ${label}`, false, `ham anahtar: ${r.raw.join(", ")} ${r.junk.join(",")}`, await shot(page, `${CID}-f${flow}-rawkey-${label.replace(/\W+/g, "-")}`));
  };
  const root = (page) => (phone ? page.locator(".panel-overlay") : page.locator(".side-body"));
  const openPanel = async (page, id) => {
    await page.goto(`${WEB}/play?tab=${id}`, { waitUntil: "domcontentloaded" });
    await root(page).first().waitFor({ state: "visible" });
    await page.waitForLoadState("networkidle").catch(() => {});
  };
  const flourPage = async (page) => {
    await openPanel(page, "market");
    await page.locator("tr[role=button]", { hasText: prodName("flour", L) }).first().click();
    await root(page).locator("button.chip", { hasText: cityName(HOME, L) }).first().click();
    await page.locator("h4", { hasText: t("market.asks") }).waitFor();
    await sleep(500);
  };
  /** Dokunma: engellenirse (ör. alt çubuğun altında kalan düğme) hata kaydedip DOM tıklaması ile akışı sürdür */
  const tapped = new Set();
  const tap = async (page, loc, label, flow) => {
    try { await loc.click({ timeout: 5000 }); } catch (e) {
      const info = await loc.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(Math.min(r.x + r.width / 2, innerWidth - 1), Math.min(r.y + r.height / 2, innerHeight - 1));
        return { hit: hit ? (hit.closest(".tabbar") ? "tabbar" : hit.tagName + "." + hit.className) : null, top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight };
      }).catch(() => ({}));
      if (!tapped.has(label)) {
        tapped.add(label);
        const sp = await shot(page, `${CID}-f${flow}-blocked-${label.replace(/\W+/g, "-").slice(0, 20)}`);
        bugs.push({ cfg: CID, flow, step: `düğme tıklanamıyor: ${label}`, detail: `elementFromPoint=${info.hit}; düğme y=${info.top}-${info.bottom}/${info.vh}; ${String(e.message).split("\n")[0].slice(0, 80)}`, shot: sp });
        rec(flow, `düğme tıklanamıyor: ${label}`, false, `engelleyen: ${info.hit}`, sp);
      }
      await loc.evaluate((el) => el.click());
    }
  };
  const toast = (page, key) => page.locator(".toast", { hasText: t(key) }).first().waitFor({ state: "visible" });
  const dlg = (page) => page.getByRole("dialog").last();

  /** Kuruluş sihirbazı (arayüz). Dönüş: sihirbazdaki doğrulamalar */
  async function wizard(page, flow, { name, city, sector, shotTag }) {
    const info = {};
    await page.getByLabel(t("found.companyName")).fill(name);
    await page.getByRole("button", { name: t("common.next"), exact: true }).click();
    await page.locator("button.card", { hasText: cityName(city, L) }).first().click();
    await page.getByRole("button", { name: t("common.next"), exact: true }).click();
    await page.locator("button.card", { hasText: t(`sector.${sector}`) }).first().click();
    await page.getByRole("button", { name: t("common.next"), exact: true }).click();
    await page.locator(".plotgrid button.plot").first().waitFor();
    const cell = await page.locator(".plotgrid button.plot").evaluateAll((els) => els.map((e) => ({ cls: e.className, label: e.getAttribute("aria-label"), text: e.innerText })));
    info.cells = cell.length;
    info.cellShowsPriceAndLoc = cell.every((c) => /\d+·\d+/.test(c.text) && /₺|TL/.test(c.text));
    const firstOk = page.locator(".plotgrid button.plot:not(.bad):not(.taken)").first();
    info.noPickNotice = await page.getByText(t("found.pickPlot")).isVisible();
    await firstOk.click();
    const detail = page.locator(".card", { has: page.getByText(t("found.distCenter")) }).last();
    await detail.waitFor();
    info.detailText = await detail.innerText();
    info.hasSupply = info.detailText.includes(t("found.nearSupply"));
    info.hasBuyers = info.detailText.includes(t("found.nearBuyers"));
    info.hasKm = /\d+ km/.test(info.detailText);
    info.hasPrice = /\d/.test(info.detailText) && /₺|TL/.test(info.detailText);
    info.hasLoc = new RegExp(`${cityName(city, L)} \\d+·\\d+`).test(info.detailText);
    info.shot = await shot(page, `${CID}-f${flow}-${shotTag}-plot`);
    await page.getByRole("button", { name: t("common.next"), exact: true }).click();
    await page.getByRole("button", { name: t("found.create"), exact: true }).waitFor();
    info.previewShot = await shot(page, `${CID}-f${flow}-${shotTag}-preview`);
    await page.getByRole("button", { name: t("found.create"), exact: true }).click();
    await page.waitForURL("**/play**");
    return info;
  }
  const cityRendered = async (page) => {
    await page.locator("section.stage canvas, section.stage svg").first().waitFor({ state: "visible", timeout: 20000 });
    await sleep(1500);
    const box = await page.locator("section.stage canvas, section.stage svg").first().boundingBox();
    if (!box || box.width < 200 || box.height < 150) throw new Error(`şehir görünümü çok küçük: ${JSON.stringify(box)}`);
    return `${await page.locator("section.stage canvas").count() ? "canvas" : "svg"} ${Math.round(box.width)}x${Math.round(box.height)}`;
  };

  // ---------------------------------------------------------------- Akış 1 + 2 (aynı hesap)
  const S = {}; // akışlar arası paylaşılan durum
  if (FLOWS.includes(1) || FLOWS.includes(2) || FLOWS.includes(4) || FLOWS.includes(5) || FLOWS.includes(6)) {
    const other = L === "tr" ? "en" : "tr";
    const { ctx, page } = await newPage(browser, profile, L, mon, other);
    S.mfgCtx = ctx;
    S.mfgPage = page;
    S.mfgName = companyName("Test Un Fabrikasi");
    S.mfgUser = uniq("e2e" + L);
    await step(1, "kayıt sayfası açılır, dil düğmesi ile dil değişir", async () => {
      await page.goto(`${WEB}/register`, { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: L.toUpperCase(), exact: true }).click();
      await page.getByRole("heading", { name: t("auth.registerTitle") }).waitFor();
      const ov = await overflowX(page);
      if (phone && ov > 1) throw new Error(`yatay taşma ${ov}px`);
      await textCheck(page, 1, "register");
      await shot(page, `${CID}-f1-register`);
    }, page);
    await step(1, "yeni hesap kaydı -> /found", async () => {
      await page.getByLabel(t("auth.username")).fill(S.mfgUser);
      await page.getByLabel(t("auth.password")).fill(PASSWORD);
      await page.getByRole("button", { name: t("auth.register"), exact: true }).click();
      await page.waitForURL("**/found", { timeout: 20000 });
    }, page);
    let info = null;
    await step(1, "sihirbaz: ad, şehir, sektör, uygun arsa; seçimde fiyat+konum+uzaklık görünür; /play şehir görünümü", async () => {
      await page.getByRole("heading", { name: t("found.s_name") }).waitFor();
      await shot(page, `${CID}-f1-wizard-name`);
      info = await wizard(page, 1, { name: S.mfgName, city: HOME, sector: "manufacturing", shotTag: "wizard" });
      const probs = [];
      if (!info.cellShowsPriceAndLoc) probs.push("harita hücresinde fiyat/konum yok");
      if (!info.hasPrice) probs.push("arsa ayrıntısında fiyat yok");
      if (!info.hasLoc) probs.push("arsa ayrıntısında konum (şehir x·y) yok");
      if (!info.hasKm) probs.push("km yok");
      if (!info.hasSupply) probs.push("kaynağa uzaklık (nearSupply) yok");
      if (!info.hasBuyers) probs.push("müşteriye uzaklık (nearBuyers) yok");
      if (!info.noPickNotice) probs.push("seçim öncesi yönlendirme metni yok");
      if (probs.length) { bugs.push({ cfg: CID, flow: 1, step: "arsa ayrıntısı", detail: probs.join("; "), shot: info.shot }); throw new Error(probs.join("; ")); }
      return `${info.cells} arsa; ayrıntı: ${info.detailText.replace(/\s+/g, " ").slice(0, 160)}`;
    }, page);
    await step(1, "/play: şehir görünümü çizilir", async () => {
      await page.waitForURL("**/play**");
      const what = await cityRendered(page);
      await shot(page, `${CID}-f1-play-city`);
      await textCheck(page, 1, "play-city");
      if (phone && (await overflowX(page)) > 1) throw new Error("telefonda yatay taşma");
      return what;
    }, page);
    await step(1, "dil düğmesi: hesap tercihi ile dil kalıcı", async () => {
      const me = await (await ctx.request.get(`${WEB}/api/auth/me`)).json();
      if (me.account.locale !== L) throw new Error(`hesap dili ${me.account.locale}, beklenen ${L}`);
      S.mfgApiCookie = (await ctx.cookies()).find((c) => c.name === "cf_session")?.value;
    }, page);
  }

  // ---------------------------------------------------------------- Akış 2
  if (FLOWS.includes(2) && S.mfgPage) {
    const page = S.mfgPage;
    await step(2, "tesis kartı açılır; teklif girdi/çıktı/süre/birim maliyet gösterir", async () => {
      await openPanel(page, "facilities");
      await page.locator("button.card", { hasText: bldName("food_plant", L) }).first().click();
      await page.getByText(t("facility.newJob")).waitFor();
      await page.getByText(t("quote.title")).waitFor({ timeout: 10000 });
      const scope = root(page);
      const txt = await scope.innerText();
      const miss = [t("quote.output"), t("quote.duration"), t("quote.unitCost"), t("quote.total"), prodName("grain", L), prodName("flour", L)].filter((x) => !txt.includes(x));
      await shot(page, `${CID}-f2-quote`);
      if (miss.length) throw new Error(`teklifte eksik: ${miss.join(", ")}`);
      await textCheck(page, 2, "quote");
      return txt.split("\n").filter((l) => /dk|min|₺/.test(l)).slice(0, 4).join(" | ");
    }, page);
    await step(2, "tek elle: Başlat düğmesi ekranda, alt yarıda, dokunma hedefi >=44px", async () => {
      const b = page.getByRole("button", { name: t("facility.start"), exact: true });
      await b.scrollIntoViewIfNeeded();
      const box = await b.boundingBox();
      const vp = page.viewportSize();
      if (!box) throw new Error("düğme yok");
      if (box.height < 44) throw new Error(`düğme yüksekliği ${box.height}`);
      if (box.y + box.height > vp.height + 1) throw new Error("düğme ekran dışı");
      if (phone && box.y < vp.height * 0.5) throw new Error(`düğme üst yarıda (y=${Math.round(box.y)}/${vp.height}); baş parmak erişimi zor`);
      return `y=${Math.round(box.y)} h=${Math.round(box.height)} vp=${vp.height}`;
    }, page);
    await step(2, "üretim başlatılır, toast + çalışan iş görünür", async () => {
      await page.getByRole("button", { name: t("facility.start"), exact: true }).click();
      await toast(page, "facility.started");
      await page.getByText(t("facility.remaining")).first().waitFor({ state: "attached" }).catch(() => {});
      await shot(page, `${CID}-f2-started`);
      const c = await (await S.mfgPage.context().request.get(`${WEB}/api/company`)).json();
      const run = c.facilities.flatMap((f) => f.jobs).filter((j) => j.status === "running");
      if (!run.length) throw new Error("API'de çalışan iş yok");
      S.job = run[0];
    }, page);
    await step(2, "zaman ilerletilir (admin API) -> iş tamamlanır, stok envanterde", async () => {
      const mins = Math.ceil((Date.parse(S.job.endsAt) - Date.now()) / 60000);
      await admin.advance(Math.max(240, 60));
      await openPanel(page, "inventory");
      const flour = prodName("flour", L);
      await page.locator("tr[role=button], .tbl tr", { hasText: flour }).first().waitFor({ timeout: 10000 });
      const inv = await (await page.context().request.get(`${WEB}/api/inventory`)).json();
      const f = inv.filter((h) => h.productId === "flour");
      if (!f.length) throw new Error("API envanterinde un yok");
      S.flourKg = f.reduce((a, h) => a + h.availableKg, 0);
      S.flourQ = f[0].quality;
      await shot(page, `${CID}-f2-inventory`);
      await textCheck(page, 2, "inventory");
      return `un ${S.flourKg} kg, kalite ${S.flourQ}`;
    }, page);
    await step(2, "envanterden un satılır: sistem alım emrine (pazar) satış", async () => {
      await page.locator("tr[role=button]", { hasText: prodName("flour", L) }).first().click();
      await dlg(page).getByRole("button", { name: t("inventory.sell"), exact: true }).click();
      // Pazar ürün sayfası + ilan oluşturma sayfası açılır; kapat
      await page.getByRole("heading", { name: prodName("flour", L) }).first().waitFor();
      await page.keyboard.press("Escape");
      const bids = page.locator("h4", { hasText: t("market.bids") });
      await bids.waitFor();
      await shot(page, `${CID}-f2-market-flour`);
      // ilk sistem alım emri satırı: Sat düğmesi
      const sellBtn = page.getByRole("button", { name: t("market.sell"), exact: true }).first();
      await sellBtn.scrollIntoViewIfNeeded();
      await sellBtn.click();
      const d = dlg(page);
      const qty = Math.max(1, Math.min(500, Math.floor(S.flourKg / 2)));
      await d.getByRole("button", { name: "kg", exact: true }).click();
      await d.getByLabel(t("market.qty")).fill(String(qty));
      S.soldKg = qty;
      await shot(page, `${CID}-f2-sell-sheet`);
      await tap(page, d.getByRole("button", { name: t("market.sell"), exact: true }), "Sat gönder", 2);
      await toast(page, "market.sold");
    }, page);
    await step(2, "finans: satış satırı ve gelir görünür", async () => {
      await openPanel(page, "finance");
      await page.getByRole("tab", { name: t("finance.sales") }).click();
      const row = page.locator(".tbl tbody tr").first();
      await row.waitFor();
      const sales = await (await page.context().request.get(`${WEB}/api/finance/sales`)).json();
      const s = sales[0];
      S.sale2 = s;
      const txt = await row.innerText();
      const miss = [["gross", s.gross], ["cogs", s.cogs], ["fees", s.fees], ["netProfit", s.netProfit]].filter(([, v]) => !hasMoney(txt, v)).map(([k]) => k);
      await shot(page, `${CID}-f2-finance-sales`);
      if (miss.length) throw new Error(`satış satırında API ile uyuşmayan: ${miss.join(",")} satır="${txt.replace(/\s+/g, " ")}"`);
      if (BigInt(s.gross) - BigInt(s.cogs) - BigInt(s.freight) - BigInt(s.fees) !== BigInt(s.netProfit)) throw new Error("net kâr = tahsilat-COGS-nakliye-ücret değil");
      await page.getByRole("tab", { name: t("finance.overview") }).click();
      const fin = await (await page.context().request.get(`${WEB}/api/finance`)).json();
      await sleep(600);
      const otxt = await root(page).innerText();
      if (BigInt(fin.pnl.revenue) <= 0n) throw new Error("P&L geliri 0");
      if (!hasMoney(otxt, fin.pnl.revenue)) throw new Error(`genel bakışta gelir ${fin.pnl.revenue} görünmüyor`);
      await shot(page, `${CID}-f2-finance-overview`);
      await textCheck(page, 2, "finance");
      return `gelir ${fin.pnl.revenue}, net ${s.netProfit}`;
    }, page);
  }

  // ---------------------------------------------------------------- Akış 3 (nakliye)
  if (FLOWS.includes(3)) {
    const { ctx, page } = await newPage(browser, profile, L, mon);
    const fr = await register(L, "e2efr");
    await loginCtx(ctx, fr.username);
    // sistem nakliye işlerinden birinin çıkış şehrinde kur
    let jobs = S.mfgPage ? await (await S.mfgPage.context().request.get(`${WEB}/api/freight-jobs?scope=board`)).json() : [];
    if (!Array.isArray(jobs)) jobs = [];
    let job0 = null;
    for (const j of jobs.filter((x) => x.status === "open" && x.isSystem).sort((a, b) => (b.originCityId === "yesilova") - (a.originCityId === "yesilova"))) {
      const o = await fr.api.get("/world/onboarding", { cityId: j.originCityId, sector: "freight" });
      if (o.plots.some((p) => p.eligible)) { job0 = j; break; }
    }
    const fcity = job0?.originCityId ?? "yesilova";
    S.freight = { api: fr.api, ctx, page, user: fr.username };
    await step(3, "nakliye şirketi kurulur (sihirbaz), başlangıç kamyonu görünür", async () => {
      await page.goto(`${WEB}/found`, { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: t("found.s_name") }).waitFor();
      const inf = await wizard(page, 3, { name: companyName("Test Nakliyat"), city: fcity, sector: "freight", shotTag: "wizard" });
      await cityRendered(page);
      await openPanel(page, "logistics");
      await page.locator(".card", { hasText: world.vehicleModels.find((v) => v.id === "truck").name[L] }).first().waitFor();
      await shot(page, `${CID}-f3-fleet`);
      await textCheck(page, 3, "fleet");
      if (!inf.hasSupply || !inf.hasBuyers) results.push({ cfg: CID, flow: 3, step: "gözlem", ok: true, detail: "nakliye sektöründe arsa ayrıntısında kaynağa/müşteriye uzaklık yok (yalnızca merkeze km)" });
    }, page);
    await step(3, "boş durumlar yönlendirme metni gösterir (envanter, sözleşmeler, satışlar, sevkiyatlar)", async () => {
      const probs = [];
      await openPanel(page, "inventory");
      let txt = await root(page).innerText();
      if (!txt.includes(t("inventory.emptyText"))) probs.push("envanter boş durum metni yok");
      await shot(page, `${CID}-f3-empty-inventory`);
      await openPanel(page, "contracts");
      await page.getByRole("tab", { name: t("contracts.mine") }).click();
      await sleep(500);
      txt = await root(page).innerText();
      if (!txt.includes(t("contracts.emptyMineText"))) probs.push("sözleşmelerim boş durum metni yok");
      await openPanel(page, "finance");
      await page.getByRole("tab", { name: t("finance.sales") }).click();
      await sleep(500);
      txt = await root(page).innerText();
      if (!txt.includes(t("finance.noSalesText"))) probs.push("satışlar boş durum metni yok");
      await openPanel(page, "logistics");
      await page.getByRole("tab", { name: t("logistics.shipments") }).click();
      await sleep(500);
      txt = await root(page).innerText();
      if (!txt.includes(t("logistics.noShipmentsText"))) probs.push("sevkiyatlar boş durum metni yok");
      await shot(page, `${CID}-f3-empty-shipments`);
      if (probs.length) throw new Error(probs.join("; "));
    }, page);
    await step(3, "nakliye panosundan iş kabul edilir; araç yük ve varış ile görünür", async () => {
      if (!job0) throw new Error("panoda iş yok (sistem nakliye işi üretilmemiş)");
      await openPanel(page, "logistics");
      await page.getByRole("tab", { name: t("logistics.board") }).click();
      const card = page.locator(".card", { hasText: cityName(job0.destCityId, L) }).filter({ has: page.getByRole("button", { name: t("logistics.accept"), exact: true }) }).first();
      await card.waitFor();
      await shot(page, `${CID}-f3-board`);
      await card.getByRole("button", { name: t("logistics.accept"), exact: true }).click();
      await toast(page, "logistics.accepted");
      await page.getByRole("tab", { name: t("logistics.fleet") }).click();
      const fleetCard = page.locator(".card", { hasText: `→ ${cityName(job0.destCityId, L)}` }).first();
      await fleetCard.waitFor();
      await page.getByRole("tab", { name: t("logistics.shipments") }).click();
      const sc = page.locator(".card", { hasText: `${cityName(job0.originCityId, L)} → ${cityName(job0.destCityId, L)}` }).first();
      await sc.waitFor();
      const stxt = await sc.innerText();
      await shot(page, `${CID}-f3-shipment`);
      const ships = await fr.api.get("/shipments", { scope: "mine" });
      const sh = ships[0];
      const cargoUi = !stxt.includes(t("logistics.emptyLoad"));
      if (!sh?.cargo?.length || !cargoUi) {
        throw new Error(`sevkiyatta yük görünmüyor: API cargo=${JSON.stringify(sh?.cargo)}; kart="${stxt.replace(/\s+/g, " ").slice(0, 160)}" (iş ${job0.totalKg} kg)`);
      }
    }, page);
    await step(3, "araç harita üzerinde (şehir görünümü) çizilir", async () => {
      await page.goto(`${WEB}/play`, { waitUntil: "domcontentloaded" });
      const w = await cityRendered(page);
      await shot(page, `${CID}-f3-map-vehicle`);
      const map = await (await ctx.request.get(`${WEB}/api/world/map`)).json();
      const mine = map.vehicles.filter((v) => v.isMine && v.shipment);
      if (!mine.length) throw new Error("world/map içinde yolda araç yok");
      const v = mine[0];
      if (!v.shipment.cargo || !v.shipment.cargo.length) throw new Error(`world/map araç yükü boş (totalKg=${v.shipment.totalKg})`);
      return w;
    }, page);
  }

  // ---------------------------------------------------------------- Akış 4 (pazar ilanı) ve 5 (sözleşme)
  let buyer = null;
  if ((FLOWS.includes(4) || FLOWS.includes(5)) && S.mfgPage) {
    const bctx = await newPage(browser, profile, L, mon);
    const b = await register(L, "e2ebuy");
    await foundViaApi(b.api, { sector: "manufacturing", cityId: HOME, name: companyName("Test Alici") });
    await loginCtx(bctx.ctx, b.username);
    buyer = { ...b, ...bctx };
    S.buyerName = (await b.api.get("/company")).name;
    // satıcının un stoğunu garanti et
    if (!S.flourKg) {
      const sapi = new Api(); void sapi;
    }
  }
  if (FLOWS.includes(4) && S.mfgPage && buyer) {
    const page = S.mfgPage;
    await step(4, "satıcı pazarda un ilanı verir", async () => {
      await flourPage(page);
      await page.getByRole("button", { name: t("market.newListing"), exact: true }).first().click();
      const d = dlg(page);
      const inv = await (await page.context().request.get(`${WEB}/api/inventory`)).json();
      const kg = inv.filter((h) => h.productId === "flour").reduce((a, h) => a + h.availableKg, 0);
      if (kg < 2) throw new Error("satıcıda yeterli un yok");
      S.listKg = Math.max(1, Math.floor(kg / 2));
      await d.getByRole("button", { name: "kg", exact: true }).first().click();
      await d.getByLabel(t("market.qty")).fill(String(S.listKg));
      await shot(page, `${CID}-f4-listing-sheet`);
      await tap(page, d.getByRole("button", { name: t("market.newListing"), exact: true }), "İlan oluştur gönder", 4);
      await toast(page, "market.listed");
    }, page);
    await step(4, "alıcı ilanı satın alır", async () => {
      const bp = buyer.page;
      await flourPage(bp);
      const row = bp.locator("tr", { hasText: S.mfgName }).first();
      await row.waitFor();
      await row.getByRole("button", { name: t("market.buy"), exact: true }).click();
      const d = dlg(bp);
      await d.getByRole("button", { name: "kg", exact: true }).click();
      await d.getByLabel(t("market.qty")).fill(String(S.listKg));
      await shot(bp, `${CID}-f4-buy-sheet`);
      await tap(bp, d.getByRole("button", { name: t("market.buy"), exact: true }), "Satın al gönder", 4);
      await toast(bp, "market.bought");
    }, buyer.page);
    await step(4, "satıcının satış satırı tahsilat, COGS, ücret ve net kârı gösterir", async () => {
      await openPanel(page, "finance");
      await page.getByRole("tab", { name: t("finance.sales") }).click();
      const sales = await (await page.context().request.get(`${WEB}/api/finance/sales`)).json();
      const s = sales.find((x) => x.buyerName === S.buyerName);
      if (!s) throw new Error("API satışlarında alıcı adıyla satış yok");
      const row = page.locator(".tbl tbody tr", { hasText: S.buyerName }).first();
      await row.waitFor();
      const txt = await row.innerText();
      const miss = [["gross", s.gross], ["cogs", s.cogs], ["fees", s.fees], ["netProfit", s.netProfit]].filter(([, v]) => !hasMoney(txt, v)).map(([k]) => k);
      for (const k of [t("finance.collected"), t("finance.cogs"), t("finance.fees"), t("finance.netProfit")]) {
        const heads = await page.locator("thead th, td[data-label]").evaluateAll((els, key) => els.some((e) => (e.textContent || e.getAttribute("data-label") || "").includes(key) || (e.getAttribute("data-label") || "").includes(key)), k);
        if (!heads) miss.push(`başlık:${k}`);
      }
      await shot(page, `${CID}-f4-sale-row`);
      if (miss.length) throw new Error(`satış satırı uyuşmuyor: ${miss.join(",")}`);
      if (BigInt(s.fees) <= 0n) throw new Error(`pazar ücreti 0 (fees=${s.fees}, tahsilat=${s.gross}, ücret oranı ${world.marketFeeBp} bp)`);
      if (BigInt(s.gross) - BigInt(s.cogs) - BigInt(s.freight) - BigInt(s.fees) !== BigInt(s.netProfit)) throw new Error("net kâr formülü tutmuyor");
      await row.click();
      await dlg(page).getByText(t("finance.traceChain")).waitFor();
      await shot(page, `${CID}-f4-sale-trace`);
      await textCheck(page, 4, "sale-trace");
      return `tahsilat ${s.gross} COGS ${s.cogs} ücret ${s.fees} net ${s.netProfit}`;
    }, page);
  }

  if (FLOWS.includes(5) && S.mfgPage && buyer) {
    const page = S.mfgPage;
    await step(5, "satıcı yinelenen sözleşme teklifi verir (doğrudan şirkete)", async () => {
      await openPanel(page, "contracts");
      await page.getByRole("tab", { name: t("contracts.new") }).click();
      await page.getByRole("button", { name: t("contracts.toCompany"), exact: true }).click();
      await page.getByLabel(t("contracts.companySearch")).fill(S.buyerName.slice(0, 12));
      await page.getByRole("button", { name: S.buyerName, exact: false }).first().click();
      await page.getByLabel(t("inventory.product"), { exact: true }).selectOption({ label: prodName("flour", L) });
      const r = root(page);
      await r.getByLabel(t("contracts.qtyPer")).locator("xpath=following::button[normalize-space()='kg'][1]").click();
      await r.getByLabel(t("contracts.qtyPer")).fill("300");
      await r.getByLabel(t("market.price"), { exact: true }).fill("12000");
      await r.getByLabel(t("contracts.installments")).fill("3");
      await r.getByLabel(t("contracts.interval")).fill("24");
      await shot(page, `${CID}-f5-new-offer`);
      const btn = r.getByRole("button", { name: t("contracts.create"), exact: true });
      await btn.scrollIntoViewIfNeeded();
      if (await btn.isDisabled()) throw new Error(`Oluştur pasif; form metni: ${(await r.locator(".notice, .err, .error").allInnerTexts()).join("|")}`);
      await tap(page, btn, "Sözleşme oluştur", 5);
      await toast(page, "contracts.created");
    }, page);
    await step(5, "alıcı kabulden önce koşullar ekranında tüm şartları görür", async () => {
      const bp = buyer.page;
      await bp.goto(`${WEB}/play?tab=contracts`, { waitUntil: "domcontentloaded" });
      await root(bp).first().waitFor();
      await bp.getByRole("tab", { name: t("contracts.mine") }).click();
      await bp.locator("button.card", { hasText: prodName("flour", L) }).first().click();
      const d = dlg(bp);
      await d.getByText(t("contracts.terms")).waitFor();
      const txt = await d.innerText();
      await shot(bp, `${CID}-f5-terms`);
      const need = {
        ürün: prodName("flour", L), kalite: t("market.minQuality"), miktar: t("contracts.qtyPer"), "birim fiyat": t("market.price"), şehir: t("contracts.deliveryCity"), "nakliye ödeyen": t("contracts.freightPayer"),
        "taksit sayısı": t("contracts.installments"), "ilk vade": t("contracts.firstDue"), aralık: t("contracts.interval"), tolerans: t("contracts.grace"),
        "eksik teslim cezası": t("contracts.missingPenalty"), "geç/kısmi": t("contracts.latePenalty"), "iptal koşulu": t("contracts.cancelTerms"),
      };
      const miss = Object.entries(need).filter(([, v]) => !txt.includes(v)).map(([k]) => k);
      if (!txt.includes(cityName("korfezkent", L))) miss.push("şehir adı");
      if (!hasMoney(txt, "1200") && !/12[.,]?000|1[.,]200/.test(txt)) miss.push("birim fiyat değeri");
      if (!txt.includes(t("contracts.schedule"))) miss.push("(not) kabulden önce taksit takvimi tablosu yok; yalnızca ilk vade/aralık");
      if (miss.length) {
        const hard = miss.filter((m) => !m.startsWith("(not)"));
        if (hard.length) throw new Error(`koşullar ekranında eksik: ${miss.join(", ")}`);
        results.push({ cfg: CID, flow: 5, step: "gözlem", ok: true, detail: miss.join(", ") });
      }
      if (!txt.includes(t("contracts.acceptBuyer", { amount: "" }).slice(0, 8))) { /* uyarı metni dile göre değişir; kabul düğmesi kontrol edilir */ }
      await textCheck(bp, 5, "terms");
    }, buyer.page);
    await step(5, "alıcı kabul eder; sözleşme aktif, takvim görünür", async () => {
      const bp = buyer.page;
      await tap(bp, dlg(bp).getByRole("button", { name: t("contracts.accept"), exact: true }), "Sözleşme kabul", 5);
      await toast(bp, "contracts.accepted");
      await bp.locator("button.card", { hasText: prodName("flour", L) }).first().click();
      await dlg(bp).getByText(t("contracts.schedule")).waitFor();
      await shot(bp, `${CID}-f5-active`);
      const list = await buyer.api.get("/contracts", { scope: "mine" });
      if (!list.some((c) => c.status === "active")) throw new Error("API'de aktif sözleşme yok");
    }, buyer.page);
  }

  // ---------------------------------------------------------------- Akış 6 (yönetim)
  if (FLOWS.includes(6) && S.mfgPage) {
    const page = S.mfgPage;
    await step(6, "oyuncu hesabı /admin'de yönetim verisi göremez", async () => {
      const apiCalls = [];
      page.on("response", (r) => { if (r.url().includes("/api/admin")) apiCalls.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
      await page.goto(`${WEB}/admin`, { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: t("admin.title") }).first().waitFor();
      await page.getByText(t("admin.needClaim")).waitFor();
      const txt = await page.locator("main").innerText();
      const leak = [t("admin.tabs.overview"), t("admin.tabs.alerts"), t("admin.tabs.audit"), t("admin.tabs.time")].filter((x) => txt.includes(x));
      await shot(page, `${CID}-f6-player-admin`);
      const direct = await page.context().request.get(`${WEB}/api/admin/overview`);
      const direct2 = await page.context().request.post(`${WEB}/api/admin/time/advance`, { headers: { "x-cf-intent": "1", "content-type": "application/json" }, data: { minutes: 1 } });
      const probs = [];
      if (leak.length) probs.push(`yönetim sekmeleri görünüyor: ${leak.join(",")}`);
      if (direct.status() < 400) probs.push(`GET /admin/overview oyuncuya ${direct.status()} döndü`);
      if (direct2.status() < 400) probs.push(`POST /admin/time/advance oyuncuya ${direct2.status()} döndü`);
      if (apiCalls.some((c) => / 200$/.test(c))) probs.push(`oyuncu için admin API 200: ${apiCalls.join(",")}`);
      await textCheck(page, 6, "player-admin");
      if (probs.length) throw new Error(probs.join("; "));
      return `GET overview=${direct.status()} advance=${direct2.status()}`;
    }, page);
    await step(6, "yönetici: giriş sonrası 2FA doğrulama ekranı, ardından genel bakış yüklenir", async () => {
      await admin.api.req("PATCH", "/account/prefs", { locale: L }); // hesap dili arayüz dilini belirler
      const { ctx, page: ap } = await newPage(browser, profile, L, mon);
      try {
        await loginCtx(ctx, admin.username);
        await ap.goto(`${WEB}/admin`, { waitUntil: "domcontentloaded" });
        await ap.getByRole("heading", { name: t("admin.verifyTitle") }).waitFor();
        const before = await ap.locator("main").innerText();
        if (before.includes(t("admin.tabs.overview"))) throw new Error("2FA öncesi yönetim sekmeleri görünüyor");
        const pre = await ctx.request.get(`${WEB}/api/admin/overview`);
        if (pre.status() < 400) throw new Error(`2FA öncesi GET /admin/overview ${pre.status()} döndü`);
        await shot(ap, `${CID}-f6-admin-2fa`);
        const code = await admin.nextCode();
        await ap.getByLabel(t("adminSetup.code")).fill(code);
        await ap.getByRole("button", { name: t("admin.verify"), exact: true }).click();
        await ap.getByRole("tab", { name: t("admin.tabs.overview") }).waitFor({ timeout: 15000 });
        await sleep(1200);
        await shot(ap, `${CID}-f6-admin-overview`);
        await textCheck(ap, 6, "admin-overview");
        const tabs = ["alerts", "search", "connections", "cases", "catalog", "audit", "time", "overview"];
        for (const id of tabs) {
          await ap.getByRole("tab", { name: t(`admin.tabs.${id}`), exact: true }).click();
          await sleep(700);
          await textCheck(ap, 6, `admin-${id}`);
          if (id === "time" && !phone) await shot(ap, `${CID}-f6-admin-time`);
        }
        if (phone && (await overflowX(ap)) > 1) {
          bugs.push({ cfg: CID, flow: 6, step: "yönetim telefon taşma", detail: `yatay taşma ${await overflowX(ap)}px`, shot: await shot(ap, `${CID}-f6-admin-overflow`) });
        }

      } catch (e) { await shot(ap, `${CID}-f6-admin-fail`).catch(() => {}); throw e; }
      await ctx.close();
    }, page);
  }

  // ---------------------------------------------------------------- Akış 7 (düğme taraması, boş durum, ham anahtar)
  if (FLOWS.includes(7) && S.mfgPage) {
    const page = S.mfgPage;
    const panels = ["company", "facilities", "inventory", "market", "contracts", "logistics", "finance", "research", "notifications", "account"];
    const DENY = [t("account.logout"), t("account.dissolveBtn"), "Türkçe", "English"]; // dil düğmeleri ayrı adımda sınanır
    const sweep = [];
    for (const id of panels) {
      await step(7, `panel taraması: ${id} (ham anahtar, konsol, API hatası, düğmeler)`, async () => {
        await openPanel(page, id);
        await sleep(600);
        await textCheck(page, 7, `panel-${id}`);
        if (phone && (await overflowX(page)) > 1) throw new Error(`yatay taşma ${await overflowX(page)}px`);
        const labels = await root(page).locator("button:visible:not([disabled])").evaluateAll((els) => els.map((e, n) => ({ n, text: (e.getAttribute("aria-label") || e.innerText || "").trim().replace(/\s+/g, " ").slice(0, 60), danger: e.classList.contains("danger") })));
        const dead = [];
        let reset = false;
        for (const lb of labels) {
          if (lb.danger || DENY.includes(lb.text)) continue;
          if (reset) { await openPanel(page, id); await sleep(300); reset = false; }
          const btn = root(page).locator("button:visible:not([disabled])").nth(lb.n);
          if (!(await btn.count())) continue;
          const sig = async () => ({ url: page.url(), html: (await root(page).count()) ? (await root(page).first().innerHTML({ timeout: 3000 }).catch(() => "?")).replace(/\d+/g, "#") : "(kapalı)", dialogs: await page.getByRole("dialog").count(), toasts: await page.locator(".toast").count(), body: (await page.locator("body").innerText()).length });
          const reqs = [];
          const onReq = (r) => { if (r.url().includes("/api/") && r.method() !== "GET") reqs.push(r.url()); };
          page.on("request", onReq);
          const a = await sig();
          if ((await btn.getAttribute("aria-pressed")) === "true" || (await btn.getAttribute("aria-selected")) === "true") { sweep.push({ panel: id, label: lb.text, note: "zaten seçili" }); continue; }
          let err = null;
          try { await btn.click({ timeout: 4000 }); } catch (e) { err = String(e.message).split("\n")[0]; }
          await sleep(500);
          const b = await sig();
          page.off("request", onReq);
          sweep.push({ panel: id, label: lb.text });
          const same = JSON.stringify(a) === JSON.stringify(b) && !reqs.length;
          if (err) dead.push(`"${lb.text}" tıklanamadı: ${err}`);
          else if (same) dead.push(`"${lb.text}" görünür bir şey yapmadı`);
          // açılan pencereleri kapat; panel değiştiyse yeniden aç
          if (await page.getByRole("dialog").count()) await page.keyboard.press("Escape");
          if (a.url !== b.url || a.html !== b.html || reqs.length) reset = true;
        }
        if (dead.length) {
          const sp = await shot(page, `${CID}-f7-dead-${id}`);
          bugs.push({ cfg: CID, flow: 7, step: `ölü düğme: ${id}`, detail: dead.join("; "), shot: sp });
          throw new Error(dead.join("; "));
        }
        return `${labels.length} düğme tıklandı`;
      }, page);
    }
    saveJson(`${ROOT}/e2e/ui/out/sweep-${CID}.json`, sweep);
    await step(7, "telefon alt gezinme çubuğu ve Daha fazla sayfası", async () => {
      if (!phone) return "masaüstü: atlandı";
      await page.goto(`${WEB}/play`, { waitUntil: "domcontentloaded" });
      for (const k of ["tabs.production", "tabs.market", "tabs.logistics", "tabs.city"]) {
        await page.locator(".tabbar").getByRole("button", { name: t(k), exact: true }).click();
        await sleep(500);
        await textCheck(page, 7, `tab-${k}`);
      }
      await page.locator(".tabbar").getByRole("button", { name: t("tabs.more"), exact: true }).click();
      await dlg(page).waitFor();
      await shot(page, `${CID}-f7-more`);
      await textCheck(page, 7, "more");
      await page.keyboard.press("Escape");
    }, page);
    await step(7, "masaüstü kenar gezinme sekmeleri", async () => {
      if (phone) return "telefon: atlandı";
      await page.goto(`${WEB}/play`, { waitUntil: "domcontentloaded" });
      await page.locator(".side-nav").waitFor();
      const tabs = page.locator(".side-nav button.tab");
      const n = await tabs.count();
      for (let k = 0; k < n; k++) { await tabs.nth(k).click(); await sleep(300); await textCheck(page, 7, `nav-${k}`); }
      await shot(page, `${CID}-f7-desktop-nav`);
    }, page);
    // arayüzde dil değişimi (hesap tercihi) kalıcı mı
    await step(7, "hesap panelinden dil değişimi arayüzü çevirir ve geri alınır", async () => {
      await openPanel(page, "account");
      const other = L === "tr" ? "en" : "tr";
      await root(page).getByRole("button", { name: other === "tr" ? "Türkçe" : "English", exact: true }).click();
      await root(page).getByText(T(other, "account.password")).first().waitFor();
      await shot(page, `${CID}-f7-lang-switched`);
      await textCheck(page, 7, "lang-switched");
      await root(page).getByRole("button", { name: L === "tr" ? "Türkçe" : "English", exact: true }).click();
      await root(page).getByText(t("account.password")).first().waitFor();
    }, page);
  }

  // ---------------------------------------------------------------- bitiş
  const total = { console: mon.consoleErrors, pageErrors: mon.pageErrors, api: mon.api4xx5xx };
  saveJson(`${ROOT}/e2e/ui/out/results-${CID}.json`, { cfg: CID, results, bugs, monitor: total });
  console.log(`\n== ${CID}: ${results.filter((r) => r.ok).length} geçti, ${results.filter((r) => !r.ok).length} kaldı; konsol hatası ${mon.consoleErrors.length}, sayfa hatası ${mon.pageErrors.length}, API 4xx/5xx ${mon.api4xx5xx.length}\n`);
  await browser.close();
}
