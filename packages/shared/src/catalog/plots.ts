import { CITIES } from "./cities";
import type { PlotDef } from "./types";

/** Deterministik küçük RNG (mulberry32). Arsalar her kurulumda aynı üretilir. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Maden yatakları: şehir → (ızgara indeksi → yatak) */
const DEPOSITS: Record<string, Record<number, { kind: "iron" | "coal"; richnessBp: number }>> = {
  demirdag: {
    0: { kind: "iron", richnessBp: 10000 }, 1: { kind: "coal", richnessBp: 10000 },
    2: { kind: "iron", richnessBp: 10500 }, 3: { kind: "coal", richnessBp: 9500 },
    4: { kind: "coal", richnessBp: 10500 }, 7: { kind: "iron", richnessBp: 9500 },
    5: { kind: "iron", richnessBp: 12500 }, 10: { kind: "coal", richnessBp: 12500 },
  },
  kavsak: { 8: { kind: "coal", richnessBp: 9000 }, 14: { kind: "coal", richnessBp: 9500 } },
  akyayla: { 1: { kind: "iron", richnessBp: 9000 }, 13: { kind: "iron", richnessBp: 9500 } },
};

const BASE_LAND = 1_800_000; // kuruş: ₺18.000

function roundTo(v: number, step: number): number {
  return Math.round(v / step) * step;
}

export function generatePlots(): PlotDef[] {
  const out: PlotDef[] = [];
  CITIES.forEach((city, ci) => {
    const r = rng(9001 + ci * 131);
    for (let gz = 0; gz < 4; gz++) {
      for (let gx = 0; gx < 4; gx++) {
        const i = gz * 4 + gx;
        const inner = gx >= 1 && gx <= 2 && gz >= 1 && gz <= 2;
        const corner = (gx === 0 || gx === 3) && (gz === 0 || gz === 3);
        const minLevel = inner ? (i % 2 === 0 ? 3 : 2) : corner ? 2 : 1;
        const tierMult = minLevel === 1 ? 1 : minLevel === 2 ? 1.8 : 3;
        const sizeHa = 8 + Math.floor(r() * 13);
        const fertilityBp = Math.round(((city.sectorYieldBp.crop ?? 10000) * (0.88 + r() * 0.24)));
        const pastureBp = Math.round(((city.sectorYieldBp.livestock ?? 10000) * (0.88 + r() * 0.24)));
        const deposit = DEPOSITS[city.id]?.[i] ?? null;
        const distanceToCenterKm = inner ? 2 + Math.floor(r() * 3) : 6 + Math.floor(r() * 9);
        const qualityAdj = 1 + ((fertilityBp + pastureBp) / 2 - 10000) / 25000;
        const depositPremium = deposit ? (deposit.richnessBp / 10000) * 1_000_000 : 0;
        const price = roundTo(
          BASE_LAND * (city.landPriceBp / 10000) * tierMult * qualityAdj * (0.85 + sizeHa / 60) + depositPremium,
          50_000,
        );
        out.push({
          id: `${city.id}-${gx}${gz}`, cityId: city.id, gx, gz, price, minLevel, sizeHa,
          fertilityBp, pastureBp, deposit, distanceToCenterKm,
        });
      }
    }
  });
  return out;
}

export const PLOTS: PlotDef[] = generatePlots();
