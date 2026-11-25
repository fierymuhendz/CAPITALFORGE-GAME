/**
 * 3D sahne ve 2D harita için ortak yerleşim. Saf fonksiyonlar: three veya DOM kullanmaz.
 * Dünya birimi: 1 birim = 10 km. Hiçbir oyun sayısı hesaplanmaz; yalnızca konum.
 */
import { transitProgress } from "@capitalforge/economy";
import type { VehicleMapDto, WorldDto } from "@capitalforge/shared";

export const WORLD_SCALE = 0.1;
/** arsa hücre boyu (dünya birimi) */
export const CELL = 1.5;
/** şehir zemininin yarı genişliği */
export const PAD_HALF = 3.35;
export const HIGHWAY_WIDTH = 0.5;
export const LANE_OFFSET = 0.11;

export interface Pt { x: number; z: number }

export type CityCenters = Map<string, Pt>;

/** Şehir merkezleri: katalog km konumları ölçeklenir, ülke merkezi orijine alınır. */
export function cityCenters(world: Pick<WorldDto, "cities">): CityCenters {
  const out: CityCenters = new Map();
  if (world.cities.length === 0) return out;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const c of world.cities) {
    minX = Math.min(minX, c.map.x); maxX = Math.max(maxX, c.map.x);
    minZ = Math.min(minZ, c.map.z); maxZ = Math.max(maxZ, c.map.z);
  }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  for (const c of world.cities) out.set(c.id, { x: (c.map.x - cx) * WORLD_SCALE, z: (c.map.z - cz) * WORLD_SCALE });
  return out;
}

/** Arsa yerel konumu (şehir merkezine göre) */
export function plotOffset(gx: number, gz: number): Pt {
  return { x: (gx - 1.5) * CELL, z: (gz - 1.5) * CELL };
}

function padEdge(dir: Pt): number {
  const m = Math.max(Math.abs(dir.x), Math.abs(dir.z));
  return m === 0 ? 0 : PAD_HALF / m;
}

/** Otoyolun şehir zemini kenarındaki uçları (a'dan b'ye) */
export function roadEndpoints(a: Pt, b: Pt): { from: Pt; to: Pt; dir: Pt; len: number } {
  const dx = b.x - a.x, dz = b.z - a.z;
  const d = Math.hypot(dx, dz) || 1;
  const u = { x: dx / d, z: dz / d };
  const ta = padEdge(u), tb = padEdge(u);
  const from = { x: a.x + u.x * ta, z: a.z + u.z * ta };
  const to = { x: b.x - u.x * tb, z: b.z - u.z * tb };
  return { from, to, dir: u, len: Math.max(0, Math.hypot(to.x - from.x, to.z - from.z)) };
}

export interface VehiclePose { x: number; z: number; heading: number; moving: boolean }

/** Park yeri: şehir zemininin güney kenarı dışında sıralar */
export function parkingSlot(center: Pt, index: number): Pt {
  const perRow = 10;
  const row = Math.floor(index / perRow);
  const col = index % perRow;
  return { x: center.x - PAD_HALF + 0.45 + col * 0.6, z: center.z + PAD_HALF + 0.55 + row * 0.6 };
}

/**
 * Araç konumu. Yoldakiler transitProgress ile (sunucuyla aynı formül); diğerleri park yerinde.
 * parkIndex: aynı şehirde park eden araçlar arasındaki sıra.
 */
export function vehiclePose(
  v: VehicleMapDto, centers: CityCenters, nowMs: number, parkIndex: number,
): VehiclePose | null {
  const s = v.shipment;
  if (v.status === "in_transit" && s) {
    const a = centers.get(s.originCityId), b = centers.get(s.destCityId);
    if (!a || !b) return null;
    const p = transitProgress(Date.parse(s.departedAt), Date.parse(s.arrivesAt), nowMs);
    const r = roadEndpoints(a, b);
    // sağ şerit
    const px = -r.dir.z * LANE_OFFSET, pz = r.dir.x * LANE_OFFSET;
    return {
      x: r.from.x + (r.to.x - r.from.x) * p + px,
      z: r.from.z + (r.to.z - r.from.z) * p + pz,
      heading: Math.atan2(r.dir.x, r.dir.z),
      moving: p < 1,
    };
  }
  const city = v.cityId ? centers.get(v.cityId) : undefined;
  if (!city) return null;
  const slot = parkingSlot(city, parkIndex);
  return { x: slot.x, z: slot.z, heading: Math.PI / 2, moving: false };
}

/** Araçları şehir başına park sırasına dizer (kararlı: kimliğe göre sıralı) */
export function parkIndexes(vehicles: VehicleMapDto[]): Map<string, number> {
  const byCity = new Map<string, string[]>();
  for (const v of vehicles) {
    if (v.status === "in_transit" && v.shipment) continue;
    if (!v.cityId) continue;
    const arr = byCity.get(v.cityId) ?? [];
    arr.push(v.id);
    byCity.set(v.cityId, arr);
  }
  const out = new Map<string, number>();
  for (const ids of byCity.values()) {
    ids.sort();
    ids.forEach((id, i) => out.set(id, i));
  }
  return out;
}

/** Ülke sınırı (kamera ve harita için) */
export function worldBounds(centers: CityCenters): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const c of centers.values()) {
    minX = Math.min(minX, c.x - PAD_HALF); maxX = Math.max(maxX, c.x + PAD_HALF);
    minZ = Math.min(minZ, c.z - PAD_HALF); maxZ = Math.max(maxZ, c.z + PAD_HALF + 1.4);
  }
  if (!isFinite(minX)) return { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };
  return { minX, maxX, minZ, maxZ };
}

/** Basit karma: renk üretimi için kararlı sayı */
export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
