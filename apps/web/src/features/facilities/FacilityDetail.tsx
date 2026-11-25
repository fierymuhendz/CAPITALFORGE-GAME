"use client";
import { useEffect, useMemo, useState } from "react";
import { ApiError, api } from "@/lib/api";
import type { FacilityDto, ProductionJobDto, ProductionQuoteDto } from "@capitalforge/shared";
import { useAction } from "@/lib/action";
import { useCat } from "@/lib/catalog";
import { useInvalidateTick } from "@/lib/data";
import { codeText } from "@/lib/codes";
import { useT } from "@/lib/i18n";
import { ActionBar, Badge, Button, Card, Countdown, Disclosure, KV, Notice, Stepper, SystemBadge, Tag, TimeProgress, Trend } from "@/ui";

function JobRow({ job, onStop, busy }: { job: ProductionJobDto; onStop: (id: string) => void; busy: boolean }) {
  const i = useT();
  const cat = useCat();
  return (
    <div className="card flat tight col tight">
      <div className="row between">
        <b className="nm">{cat.recipe(job.recipeId)} × {job.batches}</b>
        <span className="num" aria-label={i.t("facility.remaining")}><Countdown until={job.endsAt} /></span>
      </div>
      <TimeProgress from={job.startedAt} to={job.endsAt} />
      <div className="row between small muted2">
        <span>→ {cat.product(job.output.productId)} {i.qty(job.output.qtyKg)}</span>
        {job.repeat ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => onStop(job.id)}>↻ {i.t("facility.stopRepeat")}</Button> : null}
      </div>
    </div>
  );
}

type QuoteState = { q: ProductionQuoteDto } | { err: string };

/** Tek tesis: durum, çalışan işler, tarif kartları (tahmini kâr), seçili tarifin özeti ve başlat, yükseltmeler (kapalı). */
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
  const [quotes, setQuotes] = useState<Record<string, QuoteState>>({});
  const tick = useInvalidateTick(["inventory", "company", "market", "facilities"]);
  const running = f.jobs.filter((j) => j.status === "running");
  const freeLines = Math.max(0, f.lines - running.length);
  const ready = f.status !== "constructing";
  const bt = w.buildingTypes.find((b) => b.id === f.type);
  const lvl = bt?.levels.find((l) => l.level === f.level);
  const next = bt?.levels.find((l) => l.level === f.level + 1);
  const canUpgrade = !!lvl && lvl.upgradeCost !== "0" && !f.upgrade && ready;
  const qCost = bt?.qualityUpgradeCosts[f.qualityLevel - 1];
  const canQuality = qCost !== undefined && !f.upgrade && ready;
  const maxB = Math.max(1, f.maxBatches);
  const recipeKey = recipes.map((r) => r.id).join(",");

  useEffect(() => { if (!recipes.some((r) => r.id === recipeId) && recipes[0]) setRecipeId(recipes[0].id); }, [recipeId, recipeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!ready || freeLines === 0 || !Number.isInteger(batches) || batches < 1 || batches > maxB) { setQuotes({}); return; }
    let live = true;
    const h = setTimeout(() => {
      void Promise.all(recipes.map(async (r): Promise<[string, QuoteState]> => {
        try { return [r.id, { q: await api.post<ProductionQuoteDto>("/production/quote", { facilityId: f.id, recipeId: r.id, batches }) }]; }
        catch (e) { return [r.id, { err: i.err(e instanceof ApiError ? e : null) }]; }
      })).then((pairs) => { if (live) setQuotes(Object.fromEntries(pairs)); });
    }, 250);
    return () => { live = false; clearTimeout(h); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.id, maxB, recipeKey, batches, ready, freeLines, tick, i]);

  const sel = quotes[recipeId];
  const q = sel && "q" in sel ? sel.q : null;
  const start = () => run(() => api.post("/production/start", { facilityId: f.id, recipeId, batches, repeat }), { ok: "facility.started" });
  const statusTone = f.status === "stalled" ? "bad" : f.status === "working" ? "good" : f.status === "idle" ? undefined : "warn";
  const bp = w.qualityPriceBp;
  const pctOf = (b: number | undefined) => (b === undefined ? "—" : i.pct(b));

  return (
    <div className="col">
      <div className="row between">
        <div className="col tight" style={{ minWidth: 0 }}><h3 className="nm">{cat.building(f.type)}</h3><span className="muted small">{cat.city(f.cityId)} · {t("common.level")} {f.level} · ★{f.qualityLevel}</span></div>
        <Badge tone={statusTone}>{f.status === "stalled" ? "⚠ " : f.status === "working" ? "▶ " : ""}{t(`facility.status.${f.status}`)}</Badge>
      </div>

      {f.constructionEndsAt && f.status === "constructing" ? <Notice tone="steel">{t("facility.constructing")} <Countdown until={f.constructionEndsAt} /></Notice> : null}
      {f.upgrade ? <Notice tone="steel">{f.upgrade.kind === "level" ? t("facility.upgradingLevel", { n: f.upgrade.target }) : t("facility.upgradingQuality", { n: f.upgrade.target })} <Countdown until={f.upgrade.endsAt} /></Notice> : null}
      {f.stalledReason ? <Notice tone="warn">⚠ {codeText(i, "facility.stalled", f.stalledReason.code)}{f.stalledReason.productId ? `: ${cat.product(f.stalledReason.productId)}` : ""}</Notice> : null}

      {f.lines > 0 ? (
        <>
          <div className="tags"><Tag>{t("facility.lines")}: {running.length}/{f.lines}</Tag><Tag>{t("facility.maxBatches")}: {f.maxBatches}</Tag><Tag>{t("facility.upkeep")}: {i.money(f.upkeepPerDay, true)}/{t("common.day")}</Tag></div>
          {running.map((j) => <JobRow key={j.id} job={j} busy={busy} onStop={(id) => void run(() => api.post(`/production/${id}/stop-repeat`), { ok: "facility.repeatStopped" })} />)}

          {ready && freeLines > 0 ? (
            <>
              <h4>{t("facility.newJob")}</h4>
              <div className="choice-grid" role="group" aria-label={t("facility.recipe")}>
                {recipes.map((r) => {
                  const st = quotes[r.id];
                  const rq = st && "q" in st ? st.q : null;
                  const locked = r.minBuildingLevel > f.level;
                  return (
                    <button key={r.id} type="button" className="choice" aria-pressed={recipeId === r.id} onClick={() => setRecipeId(r.id)}>
                      <span className="t">{cat.recipe(r.id)}</span>
                      <span className="s">→ {cat.product(r.output.productId)} · {i.dur(r.minutes)}</span>
                      {locked ? <span className="s warn">⚠ {t("facility.needLevel", { n: r.minBuildingLevel })}</span>
                        : rq ? (rq.estimate ? <Trend value={rq.estimate.profit} text={`${t("facility.estProfit")} ${i.signed(rq.estimate.profit)}`} /> : <span className="s muted">{t("facility.noEstimate")}</span>)
                        : st ? <span className="s warn">⚠ {t("quote.cantStart")}</span> : <span className="s muted">…</span>}
                    </button>
                  );
                })}
              </div>

              <div className="row wrap" style={{ justifyContent: "space-between" }}>
                <div className="row"><span className="small muted2">{t("facility.batches")}</span><Stepper label={t("facility.batches")} value={batches} onChange={setBatches} min={1} max={maxB} /></div>
                <button type="button" className="chip" aria-pressed={repeat} onClick={() => setRepeat(!repeat)} title={t("facility.repeatOpt")}>↻ {t("facility.repeatToggle")}</button>
              </div>

              {sel && "err" in sel ? <Notice tone="bad">{sel.err}</Notice> : null}
              {q ? (
                <Card flat><div className="col tight" aria-live="polite">
                  {q.inputs.map((x) => {
                    const short = x.availableKg < x.requiredKg;
                    return <KV key={x.productId} k={cat.product(x.productId)} v={<span className={short ? "bad" : ""}>{short ? "✕ " : "✓ "}{i.qty(x.availableKg)} / {i.qty(x.requiredKg)}</span>} />;
                  })}
                  {q.inputs.length ? <hr className="sep" /> : null}
                  <KV k={t("quote.output")} v={<b>{cat.product(q.output.productId)} {i.qty(q.output.qtyKg)} · ★{q.output.quality}</b>} />
                  <KV k={t("quote.duration")} v={<span>{i.dur(q.minutes)}</span>} />
                  <KV k={t("quote.total")} v={<b>{i.money(q.cost.total)}</b>} />
                  <KV k={t("facility.estProfit")} v={q.estimate ? <span className="row" style={{ justifyContent: "flex-end", flexWrap: "wrap" }}><Trend value={q.estimate.profit} text={i.signed(q.estimate.profit)} /><span className="muted xs">({i.signed(q.estimate.profitPerHour)}/{t("common.hourShort")})</span></span> : <span className="muted">{t("quote.noBuyers")}</span>} />
                  {q.blockers.map((b, n) => <Notice key={n} tone="warn">⚠ {codeText(i, "quote.blocker", b.code)}{b.productId ? `: ${cat.product(b.productId)}` : ""}{b.missingKg ? ` (${i.qty(b.missingKg)})` : ""}{b.missing ? ` (${i.money(b.missing)})` : ""}</Notice>)}
                  <Disclosure summary={t("facility.breakdown")}>
                    <KV k={t("quote.inputsCost")} v={i.money(q.cost.inputs)} />
                    <KV k={t("quote.energy")} v={`${i.num(q.energyKwh)} kWh · ${i.money(q.cost.energy)}`} />
                    <KV k={t("quote.water")} v={`${i.num(q.waterM3)} m³ · ${i.money(q.cost.water)}`} />
                    <KV k={t("quote.labor")} v={`${i.num(q.laborHours)} ${t("found.hour")} · ${i.money(q.cost.labor)}`} />
                    <KV k={t("quote.unitCost")} v={<b>{i.price(q.unitCostPerKg)}</b>} />
                    {q.bestBuyers.map((b, n) => <KV key={n} k={<span className="row">{b.companyName} {b.isSystem ? <SystemBadge /> : null} · {cat.city(b.cityId)} {b.km} km</span>} v={<b className="num">{i.price(b.pricePerKg)}</b>} />)}
                  </Disclosure>
                </div></Card>
              ) : null}
              <ActionBar>
                {q ? <div className="total"><span>{t("quote.total")}</span><b className="num">{i.money(q.cost.total)}</b></div> : null}
                <Button variant="primary" loading={busy} disabled={!q?.canStart} onClick={() => void start()}>{t("facility.start")}</Button>
              </ActionBar>
            </>
          ) : ready && freeLines === 0 ? <span className="muted small">{t("facility.allBusy")}</span> : null}
        </>
      ) : null}

      {bt?.vehicleSlots ? <KV k={t("facility.vehicleSlots")} v={bt.vehicleSlots[f.level - 1] ?? "—"} /> : null}

      {lvl && (lvl.upgradeCost !== "0" || qCost !== undefined) ? (
        <Disclosure summary={t("facility.improve")}>
          {lvl.upgradeCost !== "0" && next ? (
            <div className="col tight">
              <b>{t("facility.upgradeTo", { n: f.level + 1 })}</b>
              <div className="tags">
                {next.lines !== lvl.lines ? <Tag tone="good">{t("facility.fx.lines", { a: lvl.lines, b: next.lines })}</Tag> : null}
                {next.maxBatches !== lvl.maxBatches ? <Tag tone="good">{t("facility.fx.batches", { a: lvl.maxBatches, b: next.maxBatches })}</Tag> : null}
                {(next.yieldBp ?? 0) > (lvl.yieldBp ?? 0) ? <Tag tone="good">{t("facility.fx.yield", { a: i.pct(next.yieldBp ?? 0) })}</Tag> : null}
                {(next.inputSavingBp ?? 0) > (lvl.inputSavingBp ?? 0) ? <Tag tone="good">{t("facility.fx.inputs", { a: i.pct(next.inputSavingBp ?? 0) })}</Tag> : null}
                {(next.efficiencyBp ?? 0) > (lvl.efficiencyBp ?? 0) ? <Tag tone="good">{t("facility.fx.efficiency", { a: i.pct(next.efficiencyBp ?? 0) })}</Tag> : null}
                {(next.qualityBonus ?? 0) > (lvl.qualityBonus ?? 0) ? <Tag tone="good">{t("facility.fx.qualityBonus", { a: next.qualityBonus ?? 0 })}</Tag> : null}
                <Tag>{t("facility.fx.upkeep", { a: i.money(next.upkeepPerDay, true) })}</Tag>
              </div>
              <KV k={t("facility.cost")} v={`${i.money(lvl.upgradeCost)} + ${i.qty(lvl.upgradeSteelKg)} ${cat.product("steel")} · ${i.dur(lvl.upgradeMinutes)}`} />
              <Button disabled={!canUpgrade} loading={busy} onClick={() => void run(() => api.post(`/facilities/${f.id}/upgrade`), { ok: "facility.upgradeStarted" })}>{t("facility.upgrade")}</Button>
            </div>
          ) : null}
          {qCost !== undefined ? (
            <div className="col tight">
              <b>{t("facility.qualityTo", { n: f.qualityLevel + 1 })}</b>
              <div className="tags"><Tag tone="good">{t("facility.fx.quality", { a: pctOf(bp[f.qualityLevel]), b: pctOf(bp[f.qualityLevel + 1]) })}</Tag></div>
              <KV k={t("facility.cost")} v={i.money(qCost)} />
              <Button disabled={!canQuality} loading={busy} onClick={() => void run(() => api.post(`/facilities/${f.id}/quality`), { ok: "facility.qualityStarted" })}>{t("facility.improveQuality")}</Button>
            </div>
          ) : null}
        </Disclosure>
      ) : null}
    </div>
  );
}
