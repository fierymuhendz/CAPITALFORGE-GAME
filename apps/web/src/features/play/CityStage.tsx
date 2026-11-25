"use client";
import type { WorldDto, WorldMapDto } from "@capitalforge/shared";
import { CityViewLazy, type CityViewProps, type GraphicsQuality } from "../../scene";

export function resolveQuality(pref: "auto" | "high" | "low" | "lite" | undefined): GraphicsQuality {
  if (pref === "high" || pref === "low" || pref === "lite") return pref;
  if (typeof window === "undefined") return "low";
  try {
    const c = document.createElement("canvas");
    if (!c.getContext("webgl2") && !c.getContext("webgl")) return "lite";
  } catch { return "lite"; }
  const nav = navigator as Navigator & { deviceMemory?: number };
  if (window.matchMedia("(max-width: 980px)").matches || (nav.deviceMemory ?? 8) <= 4 || (navigator.hardwareConcurrency ?? 8) <= 4) return "low";
  return "high";
}

/** 3D şehir (WebGL yoksa veya "lite" ise 2B harita). Tüm veri sunucudan gelen world/map'ten. */
export function CityStage(props: Omit<CityViewProps, "world" | "map"> & { world: WorldDto; map: WorldMapDto | null; myLevel?: number }) {
  if (!props.map) return <div className="skel" style={{ position: "absolute", inset: 0, borderRadius: 0 }} aria-busy="true" />;
  return <CityViewLazy {...props} map={props.map} />;
}
