import type { ResearchEffect } from "@capitalforge/shared";
import type { Cat } from "@/lib/catalog";
import type { I18n } from "@/lib/i18n";

/** Araştırma etkisini somut, seviye başına bir cümleye çevirir ("Mandıra süresi −%10/seviye"). Reçete açma `unlockedRecipes` ile ayrıca gösterilir. */
export function effectText(e: ResearchEffect, i: I18n, cat: Cat): string | null {
  const bp = (n: number) => i.num(n / 100);
  const names = (ids: string[]) => {
    const n = ids.map((x) => cat.building(x));
    return n.length > 3 ? `${n.slice(0, 3).join(", ")} +${n.length - 3}` : n.join(", ");
  };
  const t = i.t;
  switch (e.kind) {
    case "yield": return t("effect.yield", { target: t(`sector.${e.sector}`), v: bp(e.bpPerLevel) });
    case "efficiency": return t("effect.efficiency", { target: t(`sector.${e.sector}`), v: bp(e.bpPerLevel) });
    case "quality": return t("effect.quality", { v: i.num(e.perLevel) });
    case "fuel": return t("effect.fuel", { v: bp(e.bpPerLevel) });
    case "speed": return t("effect.speed", { v: bp(e.bpPerLevel) });
    case "building_yield": return t("effect.building_yield", { target: names(e.buildingTypes), v: bp(e.bpPerLevel) });
    case "building_efficiency": return t("effect.building_efficiency", { target: names(e.buildingTypes), v: bp(e.bpPerLevel) });
    case "energy": return t("effect.energy", { target: names(e.buildingTypes), v: bp(e.bpPerLevel) });
    case "input_saving": return t("effect.input_saving", { target: names(e.buildingTypes), v: bp(e.bpPerLevel) });
    case "duration": return t("effect.duration", { target: names(e.buildingTypes), v: bp(e.bpPerLevel) });
    case "capacity": return t("effect.capacity", { target: names(e.buildingTypes), v: i.num(e.batchesPerLevel) });
    case "building_quality": return t("effect.building_quality", { target: names(e.buildingTypes), v: i.num(e.perLevel) });
    case "unlock": return null;
  }
}
