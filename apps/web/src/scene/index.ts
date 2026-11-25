import dynamic from "next/dynamic";

export type { CityViewProps, CitySelection, GraphicsQuality } from "./types";
export type { CityViewExtraProps } from "./CityView";
export { detectQuality, hasWebGL } from "./quality";
export type { GraphicsPref } from "./quality";

/** 3D sahne yalnızca tarayıcıda ve gerektiğinde yüklenir (three paketi ilk yüklemeye girmez). */
export const CityViewLazy = dynamic(() => import("./CityView"), {
  ssr: false,
  loading: () => null,
});
export { default as CityMap2D } from "../map2d/CityMap2D";
export type { CityMap2DProps } from "../map2d/CityMap2D";
