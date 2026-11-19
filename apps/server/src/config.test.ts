import { describe, expect, it } from "vitest";
import { resolveTrustProxy } from "./config";

describe("resolveTrustProxy", () => {
  it("üretimde boş, false veya yalnızca ayraç değeri hata verir", () => {
    for (const v of [undefined, "", "false", " , "]) expect(() => resolveTrustProxy(v, "production")).toThrow(/TRUST_PROXY/);
  });
  it("üretimde geçerli liste kabul edilir; geliştirmede boş serbest", () => {
    expect(resolveTrustProxy("172.30.0.11", "production")).toEqual(["172.30.0.11"]);
    expect(resolveTrustProxy(undefined, "development")).toBe(false);
    expect(resolveTrustProxy(undefined, undefined)).toBe(false);
  });
});
