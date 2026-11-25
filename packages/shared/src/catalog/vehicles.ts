import type { VehicleModelDef } from "./types";

export const VEHICLE_MODELS: VehicleModelDef[] = [
  {
    id: "van", name: { tr: "Kamyonet", en: "Van" }, capacityKg: 3000, speedKmh: 80, fuelPerKm: 1200,
    price: 6_000_000, upkeepPerDay: 15_000, minCompanyLevel: 1, minGarageLevel: 1,
  },
  {
    id: "truck", name: { tr: "Kamyon", en: "Truck" }, capacityKg: 12000, speedKmh: 65, fuelPerKm: 2500,
    price: 18_000_000, upkeepPerDay: 30_000, minCompanyLevel: 1, minGarageLevel: 1,
  },
  {
    id: "semi", name: { tr: "Tır", en: "Semi-trailer" }, capacityKg: 25000, speedKmh: 60, fuelPerKm: 3800,
    price: 38_000_000, upkeepPerDay: 55_000, minCompanyLevel: 3, minGarageLevel: 2,
  },
];

/** Garajı olmayan şirketler de en fazla bu kadar kamyonet tutabilir (park yeri kiralama). */
export const VEHICLES_WITHOUT_GARAGE = 1;
