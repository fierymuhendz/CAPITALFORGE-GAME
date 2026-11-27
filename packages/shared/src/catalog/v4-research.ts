/**
 * v4 araştırmaları: iş kolu dalları, önkoşullar ve sunucuda uygulanan somut etkiler.
 * Kademe: A1 temel verim → A2 süreç (enerji/süre/kapasite) → A3 kilit (yeni reçete) → A4 uzmanlık (kalite, tasarruf).
 * Önkoşullar yalnızca kendinden ÖNCE tanımlı araştırmalara işaret eder (döngü olamaz; testle denetlenir).
 */
import type { ResearchBranch, ResearchDef, ResearchEffect } from "./types";

type Pre = Array<[string, number]>;
const R = (
  id: string, branch: ResearchBranch, tr: string, en: string, dtr: string, den: string,
  maxLevel: number, costTl: number, baseMinutes: number, effect: ResearchEffect, pre: Pre = [],
): ResearchDef => ({
  id, branch, name: { tr, en }, description: { tr: dtr, en: den }, maxLevel, baseCost: costTl * 100, baseMinutes, effect,
  prerequisites: pre.map(([researchId, level]) => ({ researchId, level })),
});

const by = (kind: "building_yield" | "building_efficiency" | "energy" | "input_saving" | "duration", buildingTypes: string[], bpPerLevel: number): ResearchEffect =>
  ({ kind, buildingTypes, bpPerLevel });
const cap = (buildingTypes: string[], batchesPerLevel = 1): ResearchEffect => ({ kind: "capacity", buildingTypes, batchesPerLevel });
const qual = (buildingTypes: string[], perLevel = 1): ResearchEffect => ({ kind: "building_quality", buildingTypes, perLevel });
const unlock = (...recipeIds: string[]): ResearchEffect => ({ kind: "unlock", recipeIds });

export const V4_RESEARCH: ResearchDef[] = [
  // ── Tarla bitkileri
  R("soil_science", "field_crops", "Toprak bilimi", "Soil science", "Gübreli tahıl, mısır, arpa ve patates reçetelerini açar.", "Unlocks fertilized grain, corn, barley and potato recipes.", 1, 30_000, 180, unlock("grow_grain_fert", "grow_corn_fert", "grow_barley_fert", "grow_potato_fert"), [["agronomy", 1]]),
  R("irrigation", "field_crops", "Damla sulama", "Drip irrigation", "Tarla, sera ve lif tarlasında süre seviye başına −%10.", "Field, greenhouse and fiber farm duration −10% per level.", 2, 25_000, 180, by("duration", ["field", "greenhouse", "fiber_farm"], 1000), [["agronomy", 1]]),
  R("greenhouse_climate", "field_crops", "Sera iklimlendirme", "Greenhouse climate control", "Serada enerji seviye başına −%15.", "Greenhouse energy −15% per level.", 2, 30_000, 180, by("energy", ["greenhouse"], 1500), [["irrigation", 1]]),
  R("hydroponics", "field_crops", "Topraksız tarım", "Hydroponics", "Pompalı topraksız domates reçetesini açar.", "Unlocks the pump-fed hydroponic tomato recipe.", 1, 45_000, 240, unlock("grow_tomato_hydro"), [["greenhouse_climate", 1]]),
  R("orchard_pruning", "field_crops", "Budama teknikleri", "Pruning techniques", "Meyve bahçesi çıktısı seviye başına +%10.", "Orchard output +10% per level.", 3, 20_000, 180, by("building_yield", ["orchard"], 1000)),
  R("fiber_breeding", "field_crops", "Lif ıslahı", "Fiber breeding", "Lif tarlası çıktısı seviye başına +%8.", "Fiber farm output +8% per level.", 3, 22_000, 180, by("building_yield", ["fiber_farm"], 800), [["agronomy", 1]]),
  R("seed_selection", "field_crops", "Tohum seçimi", "Seed selection", "Tarlada tohum girdisi seviye başına −%8.", "Field seed input −8% per level.", 2, 25_000, 180, by("input_saving", ["field", "fiber_farm"], 800), [["soil_science", 1]]),
  // ── Yem
  R("feed_formulation", "feed", "Yem formülasyonu", "Feed formulation", "Yem fabrikası çıktısı seviye başına +%6.", "Feed mill output +6% per level.", 3, 20_000, 180, by("building_yield", ["feed_mill"], 600)),
  R("pellet_press", "feed", "Pelet presi", "Pellet press", "Yem fabrikasında parti kapasitesi seviye başına +1.", "Feed mill batch capacity +1 per level.", 2, 35_000, 240, cap(["feed_mill"]), [["feed_formulation", 1]]),
  R("feed_science", "feed", "Hayvan besleme bilimi", "Animal nutrition", "Premiksli besi reçetesini açar.", "Unlocks the premix cattle fattening recipe.", 1, 40_000, 240, unlock("fatten_cattle_premix"), [["pellet_press", 1]]),
  R("silage_tech", "feed", "Silaj teknolojisi", "Silage technology", "Yem fabrikasında enerji seviye başına −%12.", "Feed mill energy −12% per level.", 2, 18_000, 180, by("energy", ["feed_mill"], 1200), [["feed_formulation", 1]]),
  // ── Hayvancılık
  R("dairy_automation", "livestock", "Süt otomasyonu", "Dairy automation", "Makineli sağım reçetesini açar.", "Unlocks machine milking.", 1, 50_000, 240, unlock("milk_cows_machine"), [["herd_health", 1]]),
  R("poultry_welfare", "livestock", "Kümes refahı", "Poultry welfare", "Kümes çıktısı seviye başına +%8.", "Poultry farm output +8% per level.", 3, 22_000, 180, by("building_yield", ["poultry_farm"], 800)),
  R("flock_genetics", "livestock", "Sürü genetiği", "Flock genetics", "Yalama taşıyla kırkım reçetesini açar.", "Unlocks wool shearing with mineral lick.", 1, 35_000, 240, unlock("shear_wool_lick"), [["herd_health", 1]]),
  R("ranch_management", "livestock", "Besi yönetimi", "Ranch management", "Besi çiftliği ve ağılda girdi seviye başına −%7.", "Cattle ranch and sheep farm inputs −7% per level.", 3, 28_000, 180, by("input_saving", ["cattle_ranch", "sheep_farm"], 700), [["herd_health", 1]]),
  R("beekeeping", "livestock", "Arıcılık", "Beekeeping", "Arılık çıktısı seviye başına +%12.", "Apiary output +12% per level.", 2, 15_000, 180, by("building_yield", ["apiary"], 1200)),
  // ── Süt ve gıda
  R("pasteurization", "dairy_food", "Pastörizasyon", "Pasteurization", "Mandırada süre seviye başına −%10.", "Dairy plant duration −10% per level.", 2, 30_000, 180, by("duration", ["dairy_plant"], 1000)),
  R("cheese_aging", "dairy_food", "Peynir olgunlaştırma", "Cheese aging", "Mandırada kalite +1.", "Dairy plant quality +1.", 1, 60_000, 300, qual(["dairy_plant"]), [["pasteurization", 1]]),
  R("baking_science", "dairy_food", "Fırıncılık bilimi", "Baking science", "Kepekli ekmek reçetesini açar.", "Unlocks bran bread.", 1, 25_000, 180, unlock("bake_bread_bran")),
  R("cold_storage", "dairy_food", "Soğuk depolama", "Cold storage", "Et kombinası ve konservede enerji seviye başına −%12.", "Meat plant and cannery energy −12% per level.", 2, 30_000, 180, by("energy", ["slaughterhouse", "cannery"], 1200)),
  R("milling_rolls", "dairy_food", "Valsli değirmen", "Roller milling", "Gıda fabrikası ve şeker fabrikasında çıktı seviye başına +%5.", "Food plant and sugar refinery output +5% per level.", 3, 28_000, 180, by("building_yield", ["food_plant", "sugar_refinery"], 500), [["lean_process", 1]]),
  R("extraction", "dairy_food", "Solvent ekstraksiyonu", "Solvent extraction", "Yağ fabrikası çıktısı seviye başına +%8.", "Oil press output +8% per level.", 2, 30_000, 180, by("building_yield", ["oil_press"], 800)),
  R("brewing", "dairy_food", "Fermantasyon kontrolü", "Fermentation control", "İçecek fabrikasında parti kapasitesi +1.", "Beverage plant batch capacity +1.", 1, 55_000, 240, cap(["beverage_plant"]), [["pasteurization", 1]]),
  // ── Tekstil
  R("open_end_spinning", "textile", "Open-end eğirme", "Open-end spinning", "Motorlu hızlı eğirme reçetesini açar.", "Unlocks motorized open-end spinning.", 1, 45_000, 240, unlock("spin_cotton_fast")),
  R("loom_automation", "textile", "Otomatik tezgâh", "Automatic looms", "Dokuma fabrikasında enerji ve işçilik seviye başına −%10.", "Weaving mill energy and labour −10% per level.", 3, 30_000, 180, by("building_efficiency", ["weaving_mill", "spinning_mill"], 1000)),
  R("dyeing", "textile", "Boya haslığı", "Colour fastness", "Dokuma ve konfeksiyonda kalite +1.", "Weaving and garment quality +1.", 1, 70_000, 300, qual(["weaving_mill", "garment_factory"]), [["loom_automation", 1]]),
  R("tanning_chem", "textile", "Tabaklama kimyası", "Tanning chemistry", "Tabakhane çıktısı seviye başına +%8.", "Tannery output +8% per level.", 2, 28_000, 180, by("building_yield", ["tannery"], 800)),
  R("lean_sewing", "textile", "Yalın dikim", "Lean sewing", "Konfeksiyonda süre seviye başına −%10.", "Garment factory duration −10% per level.", 2, 30_000, 180, by("duration", ["garment_factory"], 1000), [["loom_automation", 1]]),
  // ── Ormancılık
  R("silviculture", "forestry", "Silvikültür", "Silviculture", "Orman işletmesi çıktısı seviye başına +%8.", "Forest plantation output +8% per level.", 3, 20_000, 180, by("building_yield", ["forest_plantation"], 800)),
  R("mechanized_forestry", "forestry", "Mekanize ormancılık", "Mechanized forestry", "Makineli tomruk kesimi reçetesini açar.", "Unlocks mechanized felling.", 1, 40_000, 240, unlock("fell_logs_mech"), [["silviculture", 1]]),
  R("precision_sawing", "forestry", "Hassas biçme", "Precision sawing", "Az firelı kereste reçetesini açar.", "Unlocks low-waste precision sawing.", 1, 35_000, 240, unlock("saw_lumber_precision")),
  R("wood_drying", "forestry", "Kurutma fırını", "Kiln drying", "Hızar ve ahşap atölyesinde süre seviye başına −%10.", "Sawmill and woodworking duration −10% per level.", 2, 25_000, 180, by("duration", ["sawmill", "wood_workshop"], 1000)),
  R("pulping", "forestry", "Kimyasal hamur", "Chemical pulping", "Kâğıt fabrikasında girdi seviye başına −%8.", "Paper mill inputs −8% per level.", 2, 35_000, 180, by("input_saving", ["paper_mill"], 800), [["wood_drying", 1]]),
  // ── Ambalaj
  R("die_cutting", "packaging", "Kalıp kesim", "Die cutting", "Ambalaj fabrikasında parti kapasitesi +1.", "Packaging plant batch capacity +1.", 2, 40_000, 240, cap(["packaging_plant"])),
  R("print_finishing", "packaging", "Baskı ve lak", "Print finishing", "Ambalaj fabrikasında kalite +1.", "Packaging plant quality +1.", 1, 50_000, 240, qual(["packaging_plant"]), [["die_cutting", 1]]),
  R("palletization", "packaging", "Paletleme standardı", "Palletization standard", "Ambalaj ve ahşap atölyesinde girdi seviye başına −%6.", "Packaging and woodworking inputs −6% per level.", 3, 25_000, 180, by("input_saving", ["packaging_plant", "wood_workshop"], 600)),
  // ── Maden ve metal
  R("heavy_machinery", "mining_metal", "Ağır iş makineleri", "Heavy machinery", "Maden ve taş ocağında makine parçalı mekanize reçeteleri açar.", "Unlocks mechanized mine and quarry recipes using machine parts.", 1, 50_000, 240, unlock("mine_iron_mech", "mine_coal_mech", "mine_copper_mech", "quarry_limestone_mech", "dredge_sand_mech", "dig_clay_mech", "mine_salt_mech"), [["drilling", 1]]),
  R("blasting", "mining_metal", "Kontrollü patlatma", "Controlled blasting", "Taş ocağı çıktısı seviye başına +%8.", "Quarry output +8% per level.", 3, 22_000, 180, by("building_yield", ["quarry"], 800)),
  R("metallurgy", "mining_metal", "Metalurji", "Metallurgy", "Koklu çelik dökümü reçetesini açar.", "Unlocks coke-fired steelmaking.", 1, 55_000, 240, unlock("smelt_steel_coke"), [["lean_process", 1]]),
  R("furnace_recovery", "mining_metal", "Fırın ısı geri kazanımı", "Furnace heat recovery", "Kok, izabe ve çelikhanede enerji seviye başına −%10.", "Coke, smelter and steel mill energy −10% per level.", 3, 35_000, 180, by("energy", ["coke_plant", "smelter", "steel_mill"], 1000)),
  R("continuous_casting", "mining_metal", "Sürekli döküm", "Continuous casting", "Haddehane ve dökümde parti kapasitesi +1.", "Rolling mill and foundry batch capacity +1.", 2, 60_000, 300, cap(["rolling_mill", "foundry"]), [["metallurgy", 1]]),
  // ── Cam ve seramik
  R("float_glass", "glass_ceramic", "Yüzdürme camı", "Float process", "Cam fabrikası çıktısı seviye başına +%6.", "Glassworks output +6% per level.", 3, 35_000, 180, by("building_yield", ["glassworks"], 600)),
  R("kiln_insulation", "glass_ceramic", "Fırın yalıtımı", "Kiln insulation", "Cam ve fırın işlerinde enerji seviye başına −%12.", "Glassworks and kiln energy −12% per level.", 2, 30_000, 180, by("energy", ["glassworks", "kiln_works"], 1200)),
  R("glazing", "glass_ceramic", "Sırlama", "Glazing", "Fırın işlerinde kalite +1.", "Kiln works quality +1.", 1, 50_000, 240, qual(["kiln_works"]), [["kiln_insulation", 1]]),
  // ── Yapı malzemeleri
  R("clinker_cooling", "construction", "Klinker soğutma", "Clinker cooling", "Çimento fabrikasında enerji seviye başına −%10.", "Cement plant energy −10% per level.", 3, 35_000, 180, by("energy", ["cement_plant"], 1000)),
  R("mix_design", "construction", "Beton tasarımı", "Mix design", "Beton santralinde girdi seviye başına −%7.", "Concrete plant inputs −7% per level.", 3, 30_000, 180, by("input_saving", ["concrete_plant"], 700), [["clinker_cooling", 1]]),
  R("prefab_line", "construction", "Prefabrik hattı", "Prefab line", "Beton santralinde parti kapasitesi +1.", "Concrete plant batch capacity +1.", 1, 70_000, 300, cap(["concrete_plant"]), [["mix_design", 1]]),
  // ── Makine
  R("cnc_machining", "machinery", "CNC tezgâhları", "CNC machining", "Makine atölyesi çıktısı seviye başına +%6.", "Machine shop output +6% per level.", 3, 45_000, 240, by("building_yield", ["machine_shop"], 600)),
  R("tolerance_control", "machinery", "Tolerans kontrolü", "Tolerance control", "Makine atölyesi ve montajda kalite +1.", "Machine shop and assembly quality +1.", 1, 80_000, 300, qual(["machine_shop", "assembly_plant"]), [["cnc_machining", 1]]),
  R("predictive_maintenance", "machinery", "Kestirimci bakım", "Predictive maintenance", "El aletli bakım kiti reçetesini açar.", "Unlocks the tool-based maintenance kit recipe.", 1, 45_000, 240, unlock("pack_maintenance_kit_tools"), [["cnc_machining", 1]]),
  R("motor_winding", "machinery", "Motor sarım otomasyonu", "Winding automation", "Elektrik fabrikasında enerji ve işçilik seviye başına −%10.", "Electrical works energy and labour −10% per level.", 2, 40_000, 240, by("building_efficiency", ["electrical_works", "assembly_plant"], 1000)),
  // ── Lojistik
  R("telematics", "logistics", "Filo telematiği", "Fleet telematics", "Yakıt gideri seviye başına −%5.", "Fuel cost −5% per level.", 2, 30_000, 180, { kind: "fuel", bpPerLevel: 500 }, [["eco_driving", 1]]),
  R("hub_sorting", "logistics", "Aktarma ayrıştırma", "Hub sorting", "Lojistik merkezinde süre seviye başına −%12.", "Logistics hub duration −12% per level.", 2, 35_000, 180, by("duration", ["logistics_hub"], 1200)),
  R("highway_ops", "logistics", "Otoyol operasyonu", "Highway operations", "Araç hızı seviye başına +%4.", "Vehicle speed +4% per level.", 2, 30_000, 180, { kind: "speed", bpPerLevel: 400 }, [["route_planning", 1]]),
  // ── Kimya
  R("catalysis", "chemicals", "Kataliz", "Catalysis", "Kimya tesisinde enerji seviye başına −%12.", "Chemical plant energy −12% per level.", 3, 35_000, 180, by("energy", ["chemical_plant"], 1200)),
  R("process_chem", "chemicals", "Proses kimyası", "Process chemistry", "Kimya tesisinde çıktı seviye başına +%6.", "Chemical plant output +6% per level.", 3, 40_000, 240, by("building_yield", ["chemical_plant"], 600), [["catalysis", 1]]),
  R("batch_reactors", "chemicals", "Kesikli reaktör", "Batch reactors", "Kimya tesisinde parti kapasitesi +1.", "Chemical plant batch capacity +1.", 1, 60_000, 300, cap(["chemical_plant"]), [["process_chem", 1]]),
];
