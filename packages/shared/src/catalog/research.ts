import type { ResearchDef } from "./types";

export const RESEARCH: ResearchDef[] = [
  {
    id: "agronomy", name: { tr: "Agronomi", en: "Agronomy" },
    description: { tr: "Tarla verimi seviye başına +%8", en: "Field yield +8% per level" },
    maxLevel: 3, baseCost: 2_500_000, baseMinutes: 180, effect: { kind: "yield", sector: "crop", bpPerLevel: 800 },
  },
  {
    id: "herd_health", name: { tr: "Sürü sağlığı", en: "Herd health" },
    description: { tr: "Süt verimi seviye başına +%8", en: "Milk yield +8% per level" },
    maxLevel: 3, baseCost: 3_000_000, baseMinutes: 180, effect: { kind: "yield", sector: "livestock", bpPerLevel: 800 },
  },
  {
    id: "drilling", name: { tr: "Delme teknikleri", en: "Drilling techniques" },
    description: { tr: "Maden verimi seviye başına +%8", en: "Mine yield +8% per level" },
    maxLevel: 3, baseCost: 3_000_000, baseMinutes: 180, effect: { kind: "yield", sector: "mining", bpPerLevel: 800 },
  },
  {
    id: "lean_process", name: { tr: "Yalın üretim", en: "Lean process" },
    description: { tr: "Fabrikada enerji ve işçilik seviye başına −%10", en: "Factory energy and labour −10% per level" },
    maxLevel: 3, baseCost: 3_500_000, baseMinutes: 180, effect: { kind: "efficiency", sector: "manufacturing", bpPerLevel: 1000 },
  },
  {
    id: "quality_control", name: { tr: "Kalite kontrol", en: "Quality control" },
    description: { tr: "Tüm çıktılarda kalite seviye başına +1 (en fazla 5)", en: "+1 output quality per level (max 5)" },
    maxLevel: 2, baseCost: 5_000_000, baseMinutes: 240, effect: { kind: "quality", perLevel: 1 },
  },
  {
    id: "eco_driving", name: { tr: "Ekonomik sürüş", en: "Eco driving" },
    description: { tr: "Yakıt gideri seviye başına −%8", en: "Fuel cost −8% per level" },
    maxLevel: 3, baseCost: 2_000_000, baseMinutes: 180, effect: { kind: "fuel", bpPerLevel: 800 },
  },
  {
    id: "route_planning", name: { tr: "Rota planlama", en: "Route planning" },
    description: { tr: "Araç hızı seviye başına +%6", en: "Vehicle speed +6% per level" },
    maxLevel: 3, baseCost: 2_500_000, baseMinutes: 180, effect: { kind: "speed", bpPerLevel: 600 },
  },
];
