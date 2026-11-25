/**
 * Oyun testi için yerel dünya kurar (yalnızca test ortamı, ALLOW_TIME_TRAVEL=1).
 * Yeni şirket + çok tesisli, sevkiyatlı, ilanlı, sözleşmeli yerleşik şirketler.
 * Çıktı: e2e/ui/out/playtest-accounts.json (kullanıcı adları)
 */
import { Admin, Api, PASSWORD, ROOT, companyName, register, saveJson, sleep } from "./lib.mjs";

const admin = await Admin.getOrCreate();
const out = {};
async function found(prefix, sector, cityId, extra = {}, name) {
  const { api, username } = await register(extra.locale ?? "tr", prefix);
  const q = { cityId, sector, ...(extra.starterBuilding ? { starterBuilding: extra.starterBuilding } : {}) };
  const onb = await api.get("/world/onboarding", q);
  const plot = onb.plots.filter((p) => p.eligible).sort((a, b) => Number(a.price) - Number(b.price))[0];
  await api.post("/company", { name: name ?? companyName(prefix), cityId, sector, plotId: plot.id, ...(extra.starterBuilding ? { starterBuilding: extra.starterBuilding } : {}) });
  const c = await api.get("/company");
  out[prefix] = { username, companyId: c.id, sector, cityId };
  return { api, c };
}
const start = async (api, fac, recipeId, batches = 1, repeat = false) => {
  const q = await api.post("/production/quote", { facilityId: fac.id, recipeId, batches });
  if (!q.canStart) { console.log("başlatılamaz", recipeId, JSON.stringify(q.blockers)); return null; }
  return api.post("/production/start", { facilityId: fac.id, recipeId, batches, repeat });
};
const sellAllToSystem = async (api, productId, cityId) => {
  const inv = await api.get("/inventory");
  const h = inv.find((x) => x.productId === productId && x.cityId === cityId && x.availableKg > 0);
  if (!h) return;
  const m = await api.get("/market", { cityId, productId });
  const o = m.orders.filter((x) => !x.mine && x.quality <= h.quality).sort((a, b) => Number(b.pricePerKg) - Number(a.pricePerKg))[0];
  if (!o) { console.log("alıcı yok", productId, cityId); return; }
  const qty = Math.min(h.availableKg, o.remainingKg);
  await api.post(`/market/orders/${o.id}/sell`, { qtyKg: qty, quality: h.quality, expectedPricePerKg: Number(o.pricePerKg) });
};

// Yeni şirket (yalnızca kuruluş)
await found("ptnew", "manufacturing", "korfezkent", { starterBuilding: "food_plant" });

// Yerleşik çiftçi (uzun ad), yerleşik hayvancı, madenci, taşımacı, imalatçı
const farm = await found("ptfarm", "crop", "yesilova", {}, "Yeşilova Büyük Tarım ve Hayvancılık Kooperatifi A.Ş.".slice(0, 40));
const dairy = await found("ptdairy", "livestock", "akyayla");
const mine = await found("ptmine", "mining", "demirdag");
const haul = await found("pthaul", "freight", "kavsak");
const fab = await found("ptfab", "manufacturing", "korfezkent", { starterBuilding: "food_plant", locale: "en" });

for (const [k, x] of Object.entries({ farm, dairy, mine, fab })) {
  const f = x.c.facilities[0];
  const r = f.recipes[0];
  await start(x.api, f, r, 1);
}
await admin.advance(130);
await sleep(1500);
await sellAllToSystem(farm.api, "fodder", "yesilova");
await sellAllToSystem(dairy.api, "raw_milk", "akyayla");
await sellAllToSystem(mine.api, "iron_ore", "demirdag");
await sellAllToSystem(fab.api, "flour", "korfezkent");

// Çiftçi tohum alır, tahıl eker, ikinci tarla alır
const buyFromSystem = async (api, productId, cityId, kg) => {
  const m = await api.get("/market", { cityId, productId });
  const l = m.listings.filter((x) => !x.mine).sort((a, b) => Number(a.pricePerKg) - Number(b.pricePerKg))[0];
  if (!l) return console.log("satıcı yok", productId, cityId);
  await api.post(`/market/listings/${l.id}/buy`, { qtyKg: Math.min(kg, l.remainingKg), expectedPricePerKg: Number(l.pricePerKg) });
};
await buyFromSystem(farm.api, "seed", "yesilova", 900);
let fc = await farm.api.get("/company");
await start(farm.api, fc.facilities[0], "grow_grain", 2, false);
await buyFromSystem(dairy.api, "fodder", "akyayla", 2400);
let dc = await dairy.api.get("/company");
await start(dairy.api, dc.facilities[0], "milk_cows", 2, true);
let mc = await mine.api.get("/company");
await start(mine.api, mc.facilities[0], mc.facilities[0].recipes[0], 2, true);
await buyFromSystem(fab.api, "grain", "korfezkent", 4000);
let fbc = await fab.api.get("/company");
await start(fab.api, fbc.facilities[0], "mill_flour", 2, false);

// İkinci tesis: çiftçi ikinci tarla (bütçe yeterse)
try {
  const plots = await farm.api.get("/world/plots", { cityId: "yesilova" });
  const free = (plots.plots ?? plots).filter((p) => !p.owner).sort((a, b) => Number(a.price) - Number(b.price))[0];
  if (free) await farm.api.post(`/plots/${free.id}/buy`, { buildingType: "field" });
} catch (e) { console.log("ikinci tarla:", e.message.slice(0, 160)); }

// İlanlar: madenci kömür/cevher satışa koyar (Körfezkent'e bakmak için Demirdağ'da)
await admin.advance(240);
await sleep(1500);
const inv = await mine.api.get("/inventory");
for (const h of inv.filter((x) => x.availableKg > 1000)) {
  await mine.api.post("/market/listings", { cityId: h.cityId, productId: h.productId, quality: h.quality, qtyKg: Math.floor(h.availableKg / 2), pricePerKg: 175 });
}
const finv = await farm.api.get("/inventory");
for (const h of finv.filter((x) => x.productId === "grain" && x.availableKg > 500)) {
  await farm.api.post("/market/listings", { cityId: h.cityId, productId: "grain", quality: h.quality, qtyKg: Math.floor(h.availableKg / 2), pricePerKg: 480 });
}

// Sözleşme: çiftçi → imalatçı tahıl, Körfezkent teslim, satıcı navlun öder
const firstDue = new Date(Date.parse((await admin.api.get("/auth/me")).serverTime) + 20 * 3600e3).toISOString();
const prop = await farm.api.post("/contracts", { role: "seller", counterpartyCompanyId: out.ptfab.companyId, productId: "grain", minQuality: 1, qtyPerInstallmentKg: 1000, pricePerKg: 560, deliveryCityId: "korfezkent", freightPayer: "seller", installments: 4, firstDueAt: firstDue, intervalHours: 24, graceHours: 2, penaltyBp: 1000, expiresInHours: 48 });
const cid = prop.contract?.id ?? prop.id;
await fab.api.post(`/contracts/${cid}/accept`, {});
// İkinci teklif (bekleyen)
await dairy.api.post("/contracts", { role: "seller", counterpartyCompanyId: out.ptfab.companyId, productId: "raw_milk", minQuality: 1, qtyPerInstallmentKg: 800, pricePerKg: 900, deliveryCityId: "korfezkent", freightPayer: "buyer", installments: 6, firstDueAt: firstDue, intervalHours: 24, graceHours: 2, penaltyBp: 1500, expiresInHours: 48 });

// Taşımacı: sistem işi üstlenir, kamyonet alır
const board = await haul.api.get("/freight-jobs", { scope: "board" });
const hc = await haul.api.get("/company");
const veh = hc.vehicles[0];
const job = board.filter((j) => j.originCityId === veh.cityId && j.status === "open")[0];
if (job) await haul.api.post(`/freight-jobs/${job.id}/accept`, { vehicleId: veh.id });
try { await haul.api.post("/fleet/buy", { modelId: "van", cityId: "kavsak" }); } catch (e) { console.log("araç:", e.message.slice(0, 120)); }

// Çiftçi kendi tahılını Körfezkent'e taşıma işi ilan eder
try {
  const g = (await farm.api.get("/inventory")).find((x) => x.productId === "grain" && x.availableKg >= 800);
  if (g) await farm.api.post("/freight-jobs", { originCityId: g.cityId, destCityId: "korfezkent", cargo: [{ productId: "grain", quality: g.quality, qtyKg: 800 }], payAmount: 400000, deadlineHours: 24, allowSystemCarrier: true });
} catch (e) { console.log("taşıma işi:", e.message.slice(0, 160)); }

saveJson(`${ROOT}/e2e/ui/out/playtest-accounts.json`, out);
console.log(JSON.stringify(out, null, 1));
