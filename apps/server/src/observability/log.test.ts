import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger } from "./log";

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(String(chunk));
      cb();
    },
  });
  return { lines, logger: createLogger(stream) };
}

describe("günlük gizleme", () => {
  it("authorization başlığı, token ve parola [Redacted] olur", () => {
    const { lines, logger } = capture();
    logger.info({ req: { headers: { authorization: "Bearer gizli-token-123" } } }, "istek");
    logger.info({ body: { token: "gizli-token-456", password: "gizli-parola" } }, "gövde");
    logger.info({ token: "gizli-token-789" }, "kök");
    const out = lines.join("");
    expect(out).not.toMatch(/gizli-/);
    expect(out.match(/\[Redacted\]/g)?.length).toBe(4);
  });
});
