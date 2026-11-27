"use client";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { formatMoney, formatPricePerTonne, formatQty, translate, type ErrorCode, type Localized, type Locale, type NotificationDto, type WorldDto } from "@capitalforge/shared";
import { ApiError } from "./api";

interface LocaleCtx { locale: Locale; setLocale: (l: Locale) => void }
const Ctx = createContext<LocaleCtx>({ locale: "tr", setLocale: () => undefined });

export function LocaleProvider({ value, children }: { value: LocaleCtx; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function browserLocale(): Locale {
  if (typeof navigator === "undefined") return "tr";
  return navigator.language?.toLowerCase().startsWith("tr") ? "tr" : "en";
}

let notifWorld: WorldDto | null = null;
/** Bildirim parametrelerindeki kimlikleri (ürün, şehir, bina…) katalog adına çevirmek için dünya verisi. */
export function setNotifWorld(w: WorldDto | null): void { notifWorld = w; }

const MONEY_KEYS = new Set(["amount", "remaining", "arrears", "penalty", "refund", "gross", "pay"]);
function notifParams(locale: Locale, p: Record<string, string | number>): Record<string, string | number> {
  const w = notifWorld;
  const nm = (l: Localized | undefined, fb: string) => (l ? l[locale] : fb);
  const tag = locale === "tr" ? "tr-TR" : "en-US";
  const out: Record<string, string | number> = {};
  for (const [k, raw] of Object.entries(p)) {
    const v = String(raw);
    let r: string | number = raw;
    if (MONEY_KEYS.has(k) && /^-?\d+$/.test(v)) r = formatMoney(v, locale);
    else if (k === "pricePerKg" && /^\d+$/.test(v)) r = formatPricePerTonne(v, locale);
    else if ((k === "qtyKg" || k === "missingKg") && /^\d+$/.test(v)) r = formatQty(v, locale);
    else if (k.endsWith("At") && !Number.isNaN(Date.parse(v))) r = new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeStyle: "short" }).format(new Date(v));
    else if (k === "late") r = Number(raw) ? ` (${translate(locale, "contracts.late")})` : "";
    else if (k === "role") r = translate(locale, `logistics.jobRole.${v}`);
    else if (k === "result") r = translate(locale, `contracts.instStatus.${v}`);
    else if (k === "reason") r = translate(locale, `facility.stalled.${v}`);
    else if (w && (k === "productId" || k === "product")) r = nm(w.products.find((x) => x.id === v)?.name, v);
    else if (w && (k === "cityId" || k === "city")) r = nm(w.cities.find((x) => x.id === v)?.name, v);
    else if (w && (k === "building" || k === "facility")) r = nm(w.buildingTypes.find((x) => x.id === v)?.name, v);
    else if (w && k === "recipe") r = nm(w.recipes.find((x) => x.id === v)?.name, v);
    else if (w && k === "research") r = nm(w.research.find((x) => x.id === v)?.name, v);
    out[k] = r;
  }
  return out;
}

export type TFn = (key: string, params?: Record<string, string | number>) => string;

export interface I18n {
  locale: Locale;
  t: TFn;
  has: (key: string) => boolean;
  /** kuruş metni → "₺12.345,00" (tek biçimlendirme noktası) */
  money: (v: string | bigint | number, compact?: boolean) => string;
  /** ₺ tutarı işaretli: kâr/zarar için + / − öneki */
  signed: (v: string) => string;
  qty: (kg: number | string) => string;
  /** kuruş/kg → ₺/t */
  price: (perKg: string | number | bigint) => string;
  name: (l: Localized | undefined) => string;
  pct: (bp: number) => string;
  date: (iso: string) => string;
  time: (iso: string) => string;
  num: (n: number) => string;
  /** dakika → "45 dk" / "2 sa 10 dk" (0 → "şimdi") */
  dur: (min: number) => string;
  err: (e: unknown) => string;
  notif: (n: NotificationDto) => string;
  /** işlem türü kodu → okunur ad (yoksa kodun kendisi) */
  kind: (k: string) => string;
  city: (id: string | null | undefined, cities: Array<{ id: string; name: Localized }> | undefined) => string;
}

export function useT(): I18n {
  const { locale } = useContext(Ctx);
  return useMemo(() => {
    const t: TFn = (k, p) => translate(locale, k, p);
    const has = (k: string) => translate(locale, k) !== k;
    const tag = locale === "tr" ? "tr-TR" : "en-US";
    return {
      locale, t, has,
      money: (v, compact) => formatMoney(v, locale, { compact }),
      signed: (v) => { const n = BigInt(v); return n > 0n ? `+${formatMoney(n, locale)}` : formatMoney(n, locale); },
      qty: (kg) => formatQty(kg, locale),
      price: (p) => formatPricePerTonne(p, locale),
      name: (l) => (l ? l[locale] : ""),
      pct: (bp) => `${new Intl.NumberFormat(tag, { maximumFractionDigits: 1 }).format(bp / 100)}%`,
      date: (iso) => new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)),
      time: (iso) => new Intl.DateTimeFormat(tag, { timeStyle: "medium" }).format(new Date(iso)),
      num: (n) => new Intl.NumberFormat(tag).format(n),
      dur: (min) => {
        // oyun testi kipinde süreler kesirli dakika olabilir: 1 dk altı saniye olarak gösterilir
        const sec = Math.max(0, Math.round(min * 60));
        if (sec === 0) return t("offers.now");
        if (sec < 60) return t("common.seconds", { n: sec });
        const m = Math.round(sec / 60);
        if (m < 60) return t("common.minutes", { n: m });
        const h = Math.floor(m / 60), r = m % 60;
        return r ? `${h} ${t("common.hourShort")} ${t("common.minutes", { n: r })}` : `${h} ${t("common.hourShort")}`;
      },
      err: (e) => {
        const code: ErrorCode = e instanceof ApiError ? e.code : "INTERNAL";
        const key = `errors.${code}`;
        const base = has(key) ? t(key) : t("errors.INTERNAL");
        const reason = e instanceof ApiError ? e.details?.reason : undefined;
        return reason && has(`conflictReason.${reason}`) ? `${base} ${t(`conflictReason.${reason}`)}` : base;
      },
      notif: (n) => {
        const key = `notifications.${n.kind}`;
        return has(key) ? translate(locale, key, notifParams(locale, n.params)) : translate(locale, "notifications.unknown", { kind: n.kind });
      },
      kind: (k) => (has(`txKind.${k}`) ? t(`txKind.${k}`) : k),
      city: (id, cities) => (id ? cities?.find((c) => c.id === id)?.name[locale] ?? id : "—"),
    };
  }, [locale]);
}
