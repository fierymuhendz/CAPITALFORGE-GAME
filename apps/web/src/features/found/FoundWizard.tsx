"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { FoundCompanyReq, SECTORS, SYSTEM_PROFILES, type OnboardingDto, type Sector } from "@capitalforge/shared";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app";
import { useAction } from "@/lib/action";
import { useCat } from "@/lib/catalog";
import { useData } from "@/lib/data";
import { useGate } from "@/lib/gate";
import { useT, type I18n } from "@/lib/i18n";
import { Async, Badge, Button, Card, EmptyState, KV, Notice, ProgressBar, Seg, TextField } from "@/ui";
import { Brand, LangSwitch, ThemeToggle } from "../common/Chrome";
import { PlotGrid } from "./PlotGrid";

const STEPS = ["name", "city", "sector", "plot", "preview"] as const;
type Step = (typeof STEPS)[number];
type Plot = OnboardingDto["plots"][number];

export function FoundWizard() {
  const ok = useGate("no-company");
  const i = useT();
  const { t, name, money, pct } = i;
  const { world, refreshMe } = useApp();
  const cat = useCat();
  const router = useRouter();
  const { run, busy } = useAction();
  const [step, setStep] = useState<Step>("name");
  const [cname, setName] = useState("");
  const [cityId, setCity] = useState<string | null>(null);
  const [sector, setSector] = useState<Sector | null>(null);
  const [starter, setStarter] = useState<"food_plant" | "steel_mill">("food_plant");
  const [plotId, setPlot] = useState<string | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const pickPlot = (id: string) => {
    setPlot(id);
    // seçilen arsanın fiyat, konum ve uzaklık kartını görünür alana getir
    requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }));
  };
  const [view, setView] = useState<"map" | "list">("map");

  const nameCheck = FoundCompanyReq.shape.name.safeParse(cname);
  const needOnb = (step === "plot" || step === "preview") && !!cityId && !!sector;
  const onb = useData<OnboardingDto>(needOnb ? "/world/onboarding" : null, { cityId, sector, starterBuilding: sector === "manufacturing" ? starter : undefined }, []);
  const idx = STEPS.indexOf(step);
  const plot = onb.data?.plots.find((p) => p.id === plotId) ?? null;

  const canNext =
    step === "name" ? nameCheck.success : step === "city" ? !!cityId : step === "sector" ? !!sector : step === "plot" ? !!plot?.eligible : true;

  async function found() {
    if (!cityId || !sector || !plotId) return;
    const body = { name: cname.trim(), cityId, sector, plotId, starterBuilding: sector === "manufacturing" ? starter : undefined };
    if (!FoundCompanyReq.omit({ idempotencyKey: true }).safeParse(body).success) return;
    const r = await run(() => api.post("/company", body), { ok: "found.done" });
    if (r) { refreshMe(); router.replace("/play"); }
  }

  if (!ok || !world) return null;
  return (
    <main className="page">
      <div className="topbar"><Brand /><span className="grow" /><ThemeToggle /><LangSwitch /></div>
      <div className="page-inner">
        <div className="col tight">
          <p className="muted small" aria-live="polite">{t("found.step", { n: idx + 1, total: STEPS.length })}</p>
          <ProgressBar value={((idx + 1) / STEPS.length) * 100} label={t("found.title")} />
          <h1>{t(`found.s_${step}`)}</h1>
          <p className="muted2">{t(`found.s_${step}_hint`)}</p>
        </div>

        {step === "name" ? (
          <Card><div className="col">
            <TextField label={t("found.companyName")} value={cname} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="organization" hint={t("found.nameHint")} error={cname && !nameCheck.success ? t("found.nameBad") : null} />
          </div></Card>
        ) : null}

        {step === "city" ? (
          <div className="cards">
            {world.cities.map((c) => {
              const profs = SYSTEM_PROFILES.filter((p) => p.cityId === c.id);
              const sells = [...new Set(profs.flatMap((p) => Object.keys(p.sells)))].filter((x) => x !== "seed");
              const buys = [...new Set(profs.flatMap((p) => Object.keys(p.buys)))];
              return (
                <Card key={c.id} onClick={() => setCity(c.id)} selected={cityId === c.id}>
                  <div className="col tight">
                    <div className="row"><span className="dot" style={{ background: c.color }} aria-hidden="true" /><h3>{name(c.name)}</h3></div>
                    <p className="muted2 small">{name(c.blurb)}</p>
                    <hr className="sep" />
                    <KV k={t("found.resources")} v={sells.map((p) => cat.product(p)).join(", ") || "—"} />
                    <KV k={t("found.localDemand")} v={buys.map((p) => cat.product(p)).join(", ") || "—"} />
                    <KV k={t("found.energy")} v={`${money(c.energyPrice)}/kWh`} />
                    <KV k={t("found.water")} v={`${money(c.waterPrice)}/m³`} />
                    <KV k={t("found.wage")} v={`${money(c.wage)}/${t("found.hour")}`} />
                    <KV k={t("found.labor")} v={`${name(c.laborNote)} (${pct(c.laborAvailability)})`} />
                  </div>
                </Card>
              );
            })}
          </div>
        ) : null}

        {step === "sector" ? (
          <div className="col">
            <div className="cards">
              {SECTORS.map((s) => {
                const b = world.buildingTypes.find((x) => x.sector === s && s !== "manufacturing");
                const yieldBp = cityId ? world.cities.find((c) => c.id === cityId)?.sectorYieldBp[s] : undefined;
                return (
                  <Card key={s} onClick={() => setSector(s)} selected={sector === s}>
                    <div className="col tight">
                      <h3>{t(`sector.${s}`)}</h3>
                      <p className="muted2 small">{t(`sector.${s}Desc`)}</p>
                      <KV k={t("found.startBuilding")} v={s === "manufacturing" ? `${cat.building("food_plant")} / ${cat.building("steel_mill")}` : b ? name(b.name) : "—"} />
                      {yieldBp ? <KV k={t("found.cityYield")} v={pct(yieldBp)} /> : null}
                    </div>
                  </Card>
                );
              })}
            </div>
            {sector === "manufacturing" ? (
              <Card><div className="col tight">
                <span className="card-title">{t("found.starterChoice")}</span>
                <Seg label={t("found.starterChoice")} value={starter} onChange={setStarter} items={[{ id: "food_plant", label: cat.building("food_plant") }, { id: "steel_mill", label: cat.building("steel_mill") }]} />
                <p className="muted small">{t(starter === "food_plant" ? "found.foodHint" : "found.steelHint")}</p>
              </div></Card>
            ) : null}
          </div>
        ) : null}

        {step === "plot" ? (
          <Async res={onb}>
            {(d) => (
              <div className="col">
                <div className="row between wrap">
                  <span className="muted2 small">{t("found.cash")}: <b className="num">{money(d.startingCash)}</b></span>
                  <Seg label={t("found.view")} value={view} onChange={setView} items={[{ id: "map", label: t("found.viewMap") }, { id: "list", label: t("found.viewList") }]} />
                </div>
                {!d.plots.some((p) => p.eligible) ? <EmptyState title={t("found.noEligible")} text={t("found.noEligibleText")} action={<Button onClick={() => setStep("city")}>{t("found.changeCity")}</Button>} /> : null}
                {view === "map" ? <PlotGrid plots={d.plots} selected={plotId} onSelect={pickPlot} /> : (
                  <div className="cards">{d.plots.map((p) => <PlotCard key={p.id} p={p} sector={sector!} selected={plotId === p.id} onClick={() => pickPlot(p.id)} />)}</div>
                )}
                <div ref={detailRef} style={{ scrollMarginBottom: 96 }}>
                  {plot ? <PlotDetail p={plot} sector={sector!} /> : <Notice tone="steel">{t("found.pickPlot")}</Notice>}
                </div>
              </div>
            )}
          </Async>
        ) : null}

        {step === "preview" ? (
          <Async res={onb}>
            {(d) => (
              <Card><div className="col">
                <h3>{cname}</h3>
                <KV k={t("found.city")} v={cat.city(cityId)} />
                <KV k={t("found.sector")} v={sector ? t(`sector.${sector}`) : ""} />
                <KV k={t("found.startBuilding")} v={cat.building(d.starter.building)} />
                {d.starter.vehicle ? <KV k={t("found.startVehicle")} v={cat.vehicle(d.starter.vehicle)} /> : null}
                {plot ? <KV k={t("found.plot")} v={`${cat.city(plot.cityId)} ${plot.gx + 1}·${plot.gz + 1} — ${money(plot.price)}`} /> : null}
                <KV k={t("found.cash")} v={money(d.startingCash)} />
                {d.starter.inputs.length ? <KV k={t("found.gift")} v={d.starter.inputs.map((x) => `${cat.product(x.productId)} ${i.qty(x.kg)}`).join(", ")} /> : null}
                <hr className="sep" />
                <h4>{t("found.firstJob")}</h4>
                <p className="muted2 small">{name(d.starter.firstJob.hint)}</p>
                {d.starter.firstJob.recipeId ? (
                  <div className="grid3">
                    <div className="stat"><span className="k">{t("found.estCost")}</span><span className="v">{money(d.starter.firstJob.estCost)}</span></div>
                    <div className="stat"><span className="k">{t("found.estRevenue")}</span><span className="v">{money(d.starter.firstJob.estRevenue)}</span></div>
                    <div className="stat"><span className="k">{t("found.duration")}</span><span className="v">{i.dur(d.starter.firstJob.minutes)}</span></div>
                  </div>
                ) : null}
                <Notice tone="steel">{t("found.estNote")}</Notice>
              </div></Card>
            )}
          </Async>
        ) : null}

        <div className="row between" style={{ position: "sticky", bottom: 0, padding: "var(--sp-3) 0", background: "linear-gradient(transparent, var(--bg) 35%)" }}>
          <Button variant="ghost" disabled={idx === 0} onClick={() => setStep(STEPS[idx - 1]!)}>{t("common.back")}</Button>
          {step === "preview" ? (
            <Button variant="primary" size="lg" loading={busy} onClick={() => void found()} className="grow">{t("found.create")}</Button>
          ) : (
            <Button variant="primary" disabled={!canNext} onClick={() => setStep(STEPS[idx + 1]!)}>{t("common.next")}</Button>
          )}
        </div>
      </div>
    </main>
  );
}

function efficiency(p: Plot, sector: Sector, i: I18n): string {
  if (sector === "crop") return `${i.t("found.fertility")}: ${i.pct(p.fertilityBp)}`;
  if (sector === "livestock") return `${i.t("found.pasture")}: ${i.pct(p.pastureBp)}`;
  if (sector === "mining") return p.deposit ? `${i.t(`deposit.${p.deposit.kind}`)} · ${i.pct(p.deposit.richnessBp)}` : i.t("found.noDeposit");
  return "—";
}

function PlotCard({ p, sector, selected, onClick }: { p: Plot; sector: Sector; selected: boolean; onClick: () => void }) {
  const i = useT();
  const cat = useCat();
  return (
    <Card onClick={onClick} selected={selected} tight>
      <div className="col tight">
        <div className="row between"><b>{p.gx + 1}·{p.gz + 1}</b><span className="num">{i.money(p.price)}</span></div>
        <span className="small muted2">{p.sizeHa} ha · {efficiency(p, sector, i)}</span>
        <span className="small muted">{i.t("found.distCenter")}: {p.distanceToCenterKm} km</span>
        {p.nearestSupply[0] ? <span className="small muted">{i.t("found.nearSupply")}: {cat.product(p.nearestSupply[0].productId)} · {cat.city(p.nearestSupply[0].cityId)} {p.nearestSupply[0].km} km</span> : null}
        {p.nearestBuyers[0] ? <span className="small muted">{i.t("found.nearBuyers")}: {cat.product(p.nearestBuyers[0].productId)} · {cat.city(p.nearestBuyers[0].cityId)} {p.nearestBuyers[0].km} km</span> : null}
        {p.eligible ? <Badge tone="good">✓ {i.t("found.eligible")}</Badge> : <Badge tone="bad">✕ {p.reasons.map((r) => i.t(`found.reason.${r}`)).join(", ")}</Badge>}
      </div>
    </Card>
  );
}

function PlotDetail({ p, sector }: { p: Plot; sector: Sector }) {
  const i = useT();
  const cat = useCat();
  return (
    <Card><div className="col tight">
      <div className="row between"><h3>{cat.city(p.cityId)} {p.gx + 1}·{p.gz + 1}</h3><b className="num">{i.money(p.price)}</b></div>
      <KV k={i.t("found.size")} v={`${p.sizeHa} ha`} />
      <KV k={i.t("found.efficiency")} v={efficiency(p, sector, i)} />
      <KV k={i.t("found.distCenter")} v={`${p.distanceToCenterKm} km`} />
      {p.nearestSupply.length ? <KV k={i.t("found.nearSupply")} v={p.nearestSupply.map((s) => `${cat.product(s.productId)}: ${cat.city(s.cityId)} ${s.km} km`).join(" · ")} /> : null}
      {p.nearestBuyers.length ? <KV k={i.t("found.nearBuyers")} v={p.nearestBuyers.map((s) => `${cat.product(s.productId)}: ${cat.city(s.cityId)} ${s.km} km`).join(" · ")} /> : null}
      {p.eligible ? <Badge tone="good">✓ {i.t("found.eligible")}</Badge> : <Notice tone="warn">{p.reasons.map((r) => i.t(`found.reason.${r}`)).join(" · ")}</Notice>}
    </div></Card>
  );
}
