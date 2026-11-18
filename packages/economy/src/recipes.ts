import type { FacilityType } from "./facilities";

export interface RecipeLine {
  productId: string;
  qty: bigint;
}
export interface Recipe {
  id: RecipeId;
  facility: FacilityType;
  inputs: RecipeLine[];
  output: RecipeLine;
  /** 1 batch ve N batch aynı sürede biter (süre batch ile çarpılmaz). 1 tick = 1 sn. */
  durationTicks: bigint;
}

export const RECIPE_IDS = [
  "grow_wheat",
  "mine_iron",
  "generate_energy",
  "mill_flour",
  "smelt_steel",
] as const;
export type RecipeId = (typeof RECIPE_IDS)[number];

export const RECIPES: Record<RecipeId, Recipe> = {
  grow_wheat: {
    id: "grow_wheat",
    facility: "farm",
    inputs: [{ productId: "energy", qty: 1n }],
    output: { productId: "wheat", qty: 10n },
    durationTicks: 7_200n,
  },
  mine_iron: {
    id: "mine_iron",
    facility: "mine",
    inputs: [{ productId: "energy", qty: 2n }],
    output: { productId: "iron", qty: 5n },
    durationTicks: 7_200n,
  },
  generate_energy: {
    id: "generate_energy",
    facility: "power_plant",
    inputs: [],
    output: { productId: "energy", qty: 2n },
    durationTicks: 28_800n,
  },
  mill_flour: {
    id: "mill_flour",
    facility: "mill",
    inputs: [
      { productId: "wheat", qty: 10n },
      { productId: "energy", qty: 1n },
    ],
    output: { productId: "flour", qty: 8n },
    durationTicks: 7_200n,
  },
  smelt_steel: {
    id: "smelt_steel",
    facility: "steelworks",
    inputs: [
      { productId: "iron", qty: 5n },
      { productId: "energy", qty: 3n },
    ],
    output: { productId: "steel", qty: 4n },
    durationTicks: 14_400n,
  },
};
