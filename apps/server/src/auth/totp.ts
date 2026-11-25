/** RFC 6238 TOTP (SHA-1, 6 hane, 30 sn). Bağımlılıksız. */
import { createHmac, randomBytes } from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().split("").filter((c) => c !== "=");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpAt(secretB32: string, step: number): string {
  const key = base32Decode(secretB32);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", key).update(msg).digest();
  const off = h[h.length - 1]! & 15;
  return ((h.readUInt32BE(off) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}

/** ±1 adım tolerans. Döndürür: eşleşen adım (tekrar kullanımı engellemek için) veya null */
export function verifyTotp(secretB32: string, code: string, nowMs: number, lastStep: number | null): number | null {
  const cur = Math.floor(nowMs / 30_000);
  for (const s of [cur - 1, cur, cur + 1]) {
    if (lastStep !== null && s <= lastStep) continue;
    if (totpAt(secretB32, s) === code) return s;
  }
  return null;
}

export function otpauthUrl(secretB32: string, account: string): string {
  const label = encodeURIComponent(`Capital Forge:${account}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=Capital%20Forge&algorithm=SHA1&digits=6&period=30`;
}
