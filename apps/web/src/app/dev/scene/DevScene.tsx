"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CITIES, PLOTS, PRODUCTS, ROAD_LIST,
  type PlotDto, type VehicleMapDto, type WorldDto, type WorldMapDto,
} from "@capitalforge/shared";
import { CityMap2D, CityViewLazy, detectQuality, type CitySelection, type GraphicsPref, type GraphicsQuality } from "@/scene";
import { mulberry } from "@/scene/layout";

const ME = "company-me";

function makeWorld(): WorldDto {
  return {
    serverTime: new Date().toISOString(),
    cities: CITIES.map((c) => ({
      id: c.id, name: c.name, blurb: c.blurb, map: c.map, color: c.color,
      energyPrice: String(c.energyPrice), waterPrice: String(c.waterPrice), wage: String(c.wage),
      laborNote: c.labor.note, laborAvailability: c.labor.availability, sectorYieldBp: c.sectorYieldBp,
    })),
    roads: ROAD_LIST.map(([a, b, km]) => ({ a, b, km })),
    products: PRODUCTS.map((p) => ({ id: p.id, name: p.name, category: p.category, color: p.color, basePricePerKg: String(p.basePricePerKg), industry: p.industry ?? null, stage: p.stage ?? null })),
    buildingTypes: [], recipes: [], research: [], systemDemand: [], industries: [], vehicleModels: [], levelXp: [], marketFeeBp: 0, qualityPriceBp: [],
    freight: { systemBaseFee: "0", systemPerKm: "0", driverHoursPerTrip: 1 },
    startingCash: "0", pace: { maxMinutes: 0, travelScaleBp: 10000, playtestSeconds: 0 },
  };
}

const STATUSES = ["working", "working", "working", "working", "idle", "idle", "stalled", "constructing", "upgrading", "working"] as const;
const TYPES = ["field", "barn", "food_plant", "steel_mill", "garage", "field", "barn"] as const;

function makeMap(): WorldMapDto {
  const rnd = mulberry(42);
  const now = Date.now();
  const plots: PlotDto[] = PLOTS.map((p, i) => {
    const r = rnd();
    const owned = r < 0.55;
    const mine = owned && rnd() < 0.3;
    const companyId = mine ? ME : `company-${Math.floor(rnd() * 6)}`;
    const type = p.deposit ? "mine" : (TYPES[Math.floor(rnd() * TYPES.length)] as string);
    return {
      id: p.id, cityId: p.cityId, gx: p.gx, gz: p.gz, price: String(p.price), minLevel: p.minLevel, sizeHa: p.sizeHa,
      fertilityBp: p.fertilityBp, pastureBp: p.pastureBp, deposit: p.deposit, distanceToCenterKm: p.distanceToCenterKm,
      owner: owned ? { companyId, companyName: mine ? "Demirci A.Ş." : `Şirket ${companyId.slice(-1)}`, isSystem: !mine && rnd() < 0.15 } : null,
      building: owned && (rnd() < 0.8 || p.deposit)
        ? {
          id: `fac-${i}`, type, level: 1 + Math.floor(rnd() * rnd() * 3.2), qualityLevel: 1,
          status: STATUSES[Math.floor(rnd() * STATUSES.length)] as "working",
          activeUntil: null, ownerCompanyId: companyId, outputProductId: type === "field" ? (rnd() < 0.5 ? "grain" : "fodder") : null,
        }
        : null,
    };
  });
  const vehicles: VehicleMapDto[] = [];
  const models = ["van", "truck", "semi"];
  for (let i = 0; i < 26; i++) {
    const road = ROAD_LIST[Math.floor(rnd() * ROAD_LIST.length)] as [string, string, number];
    const flip = rnd() < 0.5;
    const total = (25 + rnd() * 50) * 60_000;
    const done = rnd() * total;
    const mine = i % 4 === 0;
    const model = models[Math.floor(rnd() * 3)] as string;
    const transit = i < 18;
    const city = (CITIES[i % CITIES.length] as { id: string }).id;
    vehicles.push({
      id: `veh-${i}`, modelId: model, ownerCompanyId: mine ? ME : `company-${i % 5}`, ownerName: mine ? "Demirci A.Ş." : `Şirket ${i % 5}`, isMine: mine,
      status: transit ? "in_transit" : "idle",
      cityId: transit ? null : city,
      shipment: transit
        ? {
          id: `ship-${i}`, originCityId: flip ? road[1] : road[0], destCityId: flip ? road[0] : road[1],
          departedAt: new Date(now - done).toISOString(), arrivesAt: new Date(now + (total - done)).toISOString(),
          cargo: i % 2 ? [{ productId: i % 3 === 0 ? "coal" : "grain", quality: 2, qtyKg: 5000 }] : null, totalKg: 5000,
        }
        : null,
    });
  }
  return { serverTime: new Date(now).toISOString(), plots, vehicles };
}

export default function DevScene() {
  const world = useMemo(makeWorld, []);
  const [map, setMap] = useState<WorldMapDto | null>(null);
  const [pref, setPref] = useState<GraphicsPref>("auto");
  const [quality, setQuality] = useState<GraphicsQuality>("low");
  const [force2d, setForce2d] = useState(false);
  const [locale, setLocale] = useState<"tr" | "en">("tr");
  const [focus, setFocus] = useState<string | null>(null);
  const [selected, setSelected] = useState<CitySelection | null>(null);

  useEffect(() => { setMap(makeMap()); }, []);
  useEffect(() => { setQuality(detectQuality(pref)); }, [pref]);

  const q: GraphicsQuality = force2d ? "lite" : quality;
  const sel = (s: CitySelection | null) => setSelected(s);

  return (
    <main style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", background: "#0b121b", color: "#eef3f8", font: "14px system-ui, sans-serif" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: 8, alignItems: "center", borderBottom: "1px solid #223243" }}>
        <label>Kalite{" "}
          <select value={pref} onChange={(e) => setPref(e.target.value as GraphicsPref)} data-testid="quality">
            <option value="auto">auto</option><option value="high">high</option><option value="low">low</option><option value="lite">lite (2D)</option>
          </select>
        </label>
        <label><input type="checkbox" checked={force2d} onChange={(e) => setForce2d(e.target.checked)} /> 2D</label>
        <label>Dil{" "}
          <select value={locale} onChange={(e) => setLocale(e.target.value as "tr" | "en")}>
            <option value="tr">tr</option><option value="en">en</option>
          </select>
        </label>
        <label>Odak{" "}
          <select value={focus ?? ""} onChange={(e) => setFocus(e.target.value || null)} data-testid="focus">
            <option value="">Ülke</option>
            {CITIES.map((c) => <option key={c.id} value={c.id}>{c.name.tr}</option>)}
          </select>
        </label>
        <span data-testid="effective">etkin: {q}</span>
        <span data-testid="selection" style={{ color: "#ff6a1a" }}>{selected ? JSON.stringify(selected) : "seçim yok"}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {map && (
          q === "lite"
            ? <CityMap2D world={world} map={map} serverOffsetMs={0} quality="lite" myCompanyId={ME} focusCityId={focus} selected={selected} onSelect={sel} locale={locale} myLevel={2} />
            : <CityViewLazy world={world} map={map} serverOffsetMs={0} quality={q} myCompanyId={ME} focusCityId={focus} selected={selected} onSelect={sel} locale={locale} myLevel={2} />
        )}
      </div>
    </main>
  );
}
