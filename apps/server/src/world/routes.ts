import type { FastifyInstance } from "fastify";
import { eq, inArray, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import {
  INDUSTRIES, QUALITY_PRICE_BP, ROAD_LIST, depositFits, SYSTEM_PROFILES, roadDistanceKm, sector as sectorSchema,
  type OnboardingDto, type PlotDto, type VehicleMapDto, type WorldDto, type WorldMapDto, type FacilityMapDto,
} from "@capitalforge/shared";
import { planProduction, systemBid } from "@capitalforge/economy";
import { companies, facilities, plots, priceRefs, productionJobs, shipmentCargo, shipments, vehicles } from "../db/schema";
import type { Deps } from "../deps";
import { route } from "../http/route";
import type { Catalog } from "../catalog/catalog";
import { starterBuildingFor, starterInputsKey } from "../company/found";
import { m } from "../lib/serialize";
import { paceDuration, paceMax, paceTravelScaleBp, playtestSeconds } from "../catalog/pace";

/** kesirli dakika → "45 sn" / "12 dk" (oyun testi kipinde kısa süreler) */
const durText = (min: number, l: "tr" | "en"): string => {
  const sec = Math.round(min * 60);
  if (sec < 60) return l === "tr" ? `${sec} sn` : `${sec} s`;
  const mm = Math.round(sec / 60);
  return l === "tr" ? `${mm} dk` : `${mm} min`;
};

export function worldDto(cat: Catalog, now: Date): WorldDto {
  const s = cat.settings;
  return {
    serverTime: now.toISOString(),
    cities: [...cat.cities.values()].map((c) => ({
      id: c.id, name: c.name, blurb: c.blurb, map: c.map, color: c.color,
      energyPrice: m(c.energyPrice), waterPrice: m(c.waterPrice), wage: m(c.wage),
      laborNote: c.labor.note, laborAvailability: c.labor.availability, sectorYieldBp: c.sectorYieldBp,
    })),
    roads: ROAD_LIST.map(([a, b, km]) => ({ a, b, km })),
    products: [...cat.products.values()].map((p) => ({ id: p.id, name: p.name, category: p.category, color: p.color, basePricePerKg: m(p.basePricePerKg), industry: p.industry ?? null, stage: p.stage ?? null })),
    buildingTypes: [...cat.buildingTypes.values()].map((b) => ({
      id: b.id, sector: b.sector, name: b.name, buildCost: m(b.buildCost), buildSteelKg: b.buildSteelKg, buildMinutes: paceDuration(cat, b.buildMinutes),
      levels: b.levels.map((l) => ({ ...l, upgradeMinutes: paceDuration(cat, l.upgradeMinutes), upkeepPerDay: m(l.upkeepPerDay), upgradeCost: m(l.upgradeCost) })),
      qualityUpgradeCosts: b.qualityUpgradeCosts.map(m), vehicleSlots: b.vehicleSlots, requiresDeposit: b.requiresDeposit,
      deposits: b.deposits ?? null, industry: b.industry ?? null, archetype: b.archetype ?? null, tier: b.tier ?? 1, minCompanyLevel: b.minCompanyLevel ?? 1, description: b.description ?? null,
    })),
    recipes: [...cat.recipes.values()].map((r) => ({ ...r, minutes: paceDuration(cat, r.minutes) })),
    research: [...cat.research.values()].map((r) => ({
      id: r.id, name: r.name, description: r.description, maxLevel: r.maxLevel, baseCost: m(r.baseCost), baseMinutes: paceDuration(cat, r.baseMinutes), effect: r.effect,
      branch: r.branch ?? null, prerequisites: r.prerequisites ?? [],
    })),
    systemDemand: SYSTEM_PROFILES.flatMap((p) => [
      ...Object.entries(p.buys).map(([productId, dailyKg]) => ({ productId, cityId: p.cityId, side: "buy" as const, dailyKg, companyName: p.name })),
      ...Object.entries(p.sells).map(([productId, dailyKg]) => ({ productId, cityId: p.cityId, side: "sell" as const, dailyKg, companyName: p.name })),
    ]).filter((d) => cat.products.has(d.productId) && cat.cities.has(d.cityId)),
    industries: [...INDUSTRIES],
    vehicleModels: [...cat.vehicleModels.values()].map((v) => ({ ...v, fuelPerKm: m(v.fuelPerKm), price: m(v.price), upkeepPerDay: m(v.upkeepPerDay) })),
    levelXp: [...s.levelXp],
    marketFeeBp: s.marketFeeBp,
    qualityPriceBp: [...QUALITY_PRICE_BP],
    freight: { systemBaseFee: m(s.freight.systemBaseFee), systemPerKm: m(s.freight.systemPerKm), driverHoursPerTrip: s.freight.driverHoursPerTrip },
    pace: { maxMinutes: paceMax(cat), travelScaleBp: paceTravelScaleBp(cat), playtestSeconds: playtestSeconds(cat) },
    startingCash: m(s.startingCash),
  };
}

type PlotRow = typeof plots.$inferSelect;

function plotDto(p: PlotRow, owner: { id: string; name: string; isSystem: boolean } | null, building: FacilityMapDto | null): PlotDto {
  return {
    id: p.id, cityId: p.cityId, gx: p.gx, gz: p.gz, price: m(p.price), minLevel: p.minLevel, sizeHa: p.sizeHa,
    fertilityBp: p.fertilityBp, pastureBp: p.pastureBp,
    deposit: p.depositKind ? { kind: p.depositKind, richnessBp: p.depositRichnessBp ?? 10000 } : null,
    distanceToCenterKm: p.distanceToCenterKm,
    owner: owner ? { companyId: owner.id, companyName: owner.name, isSystem: owner.isSystem } : null,
    building,
  };
}

export async function loadPlots(deps: Deps, cityId?: string): Promise<PlotDto[]> {
  const now = deps.clock.now();
  const ps = await deps.db.select().from(plots).where(cityId ? eq(plots.cityId, cityId) : undefined).orderBy(plots.id);
  const fac = await deps.db.select().from(facilities).where(ne(facilities.state, "demolished"));
  const cos = await deps.db.select({ id: companies.id, name: companies.name, isSystem: companies.isSystem }).from(companies).where(isNull(companies.dissolvedAt));
  const running = await deps.db
    .select({ facilityId: productionJobs.facilityId, endsAt: productionJobs.endsAt, recipeId: productionJobs.recipeId })
    .from(productionJobs)
    .where(eq(productionJobs.status, "running"));
  const coMap = new Map(cos.map((c) => [c.id, c]));
  const facByPlot = new Map(fac.map((f) => [f.plotId, f]));
  const runByFac = new Map<string, Date>();
  const productByFac = new Map<string, string>();
  for (const r of running) {
    const cur = runByFac.get(r.facilityId);
    if (!cur || r.endsAt < cur) {
      runByFac.set(r.facilityId, r.endsAt);
      const recipe = deps.catalog.recipes.get(r.recipeId);
      if (recipe) productByFac.set(r.facilityId, recipe.output.productId);
    }
  }
  return ps.map((p) => {
    const f = facByPlot.get(p.id);
    let b: FacilityMapDto | null = null;
    if (f) {
      const until = runByFac.get(f.id) ?? null;
      const status: FacilityMapDto["status"] =
        f.state === "constructing" && f.constructionEndsAt && f.constructionEndsAt > now ? "constructing"
          : f.upgradeEndsAt && f.upgradeEndsAt > now ? "upgrading"
            : until ? "working" : f.stalledReason ? "stalled" : "idle";
      b = {
        id: f.id, type: f.type, level: f.level, qualityLevel: f.qualityLevel, status,
        activeUntil: (until ?? (status === "constructing" ? f.constructionEndsAt : status === "upgrading" ? f.upgradeEndsAt : null))?.toISOString() ?? null,
        ownerCompanyId: f.companyId,
        outputProductId: productByFac.get(f.id) ?? null,
      };
    }
    const o = p.ownerCompanyId ? coMap.get(p.ownerCompanyId) ?? null : null;
    return plotDto(p, o, b);
  });
}

export function registerWorldRoutes(app: FastifyInstance, deps: Deps): void {
  route(app, deps, {
    method: "GET", url: "/world", auth: "none",
    handler: async () => worldDto(deps.catalog, deps.clock.now()),
  });

  route(app, deps, {
    method: "GET", url: "/world/plots", auth: "none", body: z.object({ cityId: z.string().max(40).optional() }),
    handler: async ({ body }) => ({ plots: await loadPlots(deps, body.cityId) }),
  });

  route(app, deps, {
    method: "GET", url: "/world/map", auth: "none",
    handler: async ({ company }): Promise<WorldMapDto> => {
      const now = deps.clock.now();
      const ps = await loadPlots(deps);
      const vs = await deps.db
        .select({ v: vehicles, owner: companies.name })
        .from(vehicles)
        .innerJoin(companies, eq(companies.id, vehicles.companyId))
        .where(ne(vehicles.status, "sold"));
      const shipIds = vs.map((x) => x.v.currentShipmentId).filter((x): x is string => !!x);
      const ships = shipIds.length ? await deps.db.select().from(shipments).where(inArray(shipments.id, shipIds)) : [];
      const cargo = shipIds.length ? await deps.db.select().from(shipmentCargo).where(inArray(shipmentCargo.shipmentId, shipIds)) : [];
      const myId = company?.id ?? null;
      const out: VehicleMapDto[] = vs.map(({ v, owner }) => {
        const sh = ships.find((s) => s.id === v.currentShipmentId && s.status === "in_transit") ?? null;
        const lines = sh ? cargo.filter((c) => c.shipmentId === sh.id) : [];
        const canSee = !!myId && (v.companyId === myId || lines.some((l) => l.ownerCompanyId === myId || l.consigneeCompanyId === myId));
        return {
          id: v.id, modelId: v.modelId, ownerCompanyId: v.companyId, ownerName: owner, isMine: v.companyId === myId,
          status: sh ? "in_transit" : "idle",
          cityId: sh ? null : v.cityId,
          shipment: sh
            ? {
                id: sh.id, originCityId: sh.originCityId, destCityId: sh.destCityId,
                departedAt: sh.departedAt.toISOString(), arrivesAt: sh.arrivesAt.toISOString(),
                cargo: canSee ? lines.map((l) => ({ productId: l.productId, quality: l.quality, qtyKg: l.qtyKg })) : null,
                totalKg: lines.reduce((a, l) => a + l.qtyKg, 0),
              }
            : null,
        };
      });
      return { serverTime: now.toISOString(), plots: ps, vehicles: out };
    },
  });

  route(app, deps, {
    method: "GET", url: "/world/onboarding", auth: "none",
    body: z.object({ cityId: z.string().max(40), sector: sectorSchema, starterBuilding: z.enum(["food_plant", "steel_mill"]).optional() }),
    handler: async ({ body }): Promise<OnboardingDto> => onboarding(deps, body.cityId, body.sector, body.starterBuilding),
  });
}

async function onboarding(deps: Deps, cityId: string, sector: z.infer<typeof sectorSchema>, choice?: "food_plant" | "steel_mill"): Promise<OnboardingDto> {
  const cat = deps.catalog;
  const s = cat.settings;
  const city = cat.city(cityId);
  const building = starterBuildingFor(sector, choice);
  const bt = cat.buildingType(building);
  const cash = BigInt(s.startingCash);
  const refs = await deps.db.select().from(priceRefs);
  const ref = (productId: string, c: string) => refs.find((r) => r.productId === productId && r.cityId === c)?.refPricePerKg ?? BigInt(cat.product(productId).basePricePerKg);
  const recipes = cat.recipesFor(building);
  const outputs = [...new Set(recipes.map((r) => r.output.productId))];
  const inputsNeeded = [...new Set(recipes.flatMap((r) => r.inputs.map((i) => i.productId)))];
  const cities = [...cat.cities.values()];
  const nearestBuyers = outputs.flatMap((pid) =>
    SYSTEM_PROFILES.filter((p) => (p.buys[pid] ?? 0) > 0)
      .map((p) => ({ productId: pid, cityId: p.cityId, km: roadDistanceKm(cityId, p.cityId), companyName: p.name.tr }))
      .sort((a, b) => a.km - b.km)
      .slice(0, 3),
  );
  const nearestSupply = inputsNeeded.flatMap((pid) =>
    cities
      .filter((c) => SYSTEM_PROFILES.some((p) => p.cityId === c.id && (p.sells[pid] ?? 0) > 0))
      .map((c) => ({ productId: pid, cityId: c.id, km: roadDistanceKm(cityId, c.id) }))
      .sort((a, b) => a.km - b.km)
      .slice(0, 3),
  );
  const ps = await loadPlots(deps, cityId);
  const plotsOut = ps.map((p) => {
    const reasons: OnboardingDto["plots"][number]["reasons"] = [];
    if (p.owner) reasons.push("PLOT_TAKEN");
    if (p.minLevel > 1) reasons.push("LEVEL_TOO_LOW");
    if (BigInt(p.price) > cash) reasons.push("INSUFFICIENT_FUNDS");
    if (!depositFits(bt, p.deposit?.kind)) reasons.push("DEPOSIT_REQUIRED");
    return { ...p, eligible: reasons.length === 0, reasons, nearestSupply, nearestBuyers };
  });

  // İlk iş tahmini: sektörün ilk tarifi (madende arsadaki yatak), en iyi uygun arsa ile
  const firstEligible = plotsOut.find((p) => p.eligible) ?? null;
  const recipe =
    sector === "mining"
      ? recipes.find((r) => r.deposit === (firstEligible?.deposit?.kind ?? "iron")) ?? recipes[0]
      : recipes[0];
  let firstJob: OnboardingDto["starter"]["firstJob"] = {
    estCost: "0", estRevenue: "0", minutes: 0,
    hint: { tr: "Taşıma panosundan ilk işini al, yükü varış şehrine götür, ücret teslimde ödenir.", en: "Take your first job from the freight board, haul it to the destination and get paid on delivery." },
  };
  if (recipe && sector !== "freight") {
    const plotYield = sector === "crop" ? firstEligible?.fertilityBp ?? 10000 : sector === "livestock" ? firstEligible?.pastureBp ?? 10000 : sector === "mining" ? firstEligible?.deposit?.richnessBp ?? 10000 : 10000;
    const cityYield = sector === "crop" || sector === "livestock" ? 10000 : city.sectorYieldBp[sector] ?? 10000;
    const plan0 = planProduction(recipe, {
      batches: 1, plotYieldBp: plotYield, cityYieldBp: cityYield, researchYieldBp: 0, researchEfficiencyBp: 0,
      facilityQualityLevel: 1, researchQualityLevels: 0, laborAvailabilityBp: city.labor.availability, inputLots: [],
      prices: { energyPerKwh: BigInt(city.energyPrice), waterPerM3: BigInt(city.waterPrice), wagePerHour: BigInt(city.wage) },
    });
    const plan = { ...plan0, minutes: paceDuration(cat, plan0.minutes) };
    const inputCost = plan.inputs.reduce((a, i) => a + ref(i.productId, cityId) * BigInt(i.kg), 0n);
    const cost = inputCost + plan.energyCost + plan.waterCost + plan.laborCost;
    const buyer = nearestBuyers.find((b) => b.productId === recipe.output.productId);
    const bid = buyer ? systemBid(ref(recipe.output.productId, buyer.cityId), s.system.bidBp, 0, 1, null) : ref(recipe.output.productId, cityId);
    firstJob = {
      recipeId: recipe.id,
      estCost: m(cost),
      estRevenue: m(bid * BigInt(plan.outputKg)),
      minutes: plan.minutes,
      hint: {
        tr: `${recipe.name.tr}: ${durText(plan.minutes, "tr")} sürer. Çıktıyı ${buyer ? cat.city(buyer.cityId).name.tr : city.name.tr} pazarına satabilirsin.`,
        en: `${recipe.name.en}: takes ${durText(plan.minutes, "en")}. Sell the output in ${buyer ? cat.city(buyer.cityId).name.en : city.name.en}.`,
      },
    };
  }
  return {
    startingCash: m(cash),
    plots: plotsOut,
    starter: {
      building,
      vehicle: sector === "freight" ? "truck" : undefined,
      inputs: s.starterInputs[starterInputsKey(sector, building)] ?? [],
      firstJob,
    },
  };
}


