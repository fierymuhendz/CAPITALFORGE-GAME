/**
 * Çalışma anı kataloğu: veritabanındaki catalog_items ve settings satırlarının bellekteki kopyası.
 * Yönetici düzenlemesinden sonra reload() çağrılır; ayrıca 60 sn'de bir tazelenir.
 */
import type {
  BuildingTypeDef, CityDef, ProductDef, RecipeDef, ResearchDef, Settings, VehicleModelDef,
} from "@capitalforge/shared";
import { DEFAULT_SETTINGS, V4_LEGACY_BUILDING_EXTRAS } from "@capitalforge/shared";
import type { Db } from "../db/client";
import { catalogItems, settings as settingsTable } from "../db/schema";
import { fail } from "../errors";

export type Versioned<T> = T & { version: number };

export class Catalog {
  cities = new Map<string, Versioned<CityDef>>();
  products = new Map<string, Versioned<ProductDef>>();
  buildingTypes = new Map<string, Versioned<BuildingTypeDef>>();
  recipes = new Map<string, Versioned<RecipeDef>>();
  research = new Map<string, Versioned<ResearchDef>>();
  vehicleModels = new Map<string, Versioned<VehicleModelDef>>();
  settings: Settings = DEFAULT_SETTINGS;
  loadedAt = 0;

  async reload(db: Db): Promise<void> {
    const rows = await db.select().from(catalogItems);
    const maps = { city: new Map(), product: new Map(), building_type: new Map(), recipe: new Map(), research: new Map(), vehicle_model: new Map() } as Record<string, Map<string, unknown>>;
    for (const r of rows) {
      // Yönetici düzenlediği için v4 revizyonu atlanan eski bina satırları: eksik alanlar (ör. maden yatak listesi) varsayılanla tamamlanır
      const extras = r.kind === "building_type" ? V4_LEGACY_BUILDING_EXTRAS[r.id] : undefined;
      const data = r.data as Record<string, unknown>;
      const filled = extras ? { ...Object.fromEntries(Object.entries(extras).filter(([k]) => data[k] === undefined)), ...data } : data;
      maps[r.kind]?.set(r.id, { ...filled, id: r.id, version: r.version });
    }
    this.cities = maps.city as Map<string, Versioned<CityDef>>;
    this.products = maps.product as Map<string, Versioned<ProductDef>>;
    this.buildingTypes = maps.building_type as Map<string, Versioned<BuildingTypeDef>>;
    this.recipes = maps.recipe as Map<string, Versioned<RecipeDef>>;
    this.research = maps.research as Map<string, Versioned<ResearchDef>>;
    this.vehicleModels = maps.vehicle_model as Map<string, Versioned<VehicleModelDef>>;
    const srows = await db.select().from(settingsTable);
    const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    // Yeni eklenen alt anahtarlar: veritabanında eski sürüm saklıysa varsayılanla tamamlanır (starterInputs hariç: yönetici tam listeyi belirler)
    for (const s of srows) {
      const def = (DEFAULT_SETTINGS as Record<string, unknown>)[s.key];
      const plain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
      merged[s.key] = plain(def) && plain(s.value) && s.key !== "starterInputs" ? { ...def, ...s.value } : s.value;
    }
    this.settings = merged as unknown as Settings;
    this.loadedAt = Date.now();
  }

  city(id: string): Versioned<CityDef> {
    return this.cities.get(id) ?? fail("NOT_FOUND", { cityId: id });
  }
  product(id: string): Versioned<ProductDef> {
    return this.products.get(id) ?? fail("NOT_FOUND", { productId: id });
  }
  recipe(id: string): Versioned<RecipeDef> {
    return this.recipes.get(id) ?? fail("NOT_FOUND", { recipeId: id });
  }
  buildingType(id: string): Versioned<BuildingTypeDef> {
    return this.buildingTypes.get(id) ?? fail("NOT_FOUND", { buildingType: id });
  }
  vehicleModel(id: string): Versioned<VehicleModelDef> {
    return this.vehicleModels.get(id) ?? fail("NOT_FOUND", { modelId: id });
  }
  researchDef(id: string): Versioned<ResearchDef> {
    return this.research.get(id) ?? fail("NOT_FOUND", { researchId: id });
  }
  recipesFor(buildingType: string): Versioned<RecipeDef>[] {
    return [...this.recipes.values()].filter((r) => r.buildingType === buildingType);
  }
  levelDef(buildingType: string, level: number) {
    const b = this.buildingType(buildingType);
    return b.levels.find((l) => l.level === level) ?? b.levels[b.levels.length - 1]!;
  }
}
