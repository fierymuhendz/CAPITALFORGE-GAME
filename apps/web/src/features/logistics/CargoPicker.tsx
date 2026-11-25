"use client";
import { useMemo } from "react";
import type { HoldingDto } from "@capitalforge/shared";
import { useCat } from "@/lib/catalog";
import { useData } from "@/lib/data";
import { useT } from "@/lib/i18n";
import { Button, QtyInput, SelectField } from "@/ui";

export interface CargoLine { productId: string; quality: number; qtyKg: number | null }

/** Seçilen şehirdeki stoktan yük satırları (en fazla 6). Miktar kg/ton dönüşümlü. */
export function CargoPicker({ cityId, lines, onChange, allowEmpty }: { cityId: string; lines: CargoLine[]; onChange: (l: CargoLine[]) => void; allowEmpty?: boolean }) {
  const { t, qty } = useT();
  const cat = useCat();
  const inv = useData<HoldingDto[]>("/inventory", undefined, ["inventory"]);
  const here = useMemo(() => (inv.data ?? []).filter((h) => h.cityId === cityId && h.availableKg > 0), [inv.data, cityId]);
  const set = (n: number, patch: Partial<CargoLine>) => onChange(lines.map((l, k) => (k === n ? { ...l, ...patch } : l)));
  if (!here.length && !lines.length) return <p className="muted small">{allowEmpty ? t("logistics.emptyLoadOk") : t("logistics.noStockHere")}</p>;
  return (
    <div className="col">
      {lines.map((l, n) => {
        const h = here.find((x) => x.productId === l.productId && x.quality === l.quality);
        return (
          <div key={n} className="card flat tight col tight">
            <SelectField label={t("logistics.cargoItem")} value={`${l.productId}|${l.quality}`} onChange={(v) => { const [p, q] = v.split("|"); set(n, { productId: p!, quality: Number(q), qtyKg: null }); }}
              options={here.map((x) => ({ id: `${x.productId}|${x.quality}`, label: `${cat.product(x.productId)} ★${x.quality} — ${qty(x.availableKg)}` }))} />
            <QtyInput label={t("market.qty")} value={l.qtyKg} onChange={(q) => set(n, { qtyKg: q })} max={h?.availableKg} />
            <Button size="sm" variant="ghost" onClick={() => onChange(lines.filter((_, k) => k !== n))}>{t("common.remove")}</Button>
          </div>
        );
      })}
      {lines.length < 6 && here.length ? <Button size="sm" onClick={() => onChange([...lines, { productId: here[0]!.productId, quality: here[0]!.quality, qtyKg: null }])}>+ {t("logistics.addCargo")}</Button> : null}
    </div>
  );
}

export const cargoBody = (lines: CargoLine[]) => lines.filter((l) => l.qtyKg).map((l) => ({ productId: l.productId, quality: l.quality, qtyKg: l.qtyKg as number }));
export const cargoTotal = (lines: CargoLine[]) => lines.reduce((a, l) => a + (l.qtyKg ?? 0), 0);
