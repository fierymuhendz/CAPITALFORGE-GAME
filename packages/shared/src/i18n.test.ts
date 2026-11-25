import { describe, expect, it } from "vitest";
import { DICTS, flattenKeys } from "./i18n";
import { ERROR_CODES } from "./errors";

describe("i18n", () => {
  it("tr ve en aynı anahtarlara sahip", () => {
    const a = flattenKeys(DICTS.tr).sort();
    const b = flattenKeys(DICTS.en).sort();
    expect(a.filter((k) => !b.includes(k))).toEqual([]);
    expect(b.filter((k) => !a.includes(k))).toEqual([]);
  });
  it("her hata kodunun çevirisi var", () => {
    const keys = flattenKeys(DICTS.tr);
    for (const c of ERROR_CODES) expect(keys).toContain(`errors.${c}`);
  });
});
