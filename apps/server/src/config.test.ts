import { describe, expect, it } from "vitest";
import { resolveRedisUrl, resolveTrustProxy } from "./config";

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

describe("resolveRedisUrl", () => {
  it("üretimde parolasız adres reddedilir, hata iletisi adresi sızdırmaz", () => {
    expect(() => resolveRedisUrl("redis://redis:6379", "production")).toThrow(/parola zorunlu/);
    expect(() => resolveRedisUrl("redis://:@redis:6379", "production")).toThrow(/parola zorunlu/);
    expect(() => resolveRedisUrl("redis://redis:6379", "production")).not.toThrow(/redis:6379/);
    expect(() => resolveRedisUrl("bozuk adres", "production")).toThrow(/REDIS_URL/);
  });
  it("üretimde parolalı adres kabul edilir; geliştirmede parolasız serbest", () => {
    expect(resolveRedisUrl("redis://:gizli@redis:6379", "production")).toBe("redis://:gizli@redis:6379");
    expect(resolveRedisUrl("redis://localhost:6379", "development")).toBe("redis://localhost:6379");
    expect(resolveRedisUrl("redis://localhost:6379", undefined)).toBe("redis://localhost:6379");
  });
});
