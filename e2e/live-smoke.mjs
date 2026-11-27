/**
 * Canlı adres duman testi (GitHub Actions'tan çalışır; oyun verisini kirletmemek için tek, sabit bir
 * doğrulama hesabı kullanır ve her çalıştırmada aynı şirketi yeniden kullanır).
 *
 * Kullanım: BASE_URL=https://alan.adi SMOKE_PASSWORD=... node e2e/live-smoke.mjs
 * Ekran görüntüleri: e2e/out/*.png, sonuç: e2e/out/sonuc.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, devices } from "playwright";

const BASE = (process.env.BASE_URL ?? "").replace(/\/$/, "");
const PASSWORD = process.env.SMOKE_PASSWORD ?? "";
const USER = process.env.SMOKE_USERNAME ?? "zz_dogrulama";
if (!BASE.startsWith("https://")) throw new Error("BASE_URL https ile başlamalı");
if (PASSWORD.length < 10) throw new Error("SMOKE_PASSWORD en az 10 karakter olmalı");
mkdirSync("e2e/out", { recursive: true });

const results = [];
const step = async (name, fn) => {
  const t = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: Date.now() - t, detail: detail ?? null });
    console.log(`✓ ${name}${detail ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t, error: String(e?.message ?? e) });
    console.log(`✗ ${name} — ${e?.message ?? e}`);
  }
};

let cookie = "";
const key = () => `smoke-${Date.now()}-${Math.random().toString(36).slice(2)}`;
async function api(method, path, body) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { "content-type": "application/json", "x-cf-intent": "1", ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get("set-cookie");
  if (set) {
    const m = /cf_session=([^;]*)/.exec(set);
    if (m) cookie = m[1] ? `cf_session=${m[1]}` : "";
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* metin yanıt */ }
  return { status: res.status, json, text };
}
const must = (r, ...ok) => {
  if (!ok.includes(r.status)) throw new Error(`HTTP ${r.status}: ${r.text.slice(0, 300)}`);
  return r.json;
};

await step("sağlık: /api/health", async () => {
  const r = await api("GET", "/health");
  must(r, 200);
  return r.json;
});

await step("sağlık: /ws/health ve /", async () => {
  const ws = await fetch(`${BASE}/ws/health`);
  if (ws.status !== 200) throw new Error(`/ws/health HTTP ${ws.status}`);
  const home = await fetch(`${BASE}/`);
  if (home.status !== 200) throw new Error(`/ HTTP ${home.status}`);
  return { ws: ws.status, home: home.status };
});

await step("kayıt veya giriş", async () => {
  const reg = await api("POST", "/auth/register", { username: USER, password: PASSWORD, locale: "tr" });
  if (reg.status === 200 || reg.status === 201) return "yeni hesap açıldı";
  const login = await api("POST", "/auth/login", { username: USER, password: PASSWORD });
  must(login, 200);
  return "mevcut hesapla giriş yapıldı";
});

let me = null;
await step("oturum: /auth/me", async () => {
  me = must(await api("GET", "/auth/me"), 200);
  return { username: me?.account?.username ?? me?.username, hasCompany: Boolean(me?.company) };
});

let world = null;
await step("dünya: /world", async () => {
  world = must(await api("GET", "/world"), 200);
  return { cities: world.cities?.length, products: world.products?.length };
});

await step("şirket kur (yoksa)", async () => {
  if (me?.company) return `var: ${me.company.name}`;
  const ob = must(await api("GET", "/world/onboarding?cityId=yesilova&sector=crop"), 200);
  const plot = ob.plots.find((p) => p.eligible);
  if (!plot) throw new Error("uygun arsa yok");
  const r = await api("POST", "/company", { name: "Doğrulama Çiftliği", cityId: "yesilova", sector: "crop", plotId: plot.id, idempotencyKey: key() });
  must(r, 200, 201);
  return `kuruldu, arsa ${plot.id}, ilk iş tahmini maliyet ${ob.starter.firstJob.estCost}`;
});

let company = null;
await step("şirket: /company", async () => {
  company = must(await api("GET", "/company"), 200);
  return { cash: company.cash, facilities: company.facilities?.length };
});

await step("ilk iş: teklif ve başlatma (boşsa)", async () => {
  const f = company?.facilities?.find((x) => x.type === "field");
  if (!f) throw new Error("tarla bulunamadı");
  if (f.jobs?.some((j) => j.status === "running")) return "zaten çalışan iş var";
  const body = { facilityId: f.id, recipeId: "grow_fodder", batches: 1 };
  let q = must(await api("POST", "/production/quote", body), 200);
  // Doğrulama şirketi her çalıştırmada yeniden kullanılır: hediye tohum biterse eksik tohum pazardan (en ucuz ilan) alınır
  const miss = (q.blockers ?? []).find((b) => b.code === "INSUFFICIENT_STOCK" && b.productId === "seed");
  let bought = null;
  if (miss) {
    const mk = must(await api("GET", `/market?cityId=${f.cityId}&productId=seed`), 200);
    const l = (mk.listings ?? []).filter((x) => !x.mine && x.remainingKg >= miss.missingKg).sort((a, b) => Number(a.pricePerKg) - Number(b.pricePerKg))[0];
    if (!l) throw new Error(`tohum eksik (${miss.missingKg} kg) ve ${f.cityId} pazarında ilan yok`);
    must(await api("POST", `/market/listings/${l.id}/buy`, { qtyKg: miss.missingKg, expectedPricePerKg: Number(l.pricePerKg), idempotencyKey: key() }), 200, 201);
    bought = `${miss.missingKg} kg tohum alındı`;
    q = must(await api("POST", "/production/quote", body), 200);
  }
  const s = await api("POST", "/production/start", { ...body, repeat: false, idempotencyKey: key() });
  must(s, 200, 201);
  return { minutes: q.minutes, totalCost: q.totalCost ?? q.cost?.total, bought };
});

await step("v4 katalog: ürün, bina, reçete, araştırma sayıları ve örnekler", async () => {
  const w = must(await api("GET", "/world"), 200);
  const has = (list, id) => list.some((x) => x.id === id);
  const need = [["products", "compound_feed"], ["products", "workwear"], ["products", "shipping_packaging"], ["products", "maintenance_kit"],
    ["buildingTypes", "feed_mill"], ["buildingTypes", "garment_factory"], ["buildingTypes", "quarry"], ["recipes", "mix_compound_feed"],
    ["recipes", "milk_cows_compound"], ["research", "soil_science"]];
  for (const [k, id] of need) if (!has(w[k] ?? [], id)) throw new Error(`${k} içinde ${id} yok`);
  const counts = { products: w.products.length, buildingTypes: w.buildingTypes.length, recipes: w.recipes.length, research: w.research.length };
  if (counts.products < 200 || counts.buildingTypes < 45 || counts.recipes < 260 || counts.research < 60) throw new Error(`katalog sayıları eksik: ${JSON.stringify(counts)}`);
  return counts;
});

await step("v4 pazar: istatistik ve şehir karşılaştırması", async () => {
  const st = must(await api("GET", "/market/stats?productId=compound_feed&cityId=akyayla"), 200);
  const cmp = must(await api("GET", "/market/compare?productId=compound_feed&qtyKg=1000"), 200);
  return { refPrice: st.refPricePerKg, priceBasis: st.priceBasis, p2pShareBp: st.p2pShareBp, cities: cmp.rows?.length, bestCityId: cmp.bestCityId };
});

await step("harita: /world/map", async () => {
  const m = must(await api("GET", "/world/map"), 200);
  return { plots: m.plots?.length, vehicles: m.vehicles?.length };
});

const browser = await chromium.launch();
for (const [label, opts] of [["telefon", devices["iPhone 13"]], ["masaustu", { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }]]) {
  await step(`arayüz (${label}): giriş sayfası ve şehir`, async () => {
    const ctx = await browser.newContext({ ...opts, locale: "tr-TR" });
    const [name, value] = cookie.split("=");
    const host = new URL(BASE).hostname;
    if (name && value) await ctx.addCookies([{ name, value, domain: host, path: "/", httpOnly: true, secure: true, sameSite: "Lax" }]);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 60_000 });
    await page.screenshot({ path: `e2e/out/${label}-giris.png` });
    await page.goto(`${BASE}/play`, { waitUntil: "networkidle", timeout: 60_000 });
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `e2e/out/${label}-sehir.png` });
    const hasScene = await page.locator("canvas, [data-testid=map2d]").count();
    await ctx.close();
    if (errors.length) throw new Error(`sayfa hatası: ${errors[0]}`);
    if (!hasScene) throw new Error("şehir görünümü (canvas veya 2D harita) bulunamadı");
    return "şehir görünümü yüklendi";
  });
}
await browser.close();

writeFileSync("e2e/out/sonuc.json", JSON.stringify({ base: BASE, at: new Date().toISOString(), results }, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\n${failed.length} adım başarısız` : "\nTüm adımlar geçti");
process.exit(failed.length ? 1 : 0);
