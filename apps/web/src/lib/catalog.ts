"use client";
import { useMemo } from "react";
import type { WorldDto } from "@capitalforge/shared";
import { useApp } from "./app";
import { useT } from "./i18n";

/** Katalogdaki adlar (ürün, şehir, bina, tarif, araç, araştırma) seçili dilde. */
export function useCat() {
  const { world } = useApp();
  const { locale } = useT();
  return useMemo(() => {
    const w = world as WorldDto;
    const nm = (l: { tr: string; en: string } | undefined, fb: string) => (l ? l[locale] : fb);
    return {
      world: w,
      product: (id: string) => nm(w.products.find((p) => p.id === id)?.name, id),
      productColor: (id: string) => w.products.find((p) => p.id === id)?.color ?? "#888",
      city: (id: string | null | undefined) => (id ? nm(w.cities.find((c) => c.id === id)?.name, id) : "—"),
      building: (id: string) => nm(w.buildingTypes.find((b) => b.id === id)?.name, id),
      recipe: (id: string) => nm(w.recipes.find((r) => r.id === id)?.name, id),
      vehicle: (id: string) => nm(w.vehicleModels.find((v) => v.id === id)?.name, id),
      research: (id: string) => nm(w.research.find((r) => r.id === id)?.name, id),
      researchDesc: (id: string) => nm(w.research.find((r) => r.id === id)?.description, ""),
      km: (a: string, b: string) => w.roads.find((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a))?.km ?? null,
    };
  }, [world, locale]);
}
export type Cat = ReturnType<typeof useCat>;
