import { describe, expect, it } from "vitest";
import { resolveGameServerUrl } from "./gameServerUrl";

describe("resolveGameServerUrl", () => {
  it("göreli yolu https için wss yapar", () => {
    expect(resolveGameServerUrl("/ws", { protocol: "https:", host: "oyun.example.com" })).toBe("wss://oyun.example.com/ws");
  });
  it("göreli yolu http için ws yapar", () => {
    expect(resolveGameServerUrl("/ws", { protocol: "http:", host: "localhost:3000" })).toBe("ws://localhost:3000/ws");
  });
  it("tam URL'yi aynen döndürür", () => {
    expect(resolveGameServerUrl("wss://x.example.com/play", { protocol: "http:", host: "a" })).toBe("wss://x.example.com/play");
  });
  it("boş değerde yerel adresi kullanır", () => {
    expect(resolveGameServerUrl(undefined, { protocol: "https:", host: "a" })).toBe("ws://localhost:2567");
    expect(resolveGameServerUrl("  ", undefined)).toBe("ws://localhost:2567");
  });
  it("göreli yolda location yoksa yerel adrese düşer", () => {
    expect(resolveGameServerUrl("/ws", undefined)).toBe("ws://localhost:2567");
  });
});
