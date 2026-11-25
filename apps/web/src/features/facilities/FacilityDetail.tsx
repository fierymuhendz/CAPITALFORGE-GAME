"use client";
import { useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import type { FacilityDto, ProductionJobDto, ProductionQuoteDto } from "@capitalforge/shared";
import { useAction } from "@/lib/action";
import { useCat } from "@/lib/catalog";
import { useInvalidateTick } from "@/lib/data";
import { codeText } from "@/lib/codes";
import { useT } from "@/lib/i18n";
import { Badge, Button, Card, Countdown, IntInput, KV, Notice, SelectField, SystemBadge, TimeProgress } from "@/ui";

function JobRow({ job, onStop, busy }: { job: ProductionJobDto; onStop: (id: string) => void; busy: boolean }) {
  const i = useT();
  const cat = useCat();
  return (
    <div className="card flat tight col tight">
      <div className="row between">
        <b>{cat.recipe(job.recipeId)} × {job.batches}</b>
        <span className="num" aria-label={i.t("facility.remaining")}><Countdown until={job.endsAt} /></span>
      </div>
      <TimeProgress from={job.startedAt} to={job.endsAt} />
      <div className="row between small muted2">
        <span>→ {cat.product(job.output.productId)} {i.qty(job.output.qtyKg)} · {i.t("common.quality")} {job.output.quality}</span>
        {job.repeat ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => onStop(job.id)}>{i.t("facility.stopRepeat")}</Button> : null}
      </div>
      {job.repeat ? <Badge tone="forge">↻ {i.t("facility.repeat")}</Badge> : null}
    </div>
  );
}

/** Tek tesis: durum, hatlar, tarif seçimi + teklif, başlat, yükseltme, kalite. Tek elle: büyük başlat düğmesi altta. */
export function FacilityDetail({ f }: { f: FacilityDto }) {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const { run, busy } = useAction();
  const w = cat.world;
  const recipes = w.recipes.filter((r) => f.recipes.includes(r.id));
  const [recipeId, setRecipeId] = useState(recipes[0]?.id ?? "");
  const [batches, setBatches] = useState(1);
  const [repeat, setRepeat] = useState(false);
  const [quote, setQuote] = useState<ProductionQuoteDto | null>(null);
  const [qErr, setQErr] = useState<string | null>(null);
  const tick = useInvalidateTick(["inventory", "company", "market", "facilities"]);
  const running = f.jobs.filter((j) => j.status === "running");
  const freeLines = Math.max(0, f.lines - running.length);
  const ready = f.status !== "constructing";
  const bt = w.buildingTypes.find((b) => b.id === f.type);
  const lvl = bt?.levels.find((l) => l.level === f.level);
  const canUpgrade = !!lvl && lvl.upgradeCost !== "0" && !f.upgrade && ready;
  const qCost = bt?.qualityUpgradeCosts[f.qualityLevel - 1];
  const canQuality = qCost !== undefined && !f.upgrade && ready;

  useEffect(() => { if (!recipeId && recipes[0]) setRecipeId(recipes[0].id); }, [recipeId, recipes]);
  useEffect(() => {
    if (!recipeId || !ready || freeLines === 0 || !Number.isInteger(batches) || batches < 1 || batches > Math.max(1, f.maxBatches)) { setQuote(null); setQErr(null); return; }
    let live = true;
    const h = setTimeout(() => {
      api.post<ProductionQuoteDto>("/production/quote", { facilityId: f.id, recipeId, batches })
        .then((q) => { if (live) { setQuote(q); setQErr(null); } })
        .catch((e) => { if (live) { setQuote(null); setQErr(i.err(e instanceof ApiError ? e : null)); } });
    }, 250);
    return () => { live = false; clearTimeout(h); };
  }, [f.id, f.maxBatches, recipeId, batches, ready, freeLines, tick, i]);

  const start = () => run(() => api.post("/production/start", { facilityId: f.id, recipeId, batches, repeat }), { ok: "facility.started" });

  return (
    <div className="col">
      <div className="row between wrap">
        <div className="col tight"><h3>{cat.building(f.type)}</h3><span className="muted small">{cat.city(f.cityId)} · {t("common.level")} {f.level} · {t("common.quality")} {f.qualityLevel}</span></div>
        <Badge tone={f.status === "stalled" ? "bad" : f.status === "working" ? "good" : f.status === "idle" ? undefined : "warn"}>{f.status === "stalled" ? "⚠ " : f.status === "working" ? "▶ " : ""}{t(`facility.status.${f.status}`)}</Badge>
      </div>

      {f.constructionEndsAt && f.status === "constructing" ? <Notice tone="steel">{t("facility.constructing")} <Countdown until={f.constructionEndsAt} /></Notice> : null}
      {f.upgrade ? <Notice tone="steel">{f.upgrade.kind === "level" ? t("facility.upgradingLevel", { n: f.upgrade.target }) : t("facility.upgradingQuality", { n: f.upgrade.target })} <Countdown until={f.upgrade.endsAt} /></Notice> : null}
      {f.stalledReason ? (
        <Notice tone="warn">⚠ {codeText(i, "facility.stalled", f.stalledReason.code)}{f.stalledReason.productId ? `: ${cat.product(f.stalledReason.productId)}` : ""}</Notice>
      ) : null}

      {f.lines > 0 ? (
        <>
          <KV k={t("facility.lines")} v={`${running.length}/${f.lines}`} />
          <KV k={t("facility.maxBatches")} v={f.maxBatches} />
          <KV k={t("facility.upkeep")} v={`${i.money(f.upkeepPerDay)}/${t("common.day")}`} />
          {running.map((j) => <JobRow key={j.id} job={j} busy={busy} onStop={(id) => void run(() => api.post(`/production/${id}/stop-repeat`), { ok: "facility.repeatStopped" })} />)}

          {ready && freeLines > 0 ? (
            <Card flat><div className="col">
              <h4>{t("facility.newJob")}</h4>
              <SelectField label={t("facility.recipe")} value={recipeId} onChange={setRecipeId} options={recipes.map((r) => ({ id: r.id, label: `${cat.recipe(r.id)} — ${r.inputs.length ? r.inputs.map((x) => cat.product(x.productId)).join(" + ") : t("facility.noInputs")} → ${cat.product(r.output.productId)}` }))} />
              <IntInput label={t("facility.batches")} value={batches} onChange={setBatches} min={1} max={Math.max(1, f.maxBatches)} hint={t("facility.batchesHint", { n: f.maxBatches })} />
              <label className="row" style={{ minHeight: 44 }}><input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} style={{ width: 20, height: 20 }} /> {t("facility.repeatOpt")}</label>
              {qErr ? <Notice tone="bad">{qErr}</Notice> : null}
              {quote ? <QuoteView q={quote} /> : null}
              <div className="sticky-cta">
                <Button variant="primary" size="lg" loading={busy} disabled={!quote?.canStart} onClick={() => void start()}>{t("facility.start")}</Button>
              </div>
            </div></Card>
          ) : ready && freeLines === 0 ? <Notice>{t("facility.allBusy")}</Notice> : null}
        </>
      ) : null}

      {bt?.vehicleSlots ? <KV k={t("facility.vehicleSlots")} v={bt.vehicleSlots[f.level - 1] ?? "—"} /> : null}

      <Card flat><div className="col">
        <h4>{t("facility.improve")}</h4>
        {lvl && lvl.upgradeCost !== "0" ? (
          <div className="col tight">
            <KV k={t("facility.upgradeTo", { n: f.level + 1 })} v={`${i.money(lvl.upgradeCost)} + ${i.qty(lvl.upgradeSteelKg)} ${cat.product("steel")} · ${t("common.minutes", { n: lvl.upgradeMinutes })}`} />
            <Button disabled={!canUpgrade} loading={busy} onClick={() => void run(() => api.post(`/facilities/${f.id}/upgrade`), { ok: "facility.upgradeStarted" })}>{t("facility.upgrade")}</Button>
          </div>
        ) : <p className="muted small">{t("errors.MAX_LEVEL")}</p>}
        {qCost !== undefined ? (
          <div className="col tight">
            <KV k={t("facility.qualityTo", { n: f.qualityLevel + 1 })} v={i.money(qCost)} />
            <Button disabled={!canQuality} loading={busy} onClick={() => void run(() => api.post(`/facilities/${f.id}/quality`), { ok: "facility.qualityStarted" })}>{t("facility.improveQuality")}</Button>
          </div>
        ) : null}
      </div></Card>
    </div>
  );
}

function QuoteView({ q }: { q: ProductionQuoteDto }) {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  return (
    <div className="col tight" aria-live="polite">
      <h4>{t("quote.title")}</h4>
      {q.inputs.map((x) => {
        const short = x.availableKg < x.requiredKg;
        return <KV key={x.productId} k={cat.product(x.productId)} v={<span className={short ? "bad" : ""}>{short ? "✕ " : "✓ "}{i.qty(x.requiredKg)} ({t("quote.have")} {i.qty(x.availableKg)}) · {i.money(x.estCost)}</span>} />;
      })}
      <KV k={t("quote.output")} v={<b>{cat.product(q.output.productId)} {i.qty(q.output.qtyKg)} · {t("common.quality")} {q.output.quality}</b>} />
      <KV k={t("quote.duration")} v={<>{t("common.minutes", { n: q.minutes })} · <Countdown until={q.endsAt} doneText="—" /></>} />
      <KV k={t("quote.energy")} v={`${i.num(q.energyKwh)} kWh · ${i.money(q.cost.energy)}`} />
      <KV k={t("quote.water")} v={`${i.num(q.waterM3)} m³ · ${i.money(q.cost.water)}`} />
      <KV k={t("quote.labor")} v={`${i.num(q.laborHours)} ${t("found.hour")} · ${i.money(q.cost.labor)}`} />
      <KV k={t("quote.inputsCost")} v={i.money(q.cost.inputs)} />
      <KV k={t("quote.total")} v={<b>{i.money(q.cost.total)}</b>} />
      <KV k={t("quote.unitCost")} v={<b>{i.price(q.unitCostPerKg)}</b>} />
      {q.bestBuyers.length ? (
        <div className="col tight">
          <h4>{t("quote.bestBuyers")}</h4>
          {q.bestBuyers.map((b, n) => (
            <div key={n} className="row between small"><span className="row">{b.companyName} {b.isSystem ? <SystemBadge /> : null} · {cat.city(b.cityId)} {b.km} km</span><b className="num">{i.price(b.pricePerKg)}</b></div>
          ))}
        </div>
      ) : <p className="muted small">{t("quote.noBuyers")}</p>}
      {q.blockers.map((b, n) => <Notice key={n} tone="warn">⚠ {codeText(i, "quote.blocker", b.code)}{b.productId ? `: ${cat.product(b.productId)}` : ""}{b.missingKg ? ` (${i.qty(b.missingKg)})` : ""}{b.missing ? ` (${i.money(b.missing)})` : ""}</Notice>)}
    </div>
  );
}
