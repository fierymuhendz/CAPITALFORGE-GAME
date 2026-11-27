/**
 * v4 bina türleri: her biri kendine ait reçetelerle bir üretim kararını değiştirir.
 * Seviye eğrisi mevcut fabrika binalarıyla aynı biçimdedir (3 seviye, 2. ve 3. seviyede verim/verimlilik/girdi tasarrufu).
 */
import type { BuildingArchetype, BuildingTypeDef, Industry, Localized, Sector } from "./types";

interface Spec {
  id: string;
  sector: Sector;
  industry: Industry;
  archetype: BuildingArchetype;
  tier: 1 | 2 | 3;
  minCompanyLevel: number;
  name: Localized;
  description: Localized;
  /** ₺ cinsinden inşaat maliyeti (kuruşa çevrilir) */
  costTl: number;
  steelKg: number;
  deposits?: BuildingTypeDef["deposits"];
}

const S = (
  id: string, sector: Sector, industry: Industry, archetype: BuildingArchetype, tier: 1 | 2 | 3, minCompanyLevel: number,
  tr: string, en: string, dtr: string, den: string, costTl: number, steelKg: number, deposits?: BuildingTypeDef["deposits"],
): Spec => ({ id, sector, industry, archetype, tier, minCompanyLevel, name: { tr, en }, description: { tr: dtr, en: den }, costTl, steelKg, ...(deposits ? { deposits } : {}) });

const SPECS: Spec[] = [
  // tarım
  S("orchard", "crop", "field_crops", "orchard", 1, 1, "Meyve bahçesi", "Orchard", "Gübreyle elma, üzüm, fındık ve zeytin hasadı; tarladan yavaş ama değerli.", "Harvest apples, grapes, hazelnuts and olives with fertilizer; slower than a field but valuable.", 80_000, 1200),
  S("greenhouse", "crop", "field_crops", "greenhouse", 1, 2, "Sera", "Greenhouse", "Enerji harcayıp tohum ve gübreden taze sebze yetiştirir.", "Spend energy to grow fresh vegetables from seed and fertilizer.", 110_000, 2500),
  S("fiber_farm", "crop", "field_crops", "field", 1, 1, "Lif tarlası", "Fiber farm", "Pamuk, keten ve şerbetçiotu: tekstil ve içecek zincirinin başı.", "Cotton, flax and hops: the start of textile and brewing chains.", 70_000, 1000),
  S("forest_plantation", "crop", "forestry", "forest", 1, 1, "Orman işletmesi", "Forest plantation", "Fidanla tomruk ve reçine üretir; ormancılık zincirinin kaynağı.", "Grows logs and resin from saplings; the source of the forestry chain.", 70_000, 800),
  // hayvancılık
  S("poultry_farm", "livestock", "livestock", "barn", 1, 1, "Kümes", "Poultry farm", "Kanatlı yemiyle yumurta ve canlı piliç.", "Eggs and broilers from poultry feed.", 90_000, 1800),
  S("sheep_farm", "livestock", "livestock", "barn", 1, 2, "Ağıl", "Sheep farm", "Kuru otla yapağı, koyun sütü ve kuzu.", "Wool, sheep milk and lambs from hay.", 95_000, 1800),
  S("cattle_ranch", "livestock", "livestock", "barn", 1, 2, "Besi çiftliği", "Cattle ranch", "Besi yemi ya da silajla besi sığırı.", "Beef cattle from finishing feed or silage.", 130_000, 2500),
  S("apiary", "livestock", "livestock", "orchard", 1, 2, "Arılık", "Apiary", "Şekerle beslenen kovanlardan bal ve balmumu.", "Honey and beeswax from sugar-fed hives.", 60_000, 600),
  // yem ve gıda
  S("feed_mill", "manufacturing", "feed", "mill", 1, 1, "Yem fabrikası", "Feed mill", "Arpa ve mısırı karma yeme, mısırı silaja çevirir; hayvancılığın tedarikçisi.", "Turns barley and corn into compound feed and silage; supplies livestock farms.", 120_000, 3000),
  S("oil_press", "manufacturing", "dairy_food", "mill", 1, 2, "Yağ fabrikası", "Oil press", "Yağlı tohumlardan sıvı yağ ve yem küspesi.", "Vegetable oil and feed meal from oilseeds.", 130_000, 3000),
  S("dairy_plant", "manufacturing", "dairy_food", "factory", 2, 2, "Mandıra", "Dairy plant", "Sütü tereyağı, yoğurt, krema, kaşar ve dondurmaya işler.", "Processes milk into butter, yogurt, cream, kashar and ice cream.", 160_000, 4000),
  S("bakery", "manufacturing", "dairy_food", "factory", 2, 2, "Fırın", "Bakery", "Un, maya ve şekerden ekmek ve bisküvi.", "Bread and biscuits from flour, yeast and sugar.", 110_000, 2500),
  S("slaughterhouse", "manufacturing", "dairy_food", "factory", 2, 2, "Et kombinası", "Meat plant", "Canlı hayvandan et, deri ve iç yağı; tabakhaneye ve kimyaya girdi.", "Meat, hides and tallow from livestock; feeds tanneries and chemicals.", 170_000, 4500),
  S("sugar_refinery", "manufacturing", "dairy_food", "mill", 2, 3, "Şeker fabrikası", "Sugar refinery", "Pancardan şeker, melas ve yemlik posa.", "Sugar, molasses and feed pulp from beets.", 180_000, 5000),
  S("cannery", "manufacturing", "dairy_food", "factory", 2, 3, "Konserve fabrikası", "Cannery", "Sebze ve meyveyi teneke ve kavanozla raf ürününe çevirir.", "Turns produce into shelf goods using tins and jars.", 170_000, 4500),
  S("beverage_plant", "manufacturing", "dairy_food", "factory", 3, 4, "İçecek fabrikası", "Beverage plant", "Malt, meyve ve cam şişeden bira ve meyve suyu.", "Beer and juice from malt, fruit and glass bottles.", 220_000, 6000),
  // tekstil
  S("spinning_mill", "manufacturing", "textile", "factory", 2, 2, "İplik fabrikası", "Spinning mill", "Pamuğu çırçırlar, pamuk, yün ve keten ipliği eğirir.", "Gins cotton and spins cotton, wool and linen yarn.", 150_000, 4000),
  S("weaving_mill", "manufacturing", "textile", "factory", 2, 3, "Dokuma fabrikası", "Weaving mill", "İplikten kumaş, kot, kanvas, keçe ve çuval.", "Fabric, denim, canvas, felt and sacks from yarn.", 180_000, 5000),
  S("tannery", "manufacturing", "textile", "factory", 2, 3, "Tabakhane", "Tannery", "Ham deriyi tuz ve kimyasalla işlenmiş deriye çevirir.", "Turns raw hides into leather with salt and chemicals.", 140_000, 3500),
  S("garment_factory", "manufacturing", "textile", "factory", 3, 4, "Konfeksiyon atölyesi", "Garment factory", "Kumaş ve deriden iş kıyafeti, eldiven, bot ve giyim.", "Workwear, gloves, boots and clothing from fabric and leather.", 200_000, 4500),
  // ormancılık ve kâğıt
  S("sawmill", "manufacturing", "forestry", "workshop", 1, 1, "Hızar", "Sawmill", "Tomruktan kereste, kiriş, yonga ve talaş.", "Lumber, beams, chips and sawdust from logs.", 100_000, 2500),
  S("wood_workshop", "manufacturing", "forestry", "workshop", 2, 2, "Ahşap atölyesi", "Woodworking shop", "Palet, kasa, kontrplak, kapı, pencere ve mobilya.", "Pallets, crates, plywood, doors, windows and furniture.", 130_000, 3000),
  S("paper_mill", "manufacturing", "forestry", "mill", 2, 3, "Kâğıt fabrikası", "Paper mill", "Yonga ya da atık kartondan hamur, kâğıt ve kraft.", "Pulp, paper and kraft from chips or waste board.", 200_000, 6000),
  // ambalaj
  S("packaging_plant", "manufacturing", "packaging", "warehouse", 3, 4, "Ambalaj fabrikası", "Packaging plant", "Mukavva, koli, torba, kutu, etiket ve sevkiyat ambalajı.", "Board, boxes, bags, cans, labels and shipping packaging.", 190_000, 5000),
  // maden ve metal
  S("quarry", "mining", "mining_metal", "quarry", 1, 1, "Taş ocağı", "Quarry", "Kireçtaşı, kil, kum, mıcır ve tuz yatağı işletir.", "Works limestone, clay, sand, gravel and salt deposits.", 90_000, 2000, ["limestone", "clay", "sand", "salt"]),
  S("coke_plant", "manufacturing", "mining_metal", "kiln", 2, 2, "Kok fabrikası", "Coke plant", "Kömürden kok ve katran; çelik ve kimyaya yakıt.", "Coke and tar from coal; fuel for steel and chemicals.", 150_000, 5000),
  S("smelter", "manufacturing", "mining_metal", "kiln", 2, 2, "İzabe tesisi", "Smelter", "Kok ile bakır katot ve pik demir.", "Copper cathode and pig iron with coke.", 170_000, 6000),
  S("rolling_mill", "manufacturing", "mining_metal", "factory", 2, 3, "Haddehane", "Rolling mill", "Çelikten sac, inşaat demiri, filmaşin, tel, boru ve profil.", "Sheet, rebar, wire rod, wire, pipe and beams from steel.", 200_000, 7000),
  S("foundry", "manufacturing", "mining_metal", "kiln", 3, 4, "Döküm atölyesi", "Foundry", "Pik demir ve kumdan dökme parça; filmaşinden cıvata.", "Iron castings from pig iron and sand; fasteners from wire rod.", 170_000, 5000),
  // cam ve seramik
  S("glassworks", "manufacturing", "glass_ceramic", "kiln", 2, 3, "Cam fabrikası", "Glassworks", "Kum, soda ve kireçtaşından düz cam, şişe, kavanoz ve cam yünü.", "Flat glass, bottles, jars and glass wool from sand, soda and limestone.", 190_000, 5500),
  S("kiln_works", "manufacturing", "glass_ceramic", "kiln", 2, 2, "Tuğla ve seramik fırını", "Kiln works", "Kilden tuğla, kiremit, karo, porselen; odundan mangal kömürü.", "Bricks, tiles, ceramics from clay; charcoal from logs.", 140_000, 3500),
  // yapı
  S("cement_plant", "manufacturing", "construction", "mill", 2, 3, "Çimento fabrikası", "Cement plant", "Kireçtaşı ve kilden kireç, klinker ve çimento.", "Lime, clinker and cement from limestone and clay.", 220_000, 7000),
  S("concrete_plant", "manufacturing", "construction", "mill", 3, 4, "Beton santrali", "Concrete plant", "Beton, briket, prefabrik panel, harç, asfalt ve prefabrik ev.", "Concrete, blocks, precast panels, mortar, asphalt and prefab houses.", 200_000, 6000),
  // makine
  S("machine_shop", "manufacturing", "machinery", "workshop", 3, 4, "Makine atölyesi", "Machine shop", "Çelik ve dökümden makine parçası, dişli, rulman ve el aleti.", "Machine parts, gears, bearings and hand tools from steel and castings.", 210_000, 6000),
  S("electrical_works", "manufacturing", "machinery", "factory", 3, 4, "Elektrik malzemeleri fabrikası", "Electrical works", "Bakırdan tel, kablo ve elektrik motoru.", "Wire, cable and electric motors from copper.", 220_000, 6000),
  S("assembly_plant", "manufacturing", "machinery", "factory", 3, 5, "Montaj fabrikası", "Assembly plant", "Pompa, dizel motor, traktör, tarım ekipmanı ve konveyör.", "Pumps, engines, tractors, implements and conveyors.", 300_000, 9000),
  S("maintenance_depot", "manufacturing", "machinery", "workshop", 2, 3, "Bakım servisi", "Maintenance depot", "Makine parçası ve yağdan tesis ve araç bakım kiti.", "Plant and vehicle service kits from parts and lubricant.", 120_000, 3000),
  // lojistik
  S("logistics_hub", "manufacturing", "logistics", "warehouse", 3, 4, "Lojistik merkezi", "Logistics hub", "Konteyner, branda, spanzet, soğuk zincir kutusu ve biyodizel.", "Containers, tarps, straps, cold-chain boxes and biodiesel.", 180_000, 6000),
  // kimya
  S("chemical_plant", "manufacturing", "chemicals", "factory", 2, 3, "Kimya tesisi", "Chemical plant", "Gübre, soda, kostik, sabun, boya, tutkal, vernik ve yağ.", "Fertilizer, soda, caustic, soap, dye, glue, varnish and lubricant.", 190_000, 5500),
];

/** Fabrika binalarıyla aynı seviye eğrisi, maliyete orantılı */
function levelsFor(costTl: number, steelKg: number, tier: number): BuildingTypeDef["levels"] {
  const cost = costTl * 100;
  const upkeep = Math.round((cost * (0.0055 + tier * 0.0005)) / 1000) * 1000;
  return [
    { level: 1, lines: 1, maxBatches: 1, upkeepPerDay: upkeep, upgradeCost: Math.round(cost * 0.45 / 100_000) * 100_000, upgradeSteelKg: Math.round(steelKg * 0.6), upgradeMinutes: 360 },
    { level: 2, lines: 2, maxBatches: 2, upkeepPerDay: upkeep * 2, upgradeCost: Math.round(cost * 1.9 / 100_000) * 100_000, upgradeSteelKg: steelKg * 3, upgradeMinutes: 720, yieldBp: 600, efficiencyBp: 700, inputSavingBp: 1000 },
    { level: 3, lines: 3, maxBatches: 3, upkeepPerDay: upkeep * 4, upgradeCost: 0, upgradeSteelKg: 0, upgradeMinutes: 0, yieldBp: 1200, efficiencyBp: 1400, inputSavingBp: 1800, qualityBonus: 1 },
  ];
}

export const V4_BUILDING_TYPES: BuildingTypeDef[] = SPECS.map((s) => ({
  id: s.id, sector: s.sector, name: s.name, buildCost: s.costTl * 100, buildSteelKg: s.steelKg, buildMinutes: 240 + s.tier * 60,
  levels: levelsFor(s.costTl, s.steelKg, s.tier),
  qualityUpgradeCosts: [Math.round(s.costTl * 0.6) * 100, Math.round(s.costTl * 1.5) * 100], qualityUpgradeMinutes: 240,
  ...(s.deposits ? { requiresDeposit: true, deposits: s.deposits } : {}),
  industry: s.industry, archetype: s.archetype, tier: s.tier, minCompanyLevel: s.minCompanyLevel, description: s.description,
}));

/** Mevcut 6 binanın v4 ek alanları (yeni kurulumda koda, canlıda revizyonla eklenir) */
export const V4_LEGACY_BUILDING_EXTRAS: Record<string, Pick<BuildingTypeDef, "industry" | "archetype" | "tier" | "minCompanyLevel" | "description"> & { deposits?: BuildingTypeDef["deposits"] }> = {
  field: { industry: "field_crops", archetype: "field", tier: 1, minCompanyLevel: 1, description: { tr: "Tohumdan tahıl, arpa, mısır, yağlı tohum ve pancar; gübreli reçeteler daha verimli.", en: "Grain, barley, corn, oilseeds and beets from seed; fertilized recipes yield more." } },
  barn: { industry: "livestock", archetype: "barn", tier: 1, minCompanyLevel: 1, description: { tr: "Yem bitkisi, karma yem ya da silajla çiğ süt; altlıktan gübre.", en: "Raw milk from feed crops, compound feed or silage; manure from bedding." } },
  mine: { industry: "mining_metal", archetype: "mine", tier: 1, minCompanyLevel: 1, deposits: ["iron", "coal", "copper"], description: { tr: "Demir, kömür ve bakır yatağı; makine parçasıyla mekanize kazı.", en: "Iron, coal and copper deposits; mechanized digging with machine parts." } },
  food_plant: { industry: "dairy_food", archetype: "factory", tier: 1, minCompanyLevel: 1, description: { tr: "Un, paketli süt, peynir, bulgur, makarna, nişasta ve hazır gıda.", en: "Flour, packaged milk, cheese, bulgur, pasta, starch and ready food." } },
  steel_mill: { industry: "mining_metal", archetype: "kiln", tier: 1, minCompanyLevel: 1, description: { tr: "Cevher ve kömürden, pik demirden ya da kokla çelik.", en: "Steel from ore and coal, from pig iron, or with coke." } },
  garage: { industry: "logistics", archetype: "garage", tier: 1, minCompanyLevel: 1, description: { tr: "Araç park yeri; seviyeyle daha büyük filo.", en: "Vehicle bays; bigger fleet with each level." } },
};
