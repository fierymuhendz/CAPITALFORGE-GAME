"use client";

import { useEffect, useMemo, useState } from "react";
import { formatMoney } from "@capitalforge/economy";
import { CITY, FACILITY_TYPE_IDS, type FacilityTypeId } from "@capitalforge/shared";
import { FACILITY_GLYPH, facilityLabel } from "../lib/labels";
import { useGame } from "./GameProvider";
import { Feedback, useAction } from "./useAction";

const focus = "outline-none focus-visible:ring-2 focus-visible:ring-white";
const REFRESH_MS = 20000;

interface Plot {
  x: number;
  y: number;
}

export function CityGrid() {
  const { city, company, catalog, refreshCity } = useGame();
  const { run, busy, message, connected } = useAction("buyFacility");
  const [sel, setSel] = useState<Plot | null>(null);
  const [type, setType] = useState<FacilityTypeId | null>(null);

  // Başkalarının alımları görünsün diye arsa listesi aralıkla tazelenir.
  useEffect(() => {
    const t = setInterval(refreshCity, REFRESH_MS);
    return () => clearInterval(t);
  }, [refreshCity]);

  const taken = useMemo(() => {
    const m = new Map<string, { type: FacilityTypeId; companyName: string }>();
    city?.plots.forEach((p) => m.set(`${p.plotX},${p.plotY}`, { type: p.type, companyName: p.companyName }));
    return m;
  }, [city]);
  const mine = useMemo(() => new Set(company?.facilities.map((f) => `${f.plotX},${f.plotY}`)), [company]);

  const occupant = sel ? taken.get(`${sel.x},${sel.y}`) : undefined;
  const hasCompany = company?.company != null;
  const price = catalog?.facilityTypes.find((t) => t.type === type);

  async function buy() {
    if (!sel || !type) return;
    const res = await run({ type, plotX: sel.x, plotY: sel.y }, () => "Tesis satın alındı.");
    if (res?.ok) {
      setType(null);
    }
    if (res && !res.ok && res.error === "PLOT_TAKEN") refreshCity();
  }

  return (
    <section aria-label="Şehir haritası" className="rounded-lg bg-slate-900 p-4">
      <h2 className="mb-2 text-sm text-slate-400">Şehir: {city?.cityId ?? CITY.defaultId}</h2>
      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="overflow-auto rounded border border-slate-800 [touch-action:pan-x_pan-y]" data-testid="city-scroll">
          <div
            role="grid"
            aria-label={`${CITY.width} x ${CITY.height} arsa ızgarası`}
            className="grid w-max gap-px bg-slate-800 p-px"
            style={{ gridTemplateColumns: `repeat(${CITY.width}, 2.5rem)` }}
          >
            {Array.from({ length: CITY.width * CITY.height }, (_, i) => {
              const x = i % CITY.width;
              const y = Math.floor(i / CITY.width);
              const key = `${x},${y}`;
              const occ = taken.get(key);
              const own = mine.has(key);
              const selected = sel?.x === x && sel?.y === y;
              const label = occ
                ? `Arsa ${x},${y}: ${facilityLabel(occ.type)}, ${occ.companyName}${own ? " (sizin)" : ""}`
                : `Arsa ${x},${y}: boş`;
              return (
                <button
                  key={key}
                  type="button"
                  role="gridcell"
                  aria-label={label}
                  aria-selected={selected}
                  data-testid={`plot-${x}-${y}`}
                  onClick={() => {
                    setSel({ x, y });
                    setType(null);
                  }}
                  className={`flex h-10 w-10 items-center justify-center text-sm font-bold ${focus} ${
                    selected ? "ring-2 ring-white" : ""
                  } ${own ? "bg-emerald-800 text-emerald-100" : occ ? "bg-slate-600 text-slate-100" : "bg-slate-950 text-slate-600 hover:bg-slate-800"}`}
                >
                  {occ ? `${FACILITY_GLYPH[occ.type]}${own ? "★" : ""}` : "·"}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3 text-sm" aria-live="polite">
          <p className="text-xs text-slate-400">
            Harf: Ç çiftlik, M maden, S santral, D değirmen, K çelikhane. ★ sizin tesisiniz.
          </p>
          {!sel && <p className="text-slate-400">Bir arsa seçin.</p>}
          {sel && occupant && (
            <p data-testid="plot-info">
              Arsa ({sel.x}, {sel.y}): <strong>{facilityLabel(occupant.type)}</strong> — {occupant.companyName}
              {mine.has(`${sel.x},${sel.y}`) ? " (sizin)" : ""}
            </p>
          )}
          {sel && !occupant && (
            <div className="flex flex-col gap-3">
              <p>Boş arsa ({sel.x}, {sel.y}). Tesis türü seçin:</p>
              {!hasCompany && <p className="text-amber-300">⚠ Tesis almak için önce şirket kurun.</p>}
              <div role="radiogroup" aria-label="Tesis türü" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {FACILITY_TYPE_IDS.map((t) => {
                  const info = catalog?.facilityTypes.find((c) => c.type === t);
                  return (
                    <button
                      key={t}
                      type="button"
                      role="radio"
                      aria-checked={type === t}
                      data-testid={`type-${t}`}
                      onClick={() => setType(t)}
                      className={`flex min-h-12 items-center justify-between gap-2 rounded p-3 text-left ${focus} ${
                        type === t ? "bg-emerald-700" : "bg-slate-800 hover:bg-slate-700"
                      }`}
                    >
                      <span>{type === t ? "✓ " : ""}{facilityLabel(t)}</span>
                      <span className="tabular-nums text-slate-300">{info ? formatMoney(BigInt(info.price)) : "…"}</span>
                    </button>
                  );
                })}
              </div>
              {price && type && (
                <p className="text-slate-400">
                  Bakım (dönem başına): {formatMoney(BigInt(price.upkeep))}
                </p>
              )}
              <button
                type="button"
                onClick={() => void buy()}
                disabled={!type || !hasCompany || busy || !connected}
                data-testid="buy-facility"
                className={`rounded bg-emerald-600 p-3 font-semibold hover:bg-emerald-500 disabled:opacity-50 ${focus}`}
              >
                {busy ? "Gönderiliyor…" : price ? `Satın al (${formatMoney(BigInt(price.price))})` : "Satın al"}
              </button>
            </div>
          )}
          <Feedback message={message} testId="buy-message" />
        </div>
      </div>
    </section>
  );
}
