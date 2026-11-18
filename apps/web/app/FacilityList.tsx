"use client";

import { formatMoney } from "@capitalforge/economy";
import { FACILITY_GLYPH, facilityLabel, formatDuration, productLabel, recipeLabel } from "../lib/labels";
import { useGame } from "./GameProvider";

export function FacilityList() {
  const { company, clockTick } = useGame();
  if (!company?.company) {
    return (
      <section aria-label="Tesisler" className="rounded-lg bg-slate-900 p-4">
        <h2 className="text-sm font-semibold tracking-wide text-slate-300">Tesisler</h2>
        <p className="mt-2 text-sm text-slate-400" data-testid="facilities-empty">
          {company ? "Tesis almak için önce şirket kurun." : "Yükleniyor…"}
        </p>
      </section>
    );
  }
  // İlerleme yalnızca sunucu oyun saatiyle ölçülür; istemci saati kullanılmaz.
  const now = clockTick ?? company.clockTick;

  return (
    <section aria-label="Tesisler" className="rounded-lg bg-slate-900 p-4">
      <h2 className="text-sm font-semibold tracking-wide text-slate-300">Tesisler</h2>
      {company.facilities.length === 0 ? (
        <p className="mt-2 text-sm text-slate-400">Henüz tesisiniz yok. Haritadan bir arsa seçin.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-3">
          {company.facilities.map((f) => {
            const job = company.jobs.find((j) => j.facilityId === f.id);
            const span = job ? Math.max(1, job.completesAtTick - job.startedTick) : 1;
            const pct = job ? Math.min(100, Math.max(0, Math.floor(((now - job.startedTick) * 100) / span))) : 0;
            const left = job ? Math.max(0, job.completesAtTick - now) : 0;
            return (
              <li key={f.id} data-testid={`facility-${f.type}`} className="rounded bg-slate-800 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">
                    {FACILITY_GLYPH[f.type]} · {facilityLabel(f.type)} <span className="text-slate-400">({f.plotX}, {f.plotY})</span>
                  </span>
                  <span className={f.status === "active" ? "text-emerald-300" : "text-amber-300"}>
                    {f.status === "active" ? "● Aktif" : "⚠ Askıda"}
                  </span>
                </div>
                {f.status === "suspended" && (
                  <p role="alert" className="mt-1 text-amber-300">
                    ⚠ Bakım ücreti ödenemedi, tesis askıda. Bakiye yeterli olunca sonraki dönemde yeniden etkinleşir.
                  </p>
                )}
                <p className="mt-1 text-xs text-slate-400">Bakım (dönem): {formatMoney(BigInt(f.upkeep))}</p>
                {job ? (
                  <div className="mt-2">
                    <p>
                      {recipeLabel(job.recipeId)}: {job.outputQty} {productLabel(job.outputProductId)} · {job.batches} parti
                    </p>
                    <div
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={pct}
                      aria-label={`${facilityLabel(f.type)} üretim ilerlemesi`}
                      className="mt-1 h-2 w-full overflow-hidden rounded bg-slate-700"
                    >
                      <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="mt-1 text-xs text-slate-400" data-testid="job-progress">
                      %{pct} · kalan {formatDuration(left)}
                    </p>
                  </div>
                ) : (
                  <p className="mt-2 text-slate-400">Boşta</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
