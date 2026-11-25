"use client";
import { useState } from "react";
import type { HoldingDto, PlotDto } from "@capitalforge/shared";
import { api } from "@/lib/api";
import { useAction } from "@/lib/action";
import { useApp } from "@/lib/app";
import { useCat } from "@/lib/catalog";
import { useData } from "@/lib/data";
import { useT } from "@/lib/i18n";
import { Badge, Button, Card, Countdown, EmptyState, KV, Notice, SkeletonList, TimeProgress } from "@/ui";
import { FacilityDetail } from "../facilities/FacilityDetail";
import { usePlay } from "./context";

export function SelectionPanel({ onClose, hideTitle }: { onClose: () => void; hideTitle?: boolean }) {
  const { selection, map, company, open } = usePlay();
  const { t } = useT();
  const cat = useCat();
  if (!selection) return null;
  const back = <Button variant="ghost" size="sm" onClick={onClose}>← {t("common.back")}</Button>;
  if (selection.type === "plot") {
    const p = map.data?.plots.find((x) => x.id === selection.plotId);
    return <div className="col">{hideTitle ? null : back}{p ? <PlotInfo plot={p} onDone={onClose} /> : <SkeletonList n={2} />}</div>;
  }
  if (selection.type === "facility") {
    const f = company.data?.facilities.find((x) => x.id === selection.facilityId);
    const p = map.data?.plots.find((x) => x.id === selection.plotId);
    if (f) return <div className="col">{hideTitle ? null : back}<FacilityDetail f={f} /></div>;
    if (p?.building) {
      return (
        <div className="col">{hideTitle ? null : back}
          <h3>{cat.building(p.building.type)}</h3>
          <KV k={t("play.owner")} v={p.owner ? <>{p.owner.companyName} {p.owner.isSystem ? <Badge tone="system">{t("common.system")}</Badge> : null}</> : "—"} />
          <KV k={t("common.level")} v={p.building.level} />
          <KV k={t("common.status")} v={t(`facility.status.${p.building.status}`)} />
          {p.building.activeUntil ? <KV k={t("facility.remaining")} v={<Countdown until={p.building.activeUntil} />} /> : null}
          <Notice tone="steel">{t("play.notYours")}</Notice>
        </div>
      );
    }
    return <div className="col">{back}<SkeletonList n={2} /></div>;
  }
  if (selection.type === "vehicle") {
    const v = map.data?.vehicles.find((x) => x.id === selection.vehicleId);
    if (!v) return <div className="col">{back}<EmptyState title={t("play.gone")} /></div>;
    const sh = v.shipment;
    return (
      <div className="col">{hideTitle ? null : back}
        <h3>{cat.vehicle(v.modelId)}</h3>
        <KV k={t("play.owner")} v={v.ownerName} />
        {sh ? (
          <>
            <KV k={t("logistics.route")} v={`${cat.city(sh.originCityId)} → ${cat.city(sh.destCityId)}`} />
            <KV k={t("logistics.eta")} v={<Countdown until={sh.arrivesAt} doneText={t("logistics.arrived")} />} />
            <TimeProgress from={sh.departedAt} to={sh.arrivesAt} steel />
            <KV k={t("logistics.cargo")} v={sh.cargo ? sh.cargo.map((c) => `${cat.product(c.productId)} ${t("common.quality")}${c.quality}${c.qtyKg} kg`).join(", ") : `${sh.totalKg} kg`} />
          </>
        ) : <KV k={t("logistics.location")} v={cat.city(v.cityId)} />}
        {v.isMine ? <Button onClick={() => open("logistics")}>{t("play.openLogistics")}</Button> : null}
      </div>
    );
  }
  return <div className="col">{back}<h3>{cat.city(selection.cityId)}</h3></div>;
}

function PlotInfo({ plot, onDone }: { plot: PlotDto; onDone: () => void }) {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const { me } = useApp();
  const { run, busy } = useAction();
  const inv = useData<HoldingDto[]>(!plot.owner ? "/inventory" : null, undefined, ["inventory"]);
  const [choice, setChoice] = useState<string | null>(null);
  const c = me?.company;
  const title = <h3>{cat.city(plot.cityId)} {plot.gx + 1}·{plot.gz + 1}</h3>;
  const facts = (
    <>
      <KV k={t("found.size")} v={`${plot.sizeHa} ha`} />
      <KV k={t("found.fertility")} v={i.pct(plot.fertilityBp)} />
      <KV k={t("found.pasture")} v={i.pct(plot.pastureBp)} />
      {plot.deposit ? <KV k={t("found.deposit")} v={`${t(`deposit.${plot.deposit.kind}`)} · ${i.pct(plot.deposit.richnessBp)}`} /> : null}
      <KV k={t("found.distCenter")} v={`${plot.distanceToCenterKm} km`} />
    </>
  );
  if (plot.owner) {
    return <div className="col">{title}<KV k={t("play.owner")} v={plot.owner.companyName} />{facts}<Notice tone="steel">{t("play.plotTaken")}</Notice></div>;
  }
  if (!c) return null;
  const steelHere = (inv.data ?? []).filter((h) => h.productId === "steel" && h.cityId === plot.cityId).reduce((a, h) => a + h.availableKg, 0);
  const levelOk = c.level >= plot.minLevel;
  const cashOk = BigInt(c.cash) >= BigInt(plot.price);
  const options = cat.world.buildingTypes.map((b) => {
    const reasons: string[] = [];
    if (b.requiresDeposit && !plot.deposit) reasons.push(t("found.reason.DEPOSIT_REQUIRED"));
    if (!levelOk) reasons.push(t("errors.LEVEL_TOO_LOW"));
    if (!cashOk) reasons.push(t("errors.INSUFFICIENT_FUNDS"));
    if (inv.data && steelHere < b.buildSteelKg) reasons.push(t("errors.INSUFFICIENT_STEEL"));
    return { b, reasons };
  });
  const sel = options.find((o) => o.b.id === choice);
  return (
    <div className="col">
      {title}
      <div className="row between"><span className="muted2">{t("play.price")}</span><b className="num" style={{ fontSize: "var(--fs-lg)" }}>{i.money(plot.price)}</b></div>
      <KV k={t("play.minLevel")} v={<span className={levelOk ? "good" : "bad"}>{levelOk ? "✓" : "✕"} {t("common.level")} {plot.minLevel} ({t("play.yours", { n: c.level })})</span>} />
      <KV k={t("found.cash")} v={<span className={cashOk ? "good" : "bad"}>{cashOk ? "✓" : "✕"} {i.money(c.cash)}</span>} />
      {facts}
      <h4>{t("play.buildWhat")}</h4>
      {inv.loading ? <SkeletonList n={2} h={56} /> : null}
      <div className="col tight">
        {options.map(({ b, reasons }) => (
          <Card key={b.id} tight onClick={() => setChoice(b.id)} selected={choice === b.id}>
            <div className="col tight">
              <div className="row between"><b>{i.name(b.name)}</b><span className="num small">{i.money(b.buildCost)}</span></div>
              <span className="small muted2">{cat.product("steel")}: {i.qty(b.buildSteelKg)} · {t("common.minutes", { n: b.buildMinutes })}</span>
              {reasons.length ? <span className="small warn">⚠ {reasons.join(" · ")}</span> : <span className="small good">✓ {t("play.canBuild")}</span>}
            </div>
          </Card>
        ))}
      </div>
      <div className="sticky-cta">
        <Button variant="primary" size="lg" loading={busy} disabled={!sel} onClick={() => void run(() => api.post(`/plots/${plot.id}/buy`, { buildingType: sel!.b.id }), { ok: "play.bought" }).then((r) => { if (r) onDone(); })}>{t("play.buy")}</Button>
      </div>
    </div>
  );
}
