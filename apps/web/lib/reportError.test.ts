import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** reportError modül düzeyinde sayaç tutar (sayfa başına). Her test temiz bir modül ister. */
type ReportModule = typeof import("./reportError");

interface FakeLocation {
  pathname: string;
  search: string;
  hash: string;
  href: string;
}

const location: FakeLocation = {
  pathname: "/oyun/sirket",
  search: "?token=gizli-sorgu",
  hash: "#gizli-parca",
  href: "https://oyun.example.com/oyun/sirket?token=gizli-sorgu#gizli-parca",
};

let fetchMock: ReturnType<typeof vi.fn>;
let mod: ReportModule;

const bodies = (): Array<Record<string, unknown>> =>
  fetchMock.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string) as Record<string, unknown>);

async function fresh(): Promise<ReportModule> {
  vi.resetModules();
  return (await import("./reportError")) as ReportModule;
}

beforeEach(async () => {
  fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("window", { location: { ...location } });
  mod = await fresh();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reportError gönderimi", () => {
  it("POST /api/client-errors ile JSON gövde gönderir (kind, message, path)", () => {
    mod.reportError("error", new Error("patladi"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/client-errors");
    expect(init.method).toBe("POST");
    expect(bodies()[0]).toMatchObject({ kind: "error", message: "patladi", path: "/oyun/sirket" });
  });

  it("yalnızca pathname gönderilir: sorgu dizesi, hash ve tam URL gövdede yer almaz", () => {
    mod.reportError("unhandledrejection", new Error("sorgu testi"));
    const raw = (fetchMock.mock.calls[0]![1] as RequestInit).body as string;
    expect(raw).not.toContain("gizli-sorgu");
    expect(raw).not.toContain("gizli-parca");
    expect(raw).not.toContain("oyun.example.com");
    expect(raw).not.toContain("?token");
    expect(bodies()[0]!.path).toBe("/oyun/sirket");
  });

  it("pathname '/' ile başlamıyorsa path alanı hiç gönderilmez", () => {
    vi.stubGlobal("window", { location: { ...location, pathname: "gecersiz" } });
    mod.reportError("react", new Error("yol yok"));
    expect(bodies()[0]).not.toHaveProperty("path");
  });

  it("stack varsa 4000 karakterde kesilir, mesaj 500 karakterde kesilir", () => {
    const err = new Error("m".repeat(900));
    err.stack = "s".repeat(9000);
    mod.reportError("error", err);
    const b = bodies()[0]!;
    expect((b.message as string).length).toBe(500);
    expect((b.stack as string).length).toBe(4000);
  });

  it("Error değilse string mesaj kullanılır, nesne ise 'Bilinmeyen hata' gider", () => {
    mod.reportError("error", "düz metin");
    mod.reportError("error", { neden: "nesne" });
    expect(bodies()[0]!.message).toBe("düz metin");
    expect(bodies()[1]!.message).toBe("Bilinmeyen hata");
    expect(bodies()[1]).not.toHaveProperty("stack");
  });

  it("boş mesajlı Error için 'Bilinmeyen hata' gider", () => {
    mod.reportError("error", new Error(""));
    expect(bodies()[0]!.message).toBe("Bilinmeyen hata");
  });
});

describe("reportError tekrar ve sayfa sınırı", () => {
  it("aynı mesaj ikinci kez gönderilmez", () => {
    mod.reportError("error", new Error("tekrar"));
    mod.reportError("error", new Error("tekrar"));
    mod.reportError("react", new Error("tekrar"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sayfa başına en fazla 5 bildirim gider; 6. farklı mesaj da gönderilmez", () => {
    for (let i = 0; i < 8; i++) mod.reportError("error", new Error(`farkli-${i}`));
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(bodies().map((b) => b.message)).toEqual(["farkli-0", "farkli-1", "farkli-2", "farkli-3", "farkli-4"]);
  });

  it("5 sınırı kaçan (tekrar) mesajları sayaca eklemez", () => {
    mod.reportError("error", new Error("ilk"));
    for (let i = 0; i < 3; i++) mod.reportError("error", new Error("ilk"));
    for (let i = 0; i < 4; i++) mod.reportError("error", new Error(`yeni-${i}`));
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("modül yeniden yüklenince sayaç sıfırlanır (yeni sayfa)", async () => {
    for (let i = 0; i < 5; i++) mod.reportError("error", new Error(`eski-${i}`));
    mod = await fresh();
    mod.reportError("error", new Error("yeni sayfa"));
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});

describe("reportError asla fırlatmaz", () => {
  it("window tanımsızken (sunucu tarafı) hiçbir istek atmaz ve fırlatmaz", () => {
    vi.stubGlobal("window", undefined);
    expect(() => mod.reportError("error", new Error("sunucu"))).not.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetch senkron fırlatırsa çağıran etkilenmez", () => {
    fetchMock.mockImplementation(() => {
      throw new TypeError("ağ yok");
    });
    expect(() => mod.reportError("error", new Error("senkron"))).not.toThrow();
  });

  it("fetch reddederse (ağ hatası) yakalanır, işlenmeyen reddetme oluşmaz", async () => {
    fetchMock.mockImplementation(() => Promise.reject(new TypeError("ağ yok")));
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      expect(() => mod.reportError("error", new Error("reddetme"))).not.toThrow();
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("location okunamazsa (erişim hatası) fırlatmaz", () => {
    vi.stubGlobal("window", {
      get location(): never {
        throw new Error("erisim yok");
      },
    });
    expect(() => mod.reportError("error", new Error("konum"))).not.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
