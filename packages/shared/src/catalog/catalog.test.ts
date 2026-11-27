import { describe, expect, it } from "vitest";
import { refPrice, systemAsk, systemBid, systemBidCap, systemBidForQuality } from "../../../economy/src/index";
import {
  BUILDING_TYPES, CITIES, DEFAULT_SETTINGS, QUALITY_PRICE_BP, LEGACY_BUILDING_TYPES, LEGACY_PRODUCTS, LEGACY_RECIPES, LEGACY_RESEARCH, PLOTS, PRODUCTS,
  RECIPES, RESEARCH, SYSTEM_PROFILES, depositFits, generatePlots, profileBidBp,
} from "./index";

const productIds = new Set(PRODUCTS.map((p) => p.id));
const buildingIds = new Set(BUILDING_TYPES.map((b) => b.id));
const researchIds = new Set(RESEARCH.map((r) => r.id));
const buildingById = new Map(BUILDING_TYPES.map((b) => [b.id, b]));
const researchById = new Map(RESEARCH.map((r) => [r.id, r]));
const dups = (ids: string[]) => ids.filter((id, i) => ids.indexOf(id) !== i);

/** Reçetenin "varyantsız" imzası: bina + çıktı + girdi kümesi (miktar ve kalite varyantı sayılmaz). */
const signature = (r: (typeof RECIPES)[number]) =>
  `${r.buildingType}|${r.output.productId}|${r.inputs.map((i) => i.productId).sort().join("+")}`;

/** Sistem arzı: bir sistem profilinin sattığı ürünler. */
const systemSupply = new Set(SYSTEM_PROFILES.flatMap((p) => Object.keys(p.sells)));
const systemDemand = new Set(SYSTEM_PROFILES.flatMap((p) => Object.keys(p.buys)));

describe("katalog: sayısal hedefler", () => {
  it("ürün, bina, reçete, araştırma sayıları hedefin altında değil", () => {
    expect(PRODUCTS.length).toBeGreaterThanOrEqual(200);
    expect(BUILDING_TYPES.length).toBeGreaterThanOrEqual(45);
    expect(new Set(RECIPES.map(signature)).size).toBeGreaterThanOrEqual(260);
    expect(RESEARCH.length).toBeGreaterThanOrEqual(60);
  });
  it("aynı bina + çıktı + girdi kümesi tekrarı yok (varyant sayılmaz)", () => {
    const sigs = RECIPES.map(signature);
    expect(dups(sigs)).toEqual([]);
  });
});

describe("katalog: kimlikler benzersiz", () => {
  it("ürün", () => expect(dups(PRODUCTS.map((p) => p.id))).toEqual([]));
  it("bina", () => expect(dups(BUILDING_TYPES.map((b) => b.id))).toEqual([]));
  it("reçete", () => expect(dups(RECIPES.map((r) => r.id))).toEqual([]));
  it("araştırma", () => expect(dups(RESEARCH.map((r) => r.id))).toEqual([]));
  it("arsa", () => expect(dups(PLOTS.map((p) => p.id))).toEqual([]));
  it("eski tanımlar birleşik listede eksiksiz", () => {
    for (const p of LEGACY_PRODUCTS) expect(productIds.has(p.id), p.id).toBe(true);
    for (const b of LEGACY_BUILDING_TYPES) expect(buildingIds.has(b.id), b.id).toBe(true);
    for (const r of LEGACY_RECIPES) expect(RECIPES.some((x) => x.id === r.id), r.id).toBe(true);
    for (const r of LEGACY_RESEARCH) expect(researchIds.has(r.id), r.id).toBe(true);
  });
});

describe("katalog: reçete bütünlüğü", () => {
  it("girdi ve çıktı ürünleri ile bina türü vardır, miktarlar pozitif tam sayıdır", () => {
    const bad: string[] = [];
    for (const r of RECIPES) {
      if (!buildingIds.has(r.buildingType)) bad.push(`${r.id}: bina ${r.buildingType}`);
      if (!productIds.has(r.output.productId)) bad.push(`${r.id}: çıktı ${r.output.productId}`);
      for (const i of r.inputs) if (!productIds.has(i.productId)) bad.push(`${r.id}: girdi ${i.productId}`);
      for (const q of [r.output.kg, ...r.inputs.map((i) => i.kg)]) if (!Number.isInteger(q) || q <= 0) bad.push(`${r.id}: miktar ${q}`);
      for (const [k, v] of Object.entries({ minutes: r.minutes, laborHours: r.laborHours, energyKwh: r.energyKwh, waterM3: r.waterM3 }))
        if (!Number.isFinite(v) || v < 0) bad.push(`${r.id}: ${k}=${v}`);
      if (r.minBuildingLevel < 1 || r.minBuildingLevel > (buildingById.get(r.buildingType)?.levels.length ?? 0)) bad.push(`${r.id}: minBuildingLevel ${r.minBuildingLevel}`);
      if (r.inputs.some((i) => i.productId === r.output.productId)) bad.push(`${r.id}: çıktı kendi girdisi`);
      if (new Set(r.inputs.map((i) => i.productId)).size !== r.inputs.length) bad.push(`${r.id}: yinelenen girdi`);
    }
    expect(bad).toEqual([]);
  });

  it("her bina (garaj hariç) en az bir kilitsiz reçeteye sahip", () => {
    const missing = BUILDING_TYPES.filter((b) => b.id !== "garage")
      .filter((b) => !RECIPES.some((r) => r.buildingType === b.id && !r.research && r.minBuildingLevel === 1))
      .map((b) => b.id);
    expect(missing).toEqual([]);
  });

  it("maden/ocak reçetelerinin yatağı binanın yatak listesinde ve o yatakta en az bir arsa var", () => {
    const bad: string[] = [];
    for (const r of RECIPES.filter((x) => x.deposit)) {
      const bt = buildingById.get(r.buildingType)!;
      if (!bt.requiresDeposit) bad.push(`${r.id}: bina ${bt.id} yatak istemiyor ama reçete yatak istiyor`);
      if (!depositFits(bt, r.deposit)) bad.push(`${r.id}: ${r.deposit} ${bt.id} deposits listesinde yok`);
      if (!PLOTS.some((p) => p.deposit?.kind === r.deposit)) bad.push(`${r.id}: ${r.deposit} yataklı arsa yok`);
    }
    // yatak isteyen her bina için de en az bir uygun arsa bulunmalı
    for (const b of BUILDING_TYPES.filter((x) => x.requiresDeposit)) {
      if (!PLOTS.some((p) => depositFits(b, p.deposit?.kind))) bad.push(`bina ${b.id}: uygun arsa yok`);
      for (const r of RECIPES.filter((x) => x.buildingType === b.id)) if (!r.deposit) bad.push(`${r.id}: yataklı binada deposit alanı yok`);
    }
    expect(bad).toEqual([]);
  });
});

describe("katalog: zincir bütünlüğü", () => {
  it("her ürünün bir üreticisi (reçete çıktısı ya da sistem arzı) var", () => {
    const noProducer = PRODUCTS.filter((p) => !RECIPES.some((r) => r.output.productId === p.id)).map((p) => p.id);
    // reçetesiz ürün yalnızca sistem arzıyla (ham girdi) var olabilir
    expect(noProducer.filter((id) => !systemSupply.has(id))).toEqual([]);
  });
  it("her ürünün reçete çıktısı olarak üreticisi var (sistem arzı tek başına yetmez, eski 'iron_ore' gibi madenler dahil)", () => {
    const noRecipe = PRODUCTS.filter((p) => !RECIPES.some((r) => r.output.productId === p.id)).map((p) => p.id);
    expect(noRecipe).toEqual([]);
  });
  it("her ürünün gerçek bir tüketim noktası var (başka reçetede girdi ya da sistem alıcısı)", () => {
    const used = new Set(RECIPES.flatMap((r) => r.inputs.map((i) => i.productId)));
    const orphan = PRODUCTS.filter((p) => !used.has(p.id) && !systemDemand.has(p.id)).map((p) => p.id);
    expect(orphan).toEqual([]);
  });
  it("sistem profilleri yalnızca var olan ürün ve şehirleri anar; companyKey benzersiz", () => {
    const cityIds = new Set(CITIES.map((c) => c.id));
    const bad: string[] = [];
    for (const p of SYSTEM_PROFILES) {
      if (!cityIds.has(p.cityId)) bad.push(`${p.companyKey}: şehir ${p.cityId}`);
      for (const [pid, kg] of [...Object.entries(p.buys), ...Object.entries(p.sells)]) {
        if (!productIds.has(pid)) bad.push(`${p.companyKey}: ürün ${pid}`);
        if (!Number.isInteger(kg) || kg <= 0) bad.push(`${p.companyKey}: ${pid} kg ${kg}`);
      }
      if (!Number.isInteger(p.dailyBudget) || p.dailyBudget <= 0) bad.push(`${p.companyKey}: bütçe`);
    }
    expect(bad).toEqual([]);
    expect(dups(SYSTEM_PROFILES.map((p) => p.companyKey))).toEqual([]);
  });
  it("her girdi kilitsiz bir zincirle erişilebilir (sistem arzı ya da girdisiz reçete kökleri)", () => {
    const have = new Set<string>(systemSupply);
    const free = RECIPES.filter((r) => !r.research);
    for (let changed = true; changed; ) {
      changed = false;
      for (const r of free) {
        if (!have.has(r.output.productId) && r.inputs.every((i) => have.has(i.productId))) { have.add(r.output.productId); changed = true; }
      }
    }
    const allInputs = new Set(RECIPES.flatMap((r) => r.inputs.map((i) => i.productId)));
    expect([...allInputs].filter((id) => !have.has(id))).toEqual([]);
    // sonuç ürünler de (kilitsiz) üretilebilir
    expect(PRODUCTS.filter((p) => !have.has(p.id)).map((p) => p.id)).toEqual([]);
  });
});

describe("katalog: araştırma", () => {
  it("önkoşullar var olan araştırmaya ve geçerli seviyeye işaret eder", () => {
    const bad: string[] = [];
    for (const r of RESEARCH) {
      for (const p of r.prerequisites ?? []) {
        const t = researchById.get(p.researchId);
        if (!t) bad.push(`${r.id}: önkoşul ${p.researchId} yok`);
        else if (p.level < 1 || p.level > t.maxLevel) bad.push(`${r.id}: ${p.researchId} seviye ${p.level} > max ${t.maxLevel}`);
        if (p.researchId === r.id) bad.push(`${r.id}: kendi önkoşulu`);
      }
    }
    expect(bad).toEqual([]);
  });
  it("önkoşul grafında döngü yok ve hiçbir araştırma kendi (dolaylı) önkoşulunun önkoşulu değil", () => {
    const closure = (id: string, seen = new Set<string>()): Set<string> => {
      for (const p of researchById.get(id)?.prerequisites ?? []) if (!seen.has(p.researchId)) { seen.add(p.researchId); closure(p.researchId, seen); }
      return seen;
    };
    const cyc = RESEARCH.filter((r) => closure(r.id).has(r.id)).map((r) => r.id);
    expect(cyc).toEqual([]);
  });
  it("bütün araştırmalar önkoşul zinciriyle köklerden başlatılabilir (topolojik sıra)", () => {
    const done = new Set<string>();
    for (let changed = true; changed; ) {
      changed = false;
      for (const r of RESEARCH) if (!done.has(r.id) && (r.prerequisites ?? []).every((p) => done.has(p.researchId))) { done.add(r.id); changed = true; }
    }
    expect(RESEARCH.filter((r) => !done.has(r.id)).map((r) => r.id)).toEqual([]);
  });
  it("unlock etkisinin recipeIds'i ile RecipeDef.research iki yönlü tutarlı", () => {
    const bad: string[] = [];
    const recipeById = new Map(RECIPES.map((r) => [r.id, r]));
    for (const r of RESEARCH) {
      if (r.effect.kind !== "unlock") continue;
      for (const rid of r.effect.recipeIds) {
        const rec = recipeById.get(rid);
        if (!rec) bad.push(`${r.id}: reçete ${rid} yok`);
        else if (rec.research?.researchId !== r.id) bad.push(`${r.id} -> ${rid}: reçetenin research alanı ${rec.research?.researchId ?? "yok"}`);
      }
    }
    for (const rec of RECIPES.filter((x) => x.research)) {
      const rs = researchById.get(rec.research!.researchId);
      if (!rs) { bad.push(`${rec.id}: araştırma ${rec.research!.researchId} yok`); continue; }
      if (rec.research!.level < 1 || rec.research!.level > rs.maxLevel) bad.push(`${rec.id}: seviye ${rec.research!.level}`);
      if (rs.effect.kind !== "unlock" || !rs.effect.recipeIds.includes(rec.id)) bad.push(`${rec.id}: ${rs.id} unlock listesinde değil`);
    }
    expect(bad).toEqual([]);
  });
  it("bina türüne özgü etkilerdeki buildingTypes var olan binalardır", () => {
    const bad: string[] = [];
    for (const r of RESEARCH) {
      const e = r.effect;
      if ("buildingTypes" in e) {
        if (e.buildingTypes.length === 0) bad.push(`${r.id}: boş buildingTypes`);
        for (const b of e.buildingTypes) if (!buildingIds.has(b)) bad.push(`${r.id}: bina ${b}`);
      }
      if ("bpPerLevel" in e && (!Number.isInteger(e.bpPerLevel) || e.bpPerLevel <= 0)) bad.push(`${r.id}: bpPerLevel`);
      if (!Number.isInteger(r.baseCost) || r.baseCost <= 0 || r.baseMinutes <= 0 || r.maxLevel < 1) bad.push(`${r.id}: maliyet/süre/seviye`);
    }
    expect(bad).toEqual([]);
  });
});

describe("katalog: metinler (TR + EN)", () => {
  const nonEmpty = (s: string | undefined) => typeof s === "string" && s.trim().length > 0;
  const check = (label: string, items: Array<{ id: string; name: { tr: string; en: string } }>) =>
    it(`${label}: TR ve EN adı dolu`, () => {
      expect(items.filter((x) => !nonEmpty(x.name?.tr) || !nonEmpty(x.name?.en)).map((x) => x.id)).toEqual([]);
    });
  check("ürün", PRODUCTS);
  check("bina", BUILDING_TYPES);
  check("reçete", RECIPES);
  check("araştırma", RESEARCH);
  it("araştırma açıklamaları TR ve EN dolu", () => {
    expect(RESEARCH.filter((r) => !nonEmpty(r.description?.tr) || !nonEmpty(r.description?.en)).map((r) => r.id)).toEqual([]);
  });
  it("yeni (v4) ürün, bina, reçete ve araştırma adlarında TR ile EN farklı (çevrilmemiş kopya yok)", () => {
    const legacyIds = new Set([...LEGACY_PRODUCTS, ...LEGACY_BUILDING_TYPES, ...LEGACY_RECIPES, ...LEGACY_RESEARCH].map((x) => x.id));
    // Özel adlar ve ortak yazımlı kısa adlar (ör. "Tuz"/"Salt" farklı; "Pompa"/"Pump" farklı). Aynı olanlar listelenir.
    const COGNATES = new Set(["bulgur", "malt"]); // TR ve EN'de aynı yazılan sözcükler
    const same = [...PRODUCTS, ...BUILDING_TYPES, ...RECIPES, ...RESEARCH]
      .filter((x) => !legacyIds.has(x.id) && !COGNATES.has(x.id) && x.name.tr.trim().toLowerCase() === x.name.en.trim().toLowerCase())
      .map((x) => `${x.id}:${x.name.tr}`);
    expect(same).toEqual([]);
  });
  it("ürün, bina, iş kolu ve katman alanları dolu; fiyat tam sayı > 0", () => {
    const bad: string[] = [];
    for (const p of PRODUCTS) {
      if (!p.industry) bad.push(`${p.id}: industry`);
      if (!p.stage) bad.push(`${p.id}: stage`);
      if (!Number.isInteger(p.basePricePerKg) || p.basePricePerKg <= 0) bad.push(`${p.id}: fiyat ${p.basePricePerKg}`);
    }
    for (const b of BUILDING_TYPES) {
      if (!b.industry || !b.archetype) bad.push(`${b.id}: industry/archetype`);
      if (b.levels.length < 1) bad.push(`${b.id}: seviye yok`);
    }
    expect(bad).toEqual([]);
  });
});

describe("katalog: sistem fiyatlarında arbitraj yok", () => {
  const cityBp = (cityId: string, pid: string) => CITIES.find((c) => c.id === cityId)!.priceBp[pid] ?? 10000;
  const sys = DEFAULT_SETTINGS.system;
  const B = 1_000_000; // doygunluksuz: dailyKg büyük, doldurulan 0

  // Tasarım (systemBidForQuality, H1): cap kalite 2 tabanına uygulanır, sonra kalite çarpanı gelir. Cap bağlayınca kalite 5 alışı
  // 0,8 × 1,25 = 1,0 × en düşük satış olur: kâr SIFIR (tam eşit). Sistem yalnızca kalite 2 sattığı için bu arbitraj değildir.
  // Bu yüzden kalite 2 için katı küçüklük, kalite 5 için "kâr yok" (<=) denetlenir.
  it("her ürün için en yüksek sistem alışı en düşük sistem satışından düşük; kalite 5 dahil kâr sıfırdan büyük değil", () => {
    const bad: string[] = [];
    for (const p of PRODUCTS) {
      const refs = CITIES.map((c) => refPrice(p.basePricePerKg, cityBp(c.id, p.id), 10000));
      const cap = systemBidCap(refs.map((r) => systemAsk(r, sys.askBp, 0, 1)).reduce((a, b) => (a < b ? a : b)));
      // sistem satışı yalnızca sat profilinde olan şehirlerde; en düşük satış tüm şehirlerdeki taban ask'tır (cap ile aynı kural)
      const asks = SYSTEM_PROFILES.filter((s) => s.sells[p.id]).map((s) => {
        const ref = refPrice(p.basePricePerKg, cityBp(s.cityId, p.id), 10000);
        return systemAsk(ref, sys.askBp, 0, 1);
      });
      if (asks.length === 0) continue;
      const minAsk = asks.reduce((a, b) => (a < b ? a : b));
      let maxBid = 0n;
      let maxBid2 = 0n;
      for (const s of SYSTEM_PROFILES.filter((x) => x.buys[p.id])) {
        const ref = refPrice(p.basePricePerKg, cityBp(s.cityId, p.id), 10000);
        const bid = systemBid(ref, profileBidBp(s, p.id, sys.bidBp), 0, B, cap);
        const q5 = systemBidForQuality(bid, 5, cap, QUALITY_PRICE_BP);
        if (q5 > maxBid) maxBid = q5;
        if (bid > maxBid2) maxBid2 = bid;
      }
      if (maxBid2 >= minAsk) bad.push(`${p.id}: maxBid(q2)=${maxBid2} >= minAsk=${minAsk}`);
      if (maxBid > minAsk) bad.push(`${p.id}: maxBid(q5)=${maxBid} > minAsk=${minAsk}`);
    }
    expect(bad).toEqual([]);
  });

  it("kalite 2 sistem alışı hiçbir üründe herhangi bir sistem satışının %80'ini aşmaz (cap)", () => {
    const bad: string[] = [];
    for (const p of PRODUCTS) {
      const refs = CITIES.map((c) => refPrice(p.basePricePerKg, cityBp(c.id, p.id), 10000));
      const minAsk = refs.map((r) => systemAsk(r, sys.askBp, 0, 1)).reduce((a, b) => (a < b ? a : b));
      const cap = systemBidCap(minAsk);
      for (const s of SYSTEM_PROFILES.filter((x) => x.buys[p.id])) {
        const bid = systemBid(refPrice(p.basePricePerKg, cityBp(s.cityId, p.id), 10000), profileBidBp(s, p.id, sys.bidBp), 0, B, cap);
        if (bid > cap) bad.push(`${p.id}@${s.companyKey}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("katalog: mevcut arsalar değişmemiş", () => {
  const SNAPSHOT = [
    "korfezkent-00,0,0,5050000,-",
    "korfezkent-10,1,0,2350000,-",
    "korfezkent-20,2,0,2650000,-",
    "korfezkent-30,3,0,4650000,-",
    "korfezkent-01,0,1,2550000,-",
    "korfezkent-11,1,1,4500000,-",
    "korfezkent-21,2,1,8200000,-",
    "korfezkent-31,3,1,2700000,-",
    "korfezkent-02,0,2,2800000,-",
    "korfezkent-12,1,2,4850000,-",
    "korfezkent-22,2,2,7650000,-",
    "korfezkent-32,3,2,2550000,-",
    "korfezkent-03,0,3,4900000,-",
    "korfezkent-13,1,3,2350000,-",
    "korfezkent-23,2,3,2700000,-",
    "korfezkent-33,3,3,4700000,-",
    "yesilova-00,0,0,2850000,-",
    "yesilova-10,1,0,1700000,-",
    "yesilova-20,2,0,1500000,-",
    "yesilova-30,3,0,3000000,-",
    "yesilova-01,0,1,1800000,-",
    "yesilova-11,1,1,3000000,-",
    "yesilova-21,2,1,4950000,-",
    "yesilova-31,3,1,1550000,-",
    "yesilova-02,0,2,1700000,-",
    "yesilova-12,1,2,2700000,-",
    "yesilova-22,2,2,4400000,-",
    "yesilova-32,3,2,1650000,-",
    "yesilova-03,0,3,3150000,-",
    "yesilova-13,1,3,1550000,-",
    "yesilova-23,2,3,1750000,-",
    "yesilova-33,3,3,2800000,-",
    "akyayla-00,0,0,3200000,-",
    "akyayla-10,1,0,2700000,iron:9000",
    "akyayla-20,2,0,1750000,-",
    "akyayla-30,3,0,3050000,-",
    "akyayla-01,0,1,1700000,-",
    "akyayla-11,1,1,3250000,-",
    "akyayla-21,2,1,4700000,-",
    "akyayla-31,3,1,1550000,-",
    "akyayla-02,0,2,1750000,-",
    "akyayla-12,1,2,3200000,-",
    "akyayla-22,2,2,5550000,-",
    "akyayla-32,3,2,1500000,-",
    "akyayla-03,0,3,3000000,-",
    "akyayla-13,1,3,2600000,iron:9500",
    "akyayla-23,2,3,1700000,-",
    "akyayla-33,3,3,3300000,-",
    "demirdag-00,0,0,3900000,iron:10000",
    "demirdag-10,1,0,2550000,coal:10000",
    "demirdag-20,2,0,2600000,iron:10500",
    "demirdag-30,3,0,3800000,coal:9500",
    "demirdag-01,0,1,2550000,coal:10500",
    "demirdag-11,1,1,4300000,iron:12500",
    "demirdag-21,2,1,4950000,-",
    "demirdag-31,3,1,2500000,iron:9500",
    "demirdag-02,0,2,1650000,-",
    "demirdag-12,1,2,3150000,-",
    "demirdag-22,2,2,6400000,coal:12500",
    "demirdag-32,3,2,1650000,-",
    "demirdag-03,0,3,3150000,-",
    "demirdag-13,1,3,1750000,-",
    "demirdag-23,2,3,1700000,-",
    "demirdag-33,3,3,3150000,-",
    "kavsak-00,0,0,3550000,-",
    "kavsak-10,1,0,1850000,-",
    "kavsak-20,2,0,1850000,-",
    "kavsak-30,3,0,3150000,-",
    "kavsak-01,0,1,1850000,-",
    "kavsak-11,1,1,3350000,-",
    "kavsak-21,2,1,5700000,-",
    "kavsak-31,3,1,2150000,-",
    "kavsak-02,0,2,2850000,coal:9000",
    "kavsak-12,1,2,3750000,-",
    "kavsak-22,2,2,5850000,-",
    "kavsak-32,3,2,2000000,-",
    "kavsak-03,0,3,3600000,-",
    "kavsak-13,1,3,1850000,-",
    "kavsak-23,2,3,2800000,coal:9500",
    "kavsak-33,3,3,3450000,-",  ];
  it("ilk 80 arsanın kimlik, koordinat, fiyat ve yatağı sabit değerlerle eşleşir", () => {
    const actual = generatePlots().slice(0, 80).map((p) => `${p.id},${p.gx},${p.gz},${p.price},${p.deposit ? `${p.deposit.kind}:${p.deposit.richnessBp}` : "-"}`);
    expect(actual).toEqual(SNAPSHOT);
  });
  it("birleşik PLOTS listesi ilk 80 arsayı aynı sırada korur; yeni 100 halka arsası eklenmiştir", () => {
    expect(PLOTS.length).toBe(180);
    expect(PLOTS.slice(0, 80).map((p) => p.id)).toEqual(generatePlots().map((p) => p.id));
    expect(PLOTS.slice(80).every((p) => p.id.includes("-o"))).toBe(true);
  });
  it("halka arsalarının fiyatı ve alanları geçerli tam sayı", () => {
    for (const p of PLOTS) {
      expect(Number.isInteger(p.price) && p.price > 0, p.id).toBe(true);
      expect(p.minLevel >= 1, p.id).toBe(true);
    }
  });
});
