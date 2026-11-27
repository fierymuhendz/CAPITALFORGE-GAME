import { CITIES } from "./cities";
import type { DepositKind, PlotDef } from "./types";

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
const DEPOSITS: Record<string, Record<number, { kind: DepositKind; richnessBp: number }>> = {
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

/**
 * v4 dış halka: her şehirde mevcut 4×4 ızgaranın çevresindeki 20 hücre (gx/gz −1..4). Mevcut arsaların kimliği,
 * koordinatı, fiyatı ve sahipliği değişmez; yeni arsalar ayrı RNG ile, `<şehir>-o<gx+1><gz+1>` kimliğiyle eklenir.
 * Yeni yataklar (bakır, kireçtaşı, kil, kum, tuz) yalnızca bu halkada.
 */
const RING_DEPOSITS: Record<string, Array<{ kind: DepositKind; richnessBp: number }>> = {
  demirdag: [
    { kind: "copper", richnessBp: 11000 }, { kind: "copper", richnessBp: 9500 }, { kind: "copper", richnessBp: 10000 },
    { kind: "limestone", richnessBp: 10500 }, { kind: "limestone", richnessBp: 9500 }, { kind: "clay", richnessBp: 10000 },
    { kind: "iron", richnessBp: 10000 }, { kind: "coal", richnessBp: 10000 }, { kind: "salt", richnessBp: 9000 },
  ],
  kavsak: [
    { kind: "limestone", richnessBp: 10000 }, { kind: "limestone", richnessBp: 11000 }, { kind: "sand", richnessBp: 10000 },
    { kind: "sand", richnessBp: 9500 }, { kind: "clay", richnessBp: 10500 },
  ],
  akyayla: [{ kind: "copper", richnessBp: 9000 }, { kind: "clay", richnessBp: 10000 }, { kind: "limestone", richnessBp: 9500 }],
  korfezkent: [
    { kind: "sand", richnessBp: 11000 }, { kind: "sand", richnessBp: 10000 }, { kind: "salt", richnessBp: 11000 },
    { kind: "salt", richnessBp: 10000 }, { kind: "clay", richnessBp: 9500 },
  ],
  yesilova: [{ kind: "clay", richnessBp: 11000 }, { kind: "clay", richnessBp: 10000 }, { kind: "sand", richnessBp: 9500 }, { kind: "limestone", richnessBp: 10000 }],
};

export function ringCells(): Array<{ gx: number; gz: number }> {
  const out: Array<{ gx: number; gz: number }> = [];
  for (let gz = -1; gz <= 4; gz++) for (let gx = -1; gx <= 4; gx++) if (gx < 0 || gx > 3 || gz < 0 || gz > 3) out.push({ gx, gz });
  return out;
}

export function generateRingPlots(): PlotDef[] {
  const out: PlotDef[] = [];
  CITIES.forEach((city, ci) => {
    const r = rng(42_017 + ci * 977);
    const deps = RING_DEPOSITS[city.id] ?? [];
    ringCells().forEach(({ gx, gz }, i) => {
      const corner = (gx === -1 || gx === 4) && (gz === -1 || gz === 4);
      const minLevel = corner ? 2 : 1;
      const sizeHa = 10 + Math.floor(r() * 15);
      const fertilityBp = Math.round((city.sectorYieldBp.crop ?? 10000) * (0.85 + r() * 0.25));
      const pastureBp = Math.round((city.sectorYieldBp.livestock ?? 10000) * (0.85 + r() * 0.25));
      // yataklar halka boyunca aralıklı dağıtılır (her 2. hücre)
      const deposit = i % 2 === 1 ? deps[(i - 1) / 2] ?? null : null;
      const distanceToCenterKm = 12 + Math.floor(r() * 8);
      const qualityAdj = 1 + ((fertilityBp + pastureBp) / 2 - 10000) / 25000;
      const depositPremium = deposit ? (deposit.richnessBp / 10000) * 800_000 : 0;
      const price = roundTo(BASE_LAND * (city.landPriceBp / 10000) * (corner ? 1.4 : 0.85) * qualityAdj * (0.85 + sizeHa / 60) + depositPremium, 50_000);
      out.push({ id: `${city.id}-o${gx + 1}${gz + 1}`, cityId: city.id, gx, gz, price, minLevel, sizeHa, fertilityBp, pastureBp, deposit, distanceToCenterKm });
    });
  });
  return out;
}

export const PLOTS: PlotDef[] = [...generatePlots(), ...generateRingPlots()];
