import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PARAMS, PRODUCT_IDS } from "@capitalforge/economy";
import { describe, expect, it } from "vitest";

/** Migration SQL'i ekonomi parametrelerini kopyalamak zorunda; kayarsa canlıda yanlış fiyatla başlanır. */
describe("0002 migration seed değerleri", () => {
  const sql = readFileSync(join(__dirname, "../../drizzle/0002_sirket_ve_uretim.sql"), "utf8");
  const rows = new Map<string, { price: bigint; units: bigint }>();
  for (const m of sql.matchAll(/\('(\w+)',(?: '[^']*',)? (\d+)::bigint, (\d+)::bigint\)/g)) {
    rows.set(m[1]!, { price: BigInt(m[2]!), units: BigInt(m[3]!) });
  }
  it.each([...PRODUCT_IDS])("%s fiyatı ve havuz derinliği PARAMS ile aynı", (id) => {
    expect(rows.get(id)).toEqual({ price: PARAMS.initialPrice[id], units: PARAMS.poolDepth[id] });
  });
});
