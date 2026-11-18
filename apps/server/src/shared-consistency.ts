import { FACILITY_TYPES, RECIPE_IDS } from "@capitalforge/economy";
import { FACILITY_TYPE_IDS, PRODUCT_IDS, RECIPE_ID_LIST } from "@capitalforge/shared";

/**
 * Derleme zamanı denetimi: shared'daki sabit listeler packages/economy ile birebir aynı olmalı.
 * Biri değişip diğeri unutulursa typecheck kırılır.
 */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
export const _facilityTypesMatch: Same<(typeof FACILITY_TYPES)[number], (typeof FACILITY_TYPE_IDS)[number]> = true;
export const _recipeIdsMatch: Same<(typeof RECIPE_IDS)[number], (typeof RECIPE_ID_LIST)[number]> = true;
export const _productIdsMatch: Same<import("@capitalforge/economy").ProductId, (typeof PRODUCT_IDS)[number]> = true;
