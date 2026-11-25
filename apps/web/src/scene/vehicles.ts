import type { BufferGeometry } from "three";
import { PartBuilder } from "./geo";
import { PAL } from "./palette";

/** Araç geometrisi; ileri yön +z. cab: sahibi rengi, cargo: yük rengi (kasa). */
export function buildVehicle(modelId: string, cab: string, cargo: string): BufferGeometry {
  const b = new PartBuilder();
  const wheel = (x: number, z: number) => b.box(0.05, 0.1, 0.12, x, 0, z, "#15191d");
  if (modelId === "van") {
    b.box(0.19, 0.12, 0.34, 0, 0.05, 0, cab);
    b.box(0.17, 0.07, 0.11, 0, 0.17, 0.08, "#9fd0ff");
    b.box(0.19, 0.05, 0.2, 0, 0.17, -0.07, cargo);
    for (const sx of [-1, 1]) { wheel(sx * 0.1, 0.1); wheel(sx * 0.1, -0.1); }
  } else if (modelId === "semi") {
    // çekici
    b.box(0.2, 0.14, 0.24, 0, 0.06, 0.38, cab);
    b.box(0.18, 0.08, 0.1, 0, 0.2, 0.43, "#9fd0ff");
    b.box(0.2, 0.04, 0.1, 0, 0.2, 0.33, cab);
    // dorse
    b.box(0.22, 0.2, 0.62, 0, 0.1, -0.12, cargo);
    b.box(0.23, 0.02, 0.62, 0, 0.1, -0.12, "#3a4048");
    for (const sx of [-1, 1]) { wheel(sx * 0.11, 0.42); wheel(sx * 0.11, -0.25); wheel(sx * 0.11, -0.4); }
  } else {
    b.box(0.2, 0.13, 0.15, 0, 0.05, 0.22, cab);
    b.box(0.18, 0.07, 0.07, 0, 0.17, 0.26, "#9fd0ff");
    b.box(0.22, 0.17, 0.36, 0, 0.08, -0.07, cargo);
    for (const sx of [-1, 1]) { wheel(sx * 0.11, 0.24); wheel(sx * 0.11, -0.12); wheel(sx * 0.11, -0.22); }
  }
  return b.build();
}

export function vehicleLength(modelId: string): number {
  return modelId === "van" ? 0.34 : modelId === "semi" ? 1.0 : 0.6;
}

export const NEUTRAL_CARGO = PAL.concrete;
