"use client";
import { useEffect, useId, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { useT } from "@/lib/i18n";
import { kgToText, kurusToText, parseKg, parseLira, parsePricePerKg, perKgToText, type PriceUnit, type QtyUnit } from "@/lib/numbers";
import { Seg } from "./Tabs";

export function Field({ label, hint, error, children, id }: { label: string; hint?: ReactNode; error?: string | null; children: (p: { id: string; "aria-invalid"?: boolean; "aria-describedby"?: string }) => ReactNode; id?: string }) {
  const gen = useId();
  const fid = id ?? gen;
  const did = `${fid}-d`;
  return (
    <div className="field">
      <label htmlFor={fid}>{label}</label>
      {children({ id: fid, "aria-invalid": error ? true : undefined, "aria-describedby": hint || error ? did : undefined })}
      {error ? <span id={did} className="err" role="alert">{error}</span> : hint ? <span id={did} className="hint">{hint}</span> : null}
    </div>
  );
}

export function TextField({ label, hint, error, ...rest }: { label: string; hint?: ReactNode; error?: string | null } & InputHTMLAttributes<HTMLInputElement>) {
  return <Field label={label} hint={hint} error={error}>{(p) => <input className="input" {...p} {...rest} />}</Field>;
}

export function SelectField({ label, value, onChange, options, hint }: { label: string; value: string; onChange: (v: string) => void; options: Array<{ id: string; label: string; disabled?: boolean }>; hint?: ReactNode }) {
  return (
    <Field label={label} hint={hint}>
      {(p) => (
        <select className="input" {...p} value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map((o) => <option key={o.id} value={o.id} disabled={o.disabled}>{o.label}</option>)}
        </select>
      )}
    </Field>
  );
}

/** Miktar: kg ↔ ton dönüşümlü. Değer her zaman kg (tam sayı) olarak yukarı verilir. */
export function QtyInput({ label, value, onChange, max, hint, defaultUnit = "t" }: { label: string; value: number | null; onChange: (kg: number | null) => void; max?: number; hint?: ReactNode; defaultUnit?: QtyUnit }) {
  const { t } = useT();
  const [unit, setUnit] = useState<QtyUnit>(defaultUnit);
  const [text, setText] = useState(kgToText(value, defaultUnit));
  useEffect(() => { if (parseKg(text, unit) !== value) setText(kgToText(value, unit)); /* dışarıdan sıfırlama */ // eslint-disable-line react-hooks/exhaustive-deps
  }, [value]);
  const parsed = text === "" ? null : parseKg(text, unit);
  const err = text !== "" && parsed === null ? t("form.badQty") : parsed !== null && parsed <= 0 ? t("form.positive") : max !== undefined && parsed !== null && parsed > max ? t("form.tooMuch") : null;
  return (
    <Field label={label} hint={hint} error={err}>
      {(p) => (
        <div className="input-group">
          <input className="input num" inputMode="decimal" autoComplete="off" {...p} value={text} onChange={(e) => { setText(e.target.value); onChange(e.target.value === "" ? null : parseKg(e.target.value, unit)); }} />
          <Seg label={t("form.unit")} value={unit} onChange={(u) => { const kg = parseKg(text, unit); setUnit(u); setText(kgToText(kg ?? value, u)); }} items={[{ id: "kg", label: "kg" }, { id: "t", label: "t" }]} />
        </div>
      )}
    </Field>
  );
}

/** Birim fiyat: ₺/t ↔ ₺/kg dönüşümlü; değer kuruş/kg (tam sayı). */
export function PriceInput({ label, value, onChange, hint, defaultUnit = "t" }: { label: string; value: number | null; onChange: (kurusPerKg: number | null) => void; hint?: ReactNode; defaultUnit?: PriceUnit }) {
  const { t } = useT();
  const [unit, setUnit] = useState<PriceUnit>(defaultUnit);
  const [text, setText] = useState(perKgToText(value, defaultUnit));
  useEffect(() => { if (parsePricePerKg(text, unit) !== value) setText(perKgToText(value, unit)); // eslint-disable-line react-hooks/exhaustive-deps
  }, [value]);
  const parsed = text === "" ? null : parsePricePerKg(text, unit);
  const err = text !== "" && parsed === null ? t(unit === "t" ? "form.badPriceT" : "form.badPrice") : parsed !== null && parsed <= 0 ? t("form.positive") : null;
  return (
    <Field label={label} hint={hint} error={err}>
      {(p) => (
        <div className="input-group">
          <input className="input num" inputMode="decimal" autoComplete="off" {...p} value={text} onChange={(e) => { setText(e.target.value); onChange(e.target.value === "" ? null : parsePricePerKg(e.target.value, unit)); }} />
          <Seg label={t("form.unit")} value={unit} onChange={(u) => { const k = parsePricePerKg(text, unit); setUnit(u); setText(perKgToText(k ?? value, u)); }} items={[{ id: "t", label: "₺/t" }, { id: "kg", label: "₺/kg" }]} />
        </div>
      )}
    </Field>
  );
}

/** Tutar (₺ girilir, kuruş tam sayı olarak verilir) */
export function MoneyInput({ label, value, onChange, hint }: { label: string; value: number | null; onChange: (kurus: number | null) => void; hint?: ReactNode }) {
  const { t } = useT();
  const [text, setText] = useState(kurusToText(value));
  useEffect(() => { if (parseLira(text) !== value) setText(kurusToText(value)); // eslint-disable-line react-hooks/exhaustive-deps
  }, [value]);
  const parsed = text === "" ? null : parseLira(text);
  const err = text !== "" && parsed === null ? t("form.badMoney") : parsed !== null && parsed <= 0 ? t("form.positive") : null;
  return (
    <Field label={label} hint={hint} error={err}>
      {(p) => (
        <div className="input-group">
          <span className="input row" style={{ flex: "0 0 44px", justifyContent: "center" }} aria-hidden="true">₺</span>
          <input className="input num" inputMode="decimal" autoComplete="off" {...p} value={text} onChange={(e) => { setText(e.target.value); onChange(e.target.value === "" ? null : parseLira(e.target.value)); }} />
        </div>
      )}
    </Field>
  );
}

export function IntInput({ label, value, onChange, min, max, hint, suffix }: { label: string; value: number; onChange: (n: number) => void; min: number; max: number; hint?: ReactNode; suffix?: string }) {
  const { t } = useT();
  const bad = !Number.isInteger(value) || value < min || value > max;
  return (
    <Field label={label} hint={hint} error={bad ? t("form.range", { min, max }) : null}>
      {(p) => (
        <div className="input-group">
          <input className="input num" type="number" inputMode="numeric" min={min} max={max} step={1} {...p} value={Number.isNaN(value) ? "" : value} onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))} />
          {suffix ? <span className="input row" style={{ flex: "0 0 auto" }} aria-hidden="true">{suffix}</span> : null}
        </div>
      )}
    </Field>
  );
}
