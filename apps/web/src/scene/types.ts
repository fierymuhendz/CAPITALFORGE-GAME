/**
 * 3D şehir (sehir-3d) ile arayüz (arayuz-dev) arasındaki sözleşme.
 * Sahne veri hesaplamaz: tüm durum WorldMapDto'dan gelir, araç konumu transitProgress ile.
 */
import type { WorldDto, WorldMapDto } from "@capitalforge/shared";

export type GraphicsQuality = "high" | "low" | "lite";

export type CitySelection =
  | { type: "plot"; plotId: string }
  | { type: "facility"; facilityId: string; plotId: string }
  | { type: "vehicle"; vehicleId: string }
  | { type: "city"; cityId: string };

export interface CityViewProps {
  world: WorldDto;
  map: WorldMapDto;
  /** sunucu saati ile istemci saati farkı (ms): now = Date.now() + serverOffsetMs */
  serverOffsetMs: number;
  quality: GraphicsQuality;
  myCompanyId: string | null;
  /** kameranın odaklanacağı şehir (değişince yumuşak geçiş) */
  focusCityId: string | null;
  selected: CitySelection | null;
  onSelect: (sel: CitySelection | null) => void;
  locale: "tr" | "en";
}
