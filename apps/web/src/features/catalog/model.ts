"use client";
/** Katalog ekranları için türetilmiş görünümler (yalnızca sunucudan gelen katalog ve oyuncu verisinin süzülmesi; hesap yok). */
import { useMemo } from "react";
import type { FacilityDto, HoldingDto, WorldDto } from "@capitalforge/shared";
import { useApp } from "@/lib/app";
import { useData } from "@/lib/data";
import { usePlay } from "../play/context";

export type ProductDef = WorldDto["products"][number];
export type BuildingDef = WorldDto["buildingTypes"][number];
export type RecipeDef = WorldDto["recipes"][number];
export type ResearchDef = WorldDto["research"][number];

export interface Mine {
  ready: boolean;
  companyLevel: number;
  facilities: FacilityDto[];
  researchLevel: Map<string, number>;
  /** ürün → toplam kullanılabilir kg */
  stockKg: Map<string, number>;
  /** ürün → şehir bazında [şehir, kg] (çoktan aza) */
  stockCities: Map<string, Array<[string, number]>>;
}

export function useMine(): Mine {
  const { company } = usePlay();
  const { me } = useApp();
  const inv = useData<HoldingDto[]>("/inventory", undefined, ["inventory"]);
  const cd = company.data;
  const facilities = cd?.facilities;
  const research = cd?.research;
  const holdings = inv.data;
  return useMemo(() => {
    const researchLevel = new Map<string, number>();
    for (const r of research ?? []) researchLevel.set(r.researchId, r.level);
    const stockKg = new Map<string, number>();
    const byCity = new Map<string, Map<string, number>>();
    for (const h of holdings ?? []) {
      if (h.availableKg <= 0) continue;
      stockKg.set(h.productId, (stockKg.get(h.productId) ?? 0) + h.availableKg);
      const m = byCity.get(h.productId) ?? new Map<string, number>();
      m.set(h.cityId, (m.get(h.cityId) ?? 0) + h.availableKg);
      byCity.set(h.productId, m);
    }
    const stockCities = new Map<string, Array<[string, number]>>();
    for (const [p, m] of byCity) stockCities.set(p, [...m.entries()].sort((a, b) => b[1] - a[1]));
    return { ready: !!cd && !!holdings, companyLevel: cd?.level ?? me?.company?.level ?? 1, facilities: facilities ?? [], researchLevel, stockKg, stockCities };
  }, [cd, facilities, research, holdings, me?.company?.level]);
}

export interface Gate { researchId: string; need: number; have: number; met: boolean }
export function gateOf(r: RecipeDef, mine: Mine): Gate | null {
  if (!r.research) return null;
  const have = mine.researchLevel.get(r.research.researchId) ?? 0;
  return { researchId: r.research.researchId, need: r.research.level, have, met: have >= r.research.level };
}

/** Bu reçeteyi şimdi başlatabilecek (kurulu, hazır, seviyesi yeterli) tesisler; araştırma kilidi açıksa. */
export function makers(r: RecipeDef, mine: Mine): FacilityDto[] {
  if (!(gateOf(r, mine)?.met ?? true)) return [];
  return mine.facilities.filter((f) => f.type === r.buildingType && f.level >= r.minBuildingLevel && f.status !== "constructing");
}

export type Availability = "installed" | "buildable" | "locked";
export interface RecipeAvail { kind: Availability; gate: Gate | null; facilities: FacilityDto[]; ownedLowLevel: boolean; needCompanyLevel: number | null }

/** Durum: kurulu (tesis var), kurulabilir (tesis yok, seviye yeterli), kilitli (araştırma veya seviye engeli). */
export function availability(w: WorldDto, r: RecipeDef, mine: Mine): RecipeAvail {
  const gate = gateOf(r, mine);
  const bt = w.buildingTypes.find((b) => b.id === r.buildingType);
  const owned = mine.facilities.filter((f) => f.type === r.buildingType);
  const fit = owned.filter((f) => f.level >= r.minBuildingLevel);
  const needCompanyLevel = bt && bt.minCompanyLevel > mine.companyLevel ? bt.minCompanyLevel : null;
  if (gate && !gate.met) return { kind: "locked", gate, facilities: fit, ownedLowLevel: owned.length > 0 && fit.length === 0, needCompanyLevel };
  if (fit.length) return { kind: "installed", gate, facilities: fit, ownedLowLevel: false, needCompanyLevel: null };
  if (owned.length) return { kind: "locked", gate, facilities: [], ownedLowLevel: true, needCompanyLevel: null };
  if (needCompanyLevel) return { kind: "locked", gate, facilities: [], ownedLowLevel: false, needCompanyLevel };
  return { kind: "buildable", gate, facilities: [], ownedLowLevel: false, needCompanyLevel: null };
}

export type ResearchNeed = "none" | "done" | "needed";
/** Ürünün araştırma durumu: hiç kilitsiz tarifi varsa "gerekmez"; tüm tarifler kilitliyse açık olan varsa "araştırıldı", yoksa "gerekli". */
export function productResearch(w: WorldDto, productId: string, mine: Mine): ResearchNeed {
  const rs = w.recipes.filter((r) => r.output.productId === productId);
  if (!rs.length || rs.some((r) => !r.research)) return "none";
  return rs.some((r) => gateOf(r, mine)?.met) ? "done" : "needed";
}
export function recipeResearch(r: RecipeDef, mine: Mine): ResearchNeed {
  const g = gateOf(r, mine);
  return !g ? "none" : g.met ? "done" : "needed";
}

export const producersOf = (w: WorldDto, productId: string): RecipeDef[] => w.recipes.filter((r) => r.output.productId === productId);
export const consumersOf = (w: WorldDto, productId: string): RecipeDef[] => w.recipes.filter((r) => r.inputs.some((x) => x.productId === productId));

/** Mevcut (araştırmayla açılan) reçetelerden en az birini üretebiliyor mu. */
export function canMakeProduct(w: WorldDto, productId: string, mine: Mine): boolean {
  return producersOf(w, productId).some((r) => makers(r, mine).length > 0);
}
