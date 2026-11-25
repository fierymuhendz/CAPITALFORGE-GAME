/**
 * Çeviri sözlükleri. Anahtarlar noktalı yol: t("market.buy"). Her iki dilde aynı anahtar kümesi
 * zorunludur (i18n.test.ts denetler). Parametreler {ad} biçiminde.
 */
import { tr } from "./tr";
import { en } from "./en";
import type { Locale } from "../money";

export type Dict = { [k: string]: string | Dict };
export const DICTS: Record<Locale, Dict> = { tr, en };

export function translate(locale: Locale, key: string, params?: Record<string, string | number>): string {
  const parts = key.split(".");
  let cur: string | Dict | undefined = DICTS[locale];
  for (const p of parts) {
    if (cur === undefined || typeof cur === "string") { cur = undefined; break; }
    cur = cur[p];
  }
  let s = typeof cur === "string" ? cur : key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

export function flattenKeys(d: Dict, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(d)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.push(key);
    else out.push(...flattenKeys(v, key));
  }
  return out;
}
