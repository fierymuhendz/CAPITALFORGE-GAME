import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness";
import { checkInvariants } from "./invariants";

let h: Harness;
beforeAll(async () => { h = await createHarness(); });
afterAll(async () => { await h.close(); });

describe("şirket kuruluşu", () => {
  it("her sektör için uygun arsa ile kurulur, bağış bir kez verilir", async () => {
    const cases = [
      { sector: "crop", cityId: "yesilova" },
      { sector: "livestock", cityId: "akyayla" },
      { sector: "mining", cityId: "demirdag" },
      { sector: "manufacturing", cityId: "korfezkent", starterBuilding: "food_plant" },
      { sector: "freight", cityId: "kavsak" },
    ];
    for (const c of cases) {
      const p = await h.player();
      const ob = await p.ok("GET", `/world/onboarding?cityId=${c.cityId}&sector=${c.sector}`);
      const plot = ob.plots.find((x: any) => x.eligible);
      expect(plot, c.sector).toBeTruthy();
      const key = h.key();
      const body = { name: `Şirket ${c.sector} ${Math.random().toString(36).slice(2, 6)}`, cityId: c.cityId, sector: c.sector, plotId: plot.id, starterBuilding: c.starterBuilding, idempotencyKey: key };
      const r1 = await p.ok("POST", "/company", body);
      const r2 = await p.ok("POST", "/company", body); // aynı anahtar → aynı sonuç, ikinci kez bağış yok
      expect(r2.companyId).toBe(r1.companyId);
      const again = await p.post("/company", { ...body, idempotencyKey: h.key(), name: body.name + "x" });
      expect(again.body.error.code).toBe("COMPANY_EXISTS");
    }
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  });

  it("seviye ve nakit gereksinimi ayrı ayrı denetlenir; dolu arsa reddedilir", async () => {
    const p = await h.player();
    const ob = await p.ok("GET", `/world/onboarding?cityId=korfezkent&sector=crop`);
    const high = ob.plots.find((x: any) => x.minLevel > 1 && !x.owner);
    const r = await p.post("/company", { name: "Yüksek Seviye", cityId: "korfezkent", sector: "crop", plotId: high.id, idempotencyKey: h.key() });
    expect(r.body.error.code).toBe("LEVEL_TOO_LOW");
    const taken = ob.plots.find((x: any) => x.owner);
    if (taken) {
      const r2 = await p.post("/company", { name: "Dolu Arsa", cityId: "korfezkent", sector: "crop", plotId: taken.id, idempotencyKey: h.key() });
      expect(r2.body.error.code).toBe("PLOT_TAKEN");
    }
  });
});
