import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { lockOrder, validateLegs } from "./plan";

describe("validateLegs", () => {
  it("dengeli transferi kabul eder", () => {
    expect(() => validateLegs([{ accountId: "a", amount: -100n }, { accountId: "b", amount: 100n }])).not.toThrow();
  });

  it("dengesiz transferi reddeder (para yaratılamaz)", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 10n ** 12n }), fc.bigInt({ min: 1n, max: 10n ** 12n }), (out, inn) => {
        fc.pre(out !== inn);
        expect(() => validateLegs([{ accountId: "a", amount: -out }, { accountId: "b", amount: inn }])).toThrow();
      }),
    );
  });

  it("tek bacaklı ve sıfır tutarlı transferi reddeder", () => {
    expect(() => validateLegs([{ accountId: "a", amount: 0n }])).toThrow();
    expect(() => validateLegs([{ accountId: "a", amount: 0n }, { accountId: "b", amount: 0n }])).toThrow();
  });
});

describe("lockOrder", () => {
  it("kilit sırası bacak sırasından bağımsızdır", () => {
    const a = lockOrder([{ accountId: "z", amount: 1n }, { accountId: "a", amount: -1n }]);
    const b = lockOrder([{ accountId: "a", amount: -1n }, { accountId: "z", amount: 1n }]);
    expect(a).toEqual(b);
  });
});
