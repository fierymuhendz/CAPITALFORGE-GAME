/**
 * Bina geometrileri (tür × seviye). Statik parçalar tek birleşik geometri;
 * animasyonlu parçalar (duman, tekerlek, parıltı) veri olarak döner, motor örnekler.
 */
import type { BufferGeometry } from "three";
import { PartBuilder } from "./geo";
import { DEPOSIT_COLOR, PAL } from "./palette";
import { mulberry } from "./layout";

export interface BuildingDef {
  geometry: BufferGeometry;
  /** üst yükseklik (uyarı işareti ve halka için) */
  height: number;
  smoke: Array<{ x: number; y: number; z: number; dark: boolean }>;
  glows: Array<{ w: number; h: number; d: number; x: number; y: number; z: number }>;
  lamps: Array<{ x: number; y: number; z: number; s: number }>;
  wheels: Array<{ x: number; y: number; z: number; r: number }>;
  fans: Array<{ x: number; y: number; z: number; r: number }>;
  tractor: boolean;
  shutter: null | { w: number; h: number; x: number; y: number; z: number };
}

/** İlk 6 bina türü: görünümleri sabit, tür kimliğiyle çizilir. Diğerleri tanımdaki arketiple çizilir. */
export const LEGACY_TYPE_IDS = ["field", "barn", "mine", "food_plant", "steel_mill", "garage"] as const;
const LEGACY = new Set<string>(LEGACY_TYPE_IDS);
const GLASS = "#cfeee9";

/** Dikdörtgen çerçeve (dış/iç ölçü); çukur ve teras kenarları için */
function ring(b: PartBuilder, o: number, i: number, h: number, y: number, color: string): void {
  const t = (o - i) / 2, m = (o + i) / 4;
  b.box(o, h, t, 0, y, -m, color); b.box(o, h, t, 0, y, m, color);
  b.box(t, h, i, -m, y, 0, color); b.box(t, h, i, m, y, 0, color);
}

function empty(): Omit<BuildingDef, "geometry" | "height"> {
  return { smoke: [], glows: [], lamps: [], wheels: [], fans: [], tractor: false, shutter: null };
}

/**
 * @param archetype bina tanımındaki silüet (ilk 6 tür için yok sayılır)
 * @param bandIn iş kolu rengi (çatı/bant); ilk 6 tür için yok sayılır
 */
export function buildDef(type: string, level: number, accent: string, archetype?: string | null, bandIn?: string): BuildingDef {
  const b = new PartBuilder();
  const legacy = LEGACY.has(type);
  const key = legacy ? type : (archetype ?? type);
  const band = legacy ? undefined : bandIn;
  const bc = band ?? PAL.concrete;
  const extra = empty();
  let height = 0.5;
  const L = Math.max(1, Math.min(3, level));
  const cropColor = accent;

  switch (key) {
    case "field": {
      b.box(1.12, 0.04, 1.12, 0, 0, 0, PAL.soil);
      const rows = 4 + L;
      const rh = 0.07 + L * 0.02;
      for (let i = 0; i < rows; i++) {
        const x = -0.45 + (0.9 / (rows - 1)) * i;
        b.box(0.075, rh, 0.95, x, 0.04, 0, i % 2 ? cropColor : shade(cropColor, 0.78));
      }
      if (L >= 2) { b.box(0.3, 0.2, 0.22, 0.38, 0.04, 0.47, PAL.concrete); b.gable(0.34, 0.12, 0.26, 0.38, 0.24, 0.47, PAL.roofDark); }
      if (L >= 3) { b.cyl(0.07, 0.07, 0.42, -0.44, 0.04, 0.46, PAL.steel); b.cyl(0.14, 0.14, 0.1, -0.44, 0.46, 0.46, PAL.concrete); height = 0.6; }
      if (band) { b.box(0.03, 0.34, 0.03, -0.5, 0.04, 0.5, PAL.steel); b.box(0.16, 0.09, 0.02, -0.42, 0.28, 0.5, band); }
      extra.tractor = true;
      height = Math.max(height, 0.4);
      break;
    }
    case "barn": {
      const s = 1 + (L - 1) * 0.12;
      b.box(0.9, 0.04, 1.0, 0, 0, 0, PAL.concrete);
      b.box(0.6 * s, 0.34 * s, 0.82 * s, -0.12, 0.04, 0, PAL.barnRed);
      b.box(0.62 * s, 0.03, 0.04, -0.12, 0.2, 0.42 * s, PAL.white);
      b.gable(0.7 * s, 0.24 * s, 0.9 * s, -0.12, 0.38 * s, 0, PAL.roofDark);
      b.cyl(0.13, 0.13, 0.62 * s, 0.36, 0.04, -0.2, PAL.steel, 10);
      b.cone(0.14, 0.14, 0.36, 0.04 + 0.62 * s, -0.2, PAL.concrete, 10);
      if (L >= 2) { b.box(0.3, 0.24, 0.3, 0.3, 0.04, 0.06, PAL.barnRed); b.gable(0.34, 0.16, 0.34, 0.3, 0.28, 0.06, PAL.roofDark); }
      if (L >= 3) { b.cyl(0.11, 0.11, 0.5, 0.36, 0.04, -0.45, PAL.steel, 10); b.cone(0.12, 0.12, 0.36, 0.54, -0.45, PAL.concrete, 10); }
      // yem alanı çiti ve süt sığırları (beyaz gövde, siyah leke)
      const cows = 2 + L;
      for (let i = 0; i < cows; i++) {
        const cx = -0.36 + i * 0.2, cz = 0.46;
        b.box(0.16, 0.09, 0.08, cx, 0.07, cz, PAL.white);
        b.box(0.07, 0.05, 0.085, cx - 0.02, 0.1, cz, PAL.dark);
        b.box(0.05, 0.06, 0.06, cx + 0.1, 0.1, cz, PAL.white);
        for (const lx of [-0.05, 0.05]) b.box(0.02, 0.04, 0.02, cx + lx, 0.04, cz, "#3a3030");
      }
      if (band) b.box(0.72 * s, 0.03, 0.05, -0.12, 0.37 * s, 0.45 * s, band);
      extra.lamps.push({ x: -0.12, y: 0.2, z: 0.43 * s, s: 0.09 });
      height = 0.04 + 0.62 * s + 0.14;
      break;
    }
    case "mine": {
      const k = 1 + (L - 1) * 0.15;
      b.box(1.1, 0.05, 1.1, 0, 0, 0, "#3a3430");
      // kule ayakları
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.06, 0.95 * k, 0.06, sx * 0.14, 0.05, -0.1 + sz * 0.14, PAL.steel);
      b.box(0.36, 0.05, 0.36, 0, 0.55 * k, -0.1, PAL.dark);
      b.box(0.36, 0.05, 0.36, 0, 0.98 * k, -0.1, PAL.dark);
      b.box(0.3, 0.14, 0.3, 0, 1.0 * k, -0.1, band ?? PAL.forge);
      // cevher yığını
      b.cone(0.38, 0.4, -0.3, 0.05, 0.3, accent, 7);
      b.cone(0.26, 0.3, 0.02, 0.05, 0.4, shade(accent, 0.7), 7);
      b.box(0.16, 0.1, 0.12, 0.34, 0.07, 0.1, PAL.steel); // maden arabası
      b.box(0.14, 0.05, 0.1, 0.34, 0.17, 0.1, accent);
      // kule tepesinde A çatı
      b.gable(0.4, 0.16, 0.4, 0, 1.15 * k, -0.1, PAL.dark);
      b.box(0.5, 0.03, 0.08, 0.2, 0.05, 0.1, PAL.roofDark); // ray
      if (L >= 2) { b.box(0.34, 0.22, 0.3, 0.38, 0.05, 0.3, PAL.concrete); b.cone(0.26, 0.26, 0.34, 0.05, -0.34, accent, 7); }
      if (L >= 3) { b.box(0.7, 0.05, 0.1, 0.0, 0.3, 0.45, PAL.steel); b.cone(0.2, 0.22, -0.42, 0.05, -0.38, shade(accent, 0.6), 7); }
      extra.wheels.push({ x: 0, y: 0.98 * k + 0.2, z: -0.1 + 0.2, r: 0.17 });
      height = 1.3 * k;
      break;
    }
    case "food_plant":
    case "factory": {
      b.box(1.1, 0.04, 1.0, 0, 0, 0, PAL.concrete);
      b.box(0.8, 0.34, 0.55, -0.08, 0.04, 0.1, "#cfd8dc");
      b.box(0.82, 0.07, 0.57, -0.08, 0.2, 0.1, band ?? "#3a7bd5");
      for (let i = 0; i < 3; i++) b.gable(0.27, 0.13, 0.57, -0.28 + i * 0.27 + 0.0, 0.38, 0.1, PAL.roofDark);
      b.cyl(0.11, 0.11, 0.5, 0.42, 0.04, -0.28, PAL.white, 10);
      b.cone(0.115, 0.1, 0.42, 0.54, -0.28, PAL.steel, 10);
      b.cyl(0.11, 0.11, 0.42, 0.42, 0.04, 0.0, PAL.white, 10);
      b.cone(0.115, 0.1, 0.42, 0.46, 0.0, PAL.steel, 10);
      b.cyl(0.04, 0.05, 0.3, -0.38, 0.38, -0.12, PAL.steel);
      if (L >= 2) { b.box(0.5, 0.3, 0.3, -0.12, 0.04, -0.33, "#cfd8dc"); b.cyl(0.11, 0.11, 0.38, 0.2, 0.04, 0.38, PAL.white, 10); }
      if (L >= 3) { b.box(0.3, 0.46, 0.3, -0.38, 0.04, -0.33, "#b7c3cc"); b.cyl(0.11, 0.11, 0.34, 0.42, 0.04, 0.3, PAL.white, 10); }
      extra.smoke.push({ x: -0.38, y: 0.68, z: -0.12, dark: false });
      extra.fans.push({ x: -0.08, y: 0.55, z: 0.1, r: 0.1 });
      height = 0.7;
      break;
    }
    case "steel_mill": {
      b.box(1.1, 0.04, 1.0, 0, 0, 0, "#2a2f35");
      b.box(0.8, 0.3, 0.55, -0.1, 0.04, 0.1, "#3c4650");
      b.box(0.82, 0.04, 0.57, -0.1, 0.3, 0.1, PAL.dark);
      // fırın bloğu + koyu ağız
      b.box(0.38, 0.5, 0.36, 0.3, 0.04, -0.15, "#4b3a33");
      b.box(0.22, 0.2, 0.04, 0.3, 0.1, 0.04, "#140d0a");
      // baca (kırmızı-beyaz bantlı)
      const ch = 1.1 + (L - 1) * 0.12;
      b.cyl(0.075, 0.1, ch, -0.3, 0.04, -0.28, PAL.white, 10);
      for (let i = 0; i < 3; i++) b.cyl(0.08 - i * 0.004, 0.09 - i * 0.004, 0.1, -0.3, 0.3 + i * 0.3 * (ch / 1.1), -0.28, "#c0392b", 10);
      if (L >= 2) { b.cyl(0.06, 0.08, ch * 0.8, -0.08, 0.04, -0.34, PAL.white, 10); b.box(0.3, 0.26, 0.3, -0.4, 0.04, 0.42, "#3c4650"); }
      if (L >= 3) { b.box(0.3, 0.4, 0.34, 0.5, 0.04, 0.3, "#4b3a33"); b.box(0.2, 0.16, 0.04, 0.5, 0.1, 0.48, "#140d0a"); }
      // külçe yığını ve potalar
      for (let i = 0; i < 3; i++) for (let j = 0; j <= i; j++) b.box(0.14, 0.05, 0.07, -0.1 + (j - i / 2) * 0.16, 0.04 + (2 - i) * 0.05, 0.43, "#c5ced8");
      b.cyl(0.07, 0.05, 0.1, 0.12, 0.04, 0.42, "#e0702a", 8);
      extra.glows.push({ w: 0.2, h: 0.18, d: 0.03, x: 0.3, y: 0.2, z: 0.045 });
      if (L >= 3) extra.glows.push({ w: 0.18, h: 0.14, d: 0.03, x: 0.5, y: 0.18, z: 0.49 });
      extra.smoke.push({ x: -0.3, y: 0.04 + ch, z: -0.28, dark: true });
      if (L >= 2) extra.smoke.push({ x: -0.08, y: 0.04 + ch * 0.8, z: -0.34, dark: true });
      height = ch + 0.1;
      break;
    }
    case "quarry": {
      b.box(1.1, 0.05, 1.1, 0, 0, 0, "#7d776a");
      // basamaklı çukur: dıştan içe alçalan teraslar, dipte koyu zemin
      ring(b, 0.96, 0.74, 0.1, 0.05, "#a39b8a");
      ring(b, 0.74, 0.52, 0.07, 0.05, "#8c8577");
      b.box(0.52, 0.03, 0.52, -0.06, 0.05, -0.12, "#4a463e");
      b.box(0.52 - 0.12, 0.012, 0.52 - 0.12, -0.06, 0.08, -0.12, shade(accent, 0.55));
      // kırıcı: huni, gövde ve taşıma bandı
      b.box(0.3, 0.26, 0.26, 0.3, 0.05, 0.3, PAL.steel);
      b.cone(0.2, 0.18, 0.3, 0.31, 0.3, bc, 4);
      b.box(0.42, 0.04, 0.07, 0.32, 0.22, 0.04, PAL.dark);
      // taş yığınları
      b.cone(0.17, 0.24, -0.36, 0.05, 0.4, accent, 6);
      b.cone(0.12, 0.17, -0.18, 0.05, 0.44, shade(accent, 0.75), 6);
      if (L >= 2) { b.box(0.2, 0.16, 0.2, 0.0, 0.05, 0.42, PAL.concrete); b.cone(0.13, 0.2, 0.5, 0.05, 0.1, accent, 6); }
      if (L >= 3) { b.cyl(0.04, 0.05, 0.4, -0.44, 0.05, -0.42, PAL.steel); b.box(0.16, 0.05, 0.16, -0.44, 0.45, -0.42, bc); }
      extra.wheels.push({ x: 0.3, y: 0.34, z: 0.3 + 0.14, r: 0.1 });
      height = 0.45;
      break;
    }
    case "mill": {
      b.box(1.1, 0.04, 1.0, 0, 0, 0, PAL.concrete);
      b.box(0.5, 0.34, 0.5, -0.2, 0.04, 0.12, "#d6d9d2");
      b.box(0.52, 0.05, 0.52, -0.2, 0.3, 0.12, bc);
      b.gable(0.54, 0.16, 0.54, -0.2, 0.38, 0.12, PAL.roofDark, Math.PI / 2);
      // silo kümesi (bant renkli kapak)
      const silos = L >= 2 ? 3 : 2;
      for (let i = 0; i < silos; i++) {
        const sz = -0.3 + i * 0.28, sh = 0.58 + (i === 1 ? 0.12 : 0);
        b.cyl(0.115, 0.115, sh, 0.34, 0.04, sz, PAL.white, 10);
        b.cyl(0.118, 0.118, 0.05, 0.34, 0.04 + sh * 0.55, sz, bc, 10);
        b.cone(0.12, 0.1, 0.34, 0.04 + sh, sz, PAL.steel, 10);
      }
      b.box(0.04, 0.04, 0.7, 0.18, 0.5, -0.0, PAL.steel); // taşıyıcı boru
      b.box(0.3, 0.1, 0.18, -0.2, 0.04, -0.34, PAL.concrete); // yükleme rampası
      if (L >= 3) { b.box(0.26, 0.4, 0.26, -0.4, 0.04, -0.3, "#c5ccc8"); b.box(0.28, 0.04, 0.28, -0.4, 0.44, -0.3, bc); }
      extra.smoke.push({ x: -0.4, y: 0.48, z: 0.12, dark: false });
      extra.fans.push({ x: -0.2, y: 0.56, z: 0.12, r: 0.08 });
      height = 0.78;
      break;
    }
    case "kiln": {
      b.box(1.1, 0.04, 1.0, 0, 0, 0, "#3a3430");
      b.box(0.74, 0.3, 0.5, -0.06, 0.04, 0.1, "#8a7a6a");
      b.box(0.76, 0.05, 0.52, -0.06, 0.29, 0.1, bc);
      b.cone(0.28, 0.22, -0.06, 0.34, 0.1, "#5b4b40", 8); // kubbe
      b.box(0.34, 0.32, 0.3, 0.34, 0.04, -0.2, "#6b5a4d");
      b.box(0.2, 0.18, 0.04, 0.34, 0.08, -0.04, "#140d0a"); // ocak ağzı
      const ch = 0.9 + (L - 1) * 0.1;
      b.cyl(0.07, 0.095, ch, -0.34, 0.04, -0.28, "#7a6d62", 10);
      b.cyl(0.08, 0.08, 0.08, -0.34, 0.04 + ch - 0.1, -0.28, bc, 10);
      if (L >= 2) b.cyl(0.055, 0.075, ch * 0.75, -0.14, 0.04, -0.34, "#7a6d62", 10);
      if (L >= 3) b.box(0.28, 0.24, 0.26, -0.4, 0.04, 0.42, "#8a7a6a");
      // dizilmiş ürün paletleri
      for (let i = 0; i < 3; i++) b.box(0.14, 0.06, 0.1, -0.2 + i * 0.18, 0.04, 0.44, shade(accent, 0.9));
      extra.glows.push({ w: 0.16, h: 0.12, d: 0.03, x: 0.34, y: 0.17, z: -0.03 });
      extra.smoke.push({ x: -0.34, y: 0.04 + ch, z: -0.28, dark: true });
      height = ch + 0.1;
      break;
    }
    case "warehouse": {
      b.box(1.1, 0.04, 1.05, 0, 0, 0, "#6a727a");
      const w = 0.9, d = 0.62 + (L - 1) * 0.1;
      b.box(w, 0.2, d, 0, 0.04, -0.12, "#c9d0d4");
      b.gable(w + 0.06, 0.1, d + 0.06, 0, 0.24, -0.12, PAL.roofDark, 0);
      b.box(w + 0.07, 0.03, d + 0.07, 0, 0.23, -0.12, bc); // iş kolu bandı
      for (let i = 0; i < 3; i++) b.box(0.18, 0.13, 0.03, -0.28 + i * 0.28, 0.04, -0.12 + d / 2 + 0.005, PAL.dark); // yükleme kapıları
      b.box(0.9, 0.04, 0.16, 0, 0.04, -0.12 + d / 2 + 0.1, "#9aa3aa"); // rampa
      for (let i = 0; i < 2 + L; i++) b.box(0.1, 0.07, 0.08, -0.36 + i * 0.14, 0.04, 0.44, shade(accent === "-" ? "#c2a06a" : accent, 0.9));
      if (L >= 3) b.box(0.3, 0.14, 0.3, 0.38, 0.04, 0.4, "#c9d0d4");
      extra.shutter = { w: 0.18, h: 0.13, x: 0, y: 0.04, z: -0.12 + d / 2 + 0.02 };
      extra.lamps.push({ x: 0.36, y: 0.2, z: -0.12 + d / 2 + 0.02, s: 0.06 });
      height = 0.4;
      break;
    }
    case "greenhouse": {
      b.box(1.1, 0.04, 1.0, 0, 0, 0, "#8a8f7a");
      const bays = L >= 2 ? 3 : 2;
      const bw = 0.78 / bays;
      for (let i = 0; i < bays; i++) {
        const x = -0.39 + bw * (i + 0.5);
        b.cylZ(bw / 2, 0.8, x, 0.04, 0, GLASS, 8); // cam kemer (alt yarı zeminde kalır)
        b.box(bw, 0.03, 0.82, x, 0.0, 0, bc);
        for (let k = -1; k <= 1; k++) b.cylZ(bw / 2 + 0.008, 0.025, x, 0.04, k * 0.38, PAL.white, 8);
      }
      b.box(0.14, 0.08, 0.1, 0.46, 0.04, 0.44, PAL.concrete); // havalandırma kutusu
      b.cyl(0.05, 0.05, 0.16, 0.46, 0.04, -0.44, PAL.steel, 8); // su deposu
      if (L >= 3) b.box(0.2, 0.2, 0.2, -0.48, 0.04, 0.44, PAL.concrete);
      extra.fans.push({ x: 0.46, y: 0.15, z: 0.44, r: 0.05 });
      height = 0.04 + bw / 2 + 0.1;
      break;
    }
    case "orchard": {
      b.box(1.1, 0.04, 1.1, 0, 0, 0, "#5a6a3a");
      const n = L >= 3 ? 4 : 3;
      const step = 0.8 / (n - 1 || 1);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const x = -0.4 + i * step, z = -0.4 + j * step;
        b.cyl(0.02, 0.03, 0.14, x, 0.04, z, "#4a3a2c", 5);
        b.cone(0.1, 0.18, x, 0.14, z, (i + j) % 2 ? PAL.tree : PAL.treeDark, 6);
        if ((i * 3 + j) % 2 === 0) b.box(0.035, 0.035, 0.035, x + 0.05, 0.22, z + 0.03, band ?? accent); // meyve
      }
      b.box(0.14, 0.1, 0.2, 0.5, 0.04, 0.0, "#b08a5a"); // kasa
      height = 0.45;
      break;
    }
    case "forest": {
      b.box(1.1, 0.03, 1.1, 0, 0, 0, "#4f6a3e");
      const rnd = mulberry(77);
      const n = 7 + L * 2;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rnd() * 0.5, r = 0.12 + rnd() * 0.36;
        const x = Math.cos(a) * r, z = Math.sin(a) * r * 0.95, s = 0.85 + rnd() * 0.5;
        b.cyl(0.025, 0.035, 0.12 * s, x, 0.03, z, "#4a3a2c", 5);
        b.cone(0.15 * s, 0.3 * s, x, 0.1 * s, z, i % 2 ? PAL.tree : "#3f6e4a", 6);
        b.cone(0.11 * s, 0.24 * s, x, 0.28 * s, z, PAL.treeDark, 6);
      }
      // kereste yığını (iş kolu renkli uç)
      for (let i = 0; i < 3; i++) b.cylZ(0.04, 0.3, 0.42, 0.07 + (i === 2 ? 0.06 : 0), -0.4 + (i % 2) * 0.05 + (i === 2 ? 0.04 : i * 0.0), "#9a7048", 6);
      b.box(0.04, 0.2, 0.04, -0.48, 0.03, 0.46, PAL.steel); b.box(0.14, 0.08, 0.02, -0.42, 0.15, 0.46, bc);
      height = 0.55;
      break;
    }
    case "workshop": {
      b.box(1.1, 0.04, 1.0, 0, 0, 0, "#4a525a");
      const teeth = 3 + (L >= 3 ? 1 : 0);
      const tw = 0.78 / teeth;
      b.box(0.8, 0.26, 0.62, 0, 0.04, -0.05, "#aeb6bc");
      for (let i = 0; i < teeth; i++) {
        const x = -0.39 + tw * (i + 0.5);
        b.wedge(tw, 0.16, 0.64, x, 0.3, -0.05, PAL.roofDark);
        b.box(0.02, 0.12, 0.6, x + tw / 2 + 0.005, 0.31, -0.05, bc); // cam şerit (iş kolu rengi)
      }
      b.box(0.2, 0.16, 0.03, 0.2, 0.04, 0.27, PAL.dark); // kapı
      b.cyl(0.04, 0.05, 0.5, -0.46, 0.04, -0.3, PAL.steel, 8); // baca
      if (L >= 2) { b.box(0.26, 0.2, 0.26, 0.42, 0.04, 0.38, "#c5ccd2"); b.box(0.28, 0.03, 0.28, 0.42, 0.24, 0.38, bc); }
      b.box(0.1, 0.06, 0.1, -0.3, 0.04, 0.42, shade(accent === "-" ? "#9aa3aa" : accent, 0.9));
      extra.smoke.push({ x: -0.46, y: 0.54, z: -0.3, dark: false });
      extra.lamps.push({ x: 0.2, y: 0.18, z: 0.29, s: 0.07 });
      height = 0.5;
      break;
    }
    case "garage": {
      const w = 0.8 + (L - 1) * 0.12;
      b.box(1.1, 0.04, 1.0, 0, 0, 0, "#4a525a");
      b.box(w, 0.3, 0.7, 0, 0.04, -0.05, "#9aa7b4");
      b.gable(w + 0.04, 0.12, 0.74, 0, 0.34, -0.05, "#59626c");
      b.box(w * 0.62, 0.2, 0.03, 0, 0.04, 0.3, "#0e1216"); // açık bölme
      b.box(w * 0.66, 0.03, 0.05, 0, 0.24, 0.31, PAL.forge);
      if (L >= 2) { b.box(0.24, 0.34, 0.3, -w / 2 - 0.1, 0.04, 0.28, "#b7c3cc"); }
      if (L >= 3) { b.box(0.16, 0.5, 0.16, w / 2 + 0.12, 0.04, 0.3, "#b7c3cc"); b.box(0.2, 0.04, 0.2, w / 2 + 0.12, 0.54, 0.3, PAL.forge); height = 0.6; }
      // park halindeki araçlar (kamyonet, kamyon) ve turuncu çatı bandı
      b.box(w + 0.06, 0.03, 0.78, 0, 0.46, -0.05, band ?? PAL.forge);
      b.box(0.1, 0.06, 0.2, -0.3, 0.04, 0.44, PAL.forge); b.box(0.1, 0.05, 0.08, -0.3, 0.1, 0.5, "#9fd0ff");
      b.box(0.12, 0.08, 0.3, 0.0, 0.04, 0.44, "#d7dde3"); b.box(0.1, 0.06, 0.08, 0.0, 0.1, 0.55, PAL.forge);
      b.box(0.1, 0.06, 0.2, 0.3, 0.04, 0.44, "#d7dde3");
      extra.shutter = { w: w * 0.6, h: 0.2, x: 0, y: 0.04, z: 0.325 };
      extra.lamps.push({ x: 0, y: 0.14, z: 0.31, s: 0.1 });
      height = Math.max(height, 0.55);
      break;
    }
    default: {
      b.box(0.6, 0.4, 0.6, 0, 0, 0, PAL.concrete);
      height = 0.5;
    }
  }
  return { geometry: b.build(), height, ...extra };
}

/** Rengi koyulaştır/açık tut (0..1 çarpan) */
export function shade(hex: string, f: number): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), bl = Math.round((n & 255) * f);
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}

/** İskele (inşaat/yükseltme) */
export function buildScaffold(size: number): BufferGeometry {
  const b = new PartBuilder();
  const h = 0.8 * size;
  const e = 0.5 * size;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.04, h, 0.04, sx * e, 0.03, sz * e, PAL.scaffold);
  for (const y of [0.25, 0.5, 0.75]) {
    const yy = y * h;
    for (const s of [-1, 1]) { b.box(2 * e, 0.03, 0.03, 0, yy, s * e, PAL.scaffold); b.box(0.03, 0.03, 2 * e, s * e, yy, 0, PAL.scaffold); }
  }
  // çapraz destek (ön yüz)
  b.box(0.025, h * 1.05, 0.025, 0, 0.03, e, PAL.scaffold, 0);
  return b.build();
}

/** Uyarı üçgeni (sarı, ünlemli) */
export function buildWarning(): BufferGeometry {
  const b = new PartBuilder();
  b.cone(0.26, 0.45, 0, 0, 0, PAL.warn, 3);
  b.box(0.035, 0.1, 0.035, 0, 0.09, 0.0, "#1a1a1a");
  b.box(0.035, 0.035, 0.035, 0, 0.04, 0.0, "#1a1a1a");
  return b.build();
}

/** Satılık tabelası */
export function buildSign(color: string): BufferGeometry {
  const b = new PartBuilder();
  // satılık tabela küçük ve soluk: kendi binalarım öne çıksın
  b.box(0.03, 0.2, 0.03, 0, 0, 0, "#6c7885");
  b.box(0.18, 0.1, 0.02, 0, 0.16, 0, shade(color, 0.55));
  // çit direkleri (köşeler)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.04, 0.12, 0.04, sx * 0.55, 0, sz * 0.55, "#4a5663");
  for (const s of [-1, 1]) { b.box(1.1, 0.02, 0.02, 0, 0.09, s * 0.55, "#3f4a56"); b.box(0.02, 0.02, 1.1, s * 0.55, 0.09, 0, "#3f4a56"); }
  return b.build();
}

/** Çerçeve (benim varlıklarım ve seçim) */
export function buildFrame(half: number, thick: number, color = "#ffffff"): BufferGeometry {
  const b = new PartBuilder();
  const len = half * 2 + thick;
  for (const s of [-1, 1]) { b.box(len, 0.05, thick, 0, 0, s * half, color); b.box(thick, 0.05, len, s * half, 0, 0, color); }
  return b.build();
}

/** Yatak işareti (boş arsa üstünde): türe göre renkli yığın; renk ve şekil harita efsanesiyle aynı */
export function buildDepositMark(kind: string): BufferGeometry {
  const b = new PartBuilder();
  const c = DEPOSIT_COLOR[kind] ?? PAL.rock;
  switch (kind) {
    case "salt":
      for (const [x, z, s] of [[-0.18, 0.05, 1], [0.08, -0.12, 1.3], [0.2, 0.15, 0.8]] as const) b.box(0.14 * s, 0.14 * s, 0.14 * s, x, 0.02, z, c, 0.6 * s);
      break;
    case "sand":
      b.cone(0.42, 0.14, 0, 0.0, 0, c, 8); b.cone(0.22, 0.12, 0.2, 0.05, -0.1, shade(c, 0.9), 8);
      break;
    case "clay":
      b.cyl(0.3, 0.34, 0.1, 0, 0, 0, c, 9); b.cyl(0.2, 0.24, 0.08, 0.04, 0.1, -0.02, shade(c, 0.88), 9);
      break;
    case "limestone":
      b.box(0.3, 0.16, 0.24, -0.1, 0, 0, c, 0.3); b.box(0.2, 0.12, 0.2, 0.2, 0, 0.1, shade(c, 0.9), -0.4); b.box(0.16, 0.1, 0.16, 0.05, 0.16, 0, shade(c, 0.95), 0.8);
      break;
    default:
      b.cone(0.3, 0.3, -0.12, 0, 0.0, c, 6); b.cone(0.2, 0.22, 0.2, 0, 0.1, shade(c, 0.8), 6);
  }
  return b.build();
}
