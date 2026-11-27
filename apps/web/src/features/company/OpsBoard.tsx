"use client";
import type { FacilityDto, FreightJobDto, HoldingDto, ShipmentDto } from "@capitalforge/shared";
import { useCat } from "@/lib/catalog";
import { useData, useList } from "@/lib/data";
import { sellParams, setMarketIntent } from "@/lib/intent";
import { useT } from "@/lib/i18n";
import { Button, Countdown, Icon, SkeletonList, Status, type StatusKind } from "@/ui";
import { usePlay } from "../play/context";
import "./ops-board.css";

type Item = { key: string; kind: StatusKind; title: string; text?: string; go: string; run: () => void };

function facilityState(f: FacilityDto): { kind: StatusKind; key: string; running: number; free: number } {
  const running = f.jobs.filter((j) => j.status === "running").length;
  if (f.status === "constructing") return { kind: "build", key: "building", running, free: 0 };
  if (f.upgrade) return { kind: "build", key: "upgrading", running, free: Math.max(0, f.lines - running) };
  if (f.status === "stalled") return { kind: "stop", key: "stalledShort", running, free: Math.max(0, f.lines - running) };
  if (running > 0) return { kind: "run", key: "working", running, free: Math.max(0, f.lines - running) };
  return { kind: "idle", key: "idleShort", running, free: f.lines };
}

/** Şirket ana ekranı: "Şimdi ne yapmalı?" Dikkat isteyen işler, tesisler, yoldaki mal, satılabilir stok; her satır doğrudan ilgili işleme götürür. */
export function OpsBoard() {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const { company, open } = usePlay();
  const inv = useData<HoldingDto[]>("/inventory", undefined, ["inventory"]);
  const ships = useList<ShipmentDto>("/shipments", { scope: "mine" }, ["shipments"]);
  const jobs = useList<FreightJobDto>("/freight-jobs", { scope: "mine" }, ["freight", "shipments"]);
  const c = company.data;
  if (!c) return <SkeletonList n={4} />;

  const openFacility = (f: FacilityDto) => open("facilities", { params: { facility: f.id } });
  const sell = (h: HoldingDto) => { setMarketIntent({ productId: h.productId, cityId: h.cityId, side: "sell", quality: h.quality, qtyKg: h.availableKg }); open("market", { params: sellParams(h) }); };

  // Tesislerimin ürettiği ürünler satılabilir stoktur; girdiler (ör. tohum) değildir.
  const myRecipes = new Set(c.facilities.flatMap((f) => f.recipes));
  const outputs = new Set(cat.world.recipes.filter((r) => myRecipes.has(r.id)).map((r) => r.output.productId));
  const inputs = new Set(cat.world.recipes.filter((r) => myRecipes.has(r.id)).flatMap((r) => r.inputs.map((x) => x.productId)));
  const sellable = (inv.data ?? []).filter((h) => h.availableKg > 0 && (outputs.has(h.productId) || !inputs.has(h.productId))).sort((a, b) => b.availableKg * Number(b.avgCostPerKg) - a.availableKg * Number(a.avgCostPerKg));

  const items: Item[] = [];
  if (c.arrears !== "0") items.push({ key: "arrears", kind: "stop", title: t("decide.ops.arrears", { a: i.money(c.arrears) }), go: t("decide.ops.arrearsGo"), run: () => open("finance") });
  for (const f of c.facilities) {
    const s = facilityState(f);
    const name = cat.building(f.type);
    if (s.kind === "stop") items.push({ key: `st-${f.id}`, kind: "stop", title: t("decide.ops.stalled", { name }), text: f.stalledReason ? t(`facility.stalled.${f.stalledReason.code}`) + (f.stalledReason.productId ? `: ${cat.product(f.stalledReason.productId)}` : "") : undefined, go: t("decide.ops.stalledGo"), run: () => openFacility(f) });
    else if (s.free > 0 && f.lines > 0 && s.kind !== "build") items.push({ key: `idle-${f.id}`, kind: "idle", title: t("decide.ops.idle", { name }), text: t("decide.ops.idleText", { n: s.free, city: cat.city(f.cityId) }), go: t("decide.ops.idleGo"), run: () => openFacility(f) });
  }
  for (const h of sellable.slice(0, 3)) items.push({ key: `sell-${h.cityId}-${h.productId}-${h.quality}`, kind: "attn", title: t("decide.ops.sell", { product: cat.product(h.productId) }), text: t("decide.ops.sellText", { q: i.qty(h.availableKg), city: cat.city(h.cityId), c: i.price(h.avgCostPerKg) }), go: t("decide.ops.sellGo"), run: () => sell(h) });

  const moving = (ships.data ?? []).filter((s) => s.status === "in_transit").sort((a, b) => a.arrivesAt.localeCompare(b.arrivesAt));
  const waiting = (jobs.data ?? []).filter((j) => j.mine === "shipper" && (j.status === "open" || j.status === "assigned"));

  return (
    <div className="ob">
      <section className="ob-sec" aria-labelledby="ob-attn">
        <h2 id="ob-attn">{t("decide.ops.attention")}</h2>
        {items.length ? <ul className="ob-list">{items.map((it) => (
          <li key={it.key}>
            <button type="button" className="ob-row" onClick={it.run}>
              <Status kind={it.kind}>{null}</Status>
              <span className="ob-main"><b>{it.title}</b>{it.text ? <small>{it.text}</small> : null}</span>
              <span className="ob-go">{it.go}<Icon name="back" size={14} /></span>
            </button>
          </li>
        ))}</ul> : <p className="ob-calm">{t("decide.ops.calm")}</p>}
      </section>

      <section className="ob-sec" aria-labelledby="ob-fac">
        <h2 id="ob-fac">{t("decide.ops.facilities")}</h2>
        <ul className="ob-list">{c.facilities.map((f) => {
          const s = facilityState(f);
          const job = f.jobs.filter((j) => j.status === "running").sort((a, b) => a.endsAt.localeCompare(b.endsAt))[0];
          return (
            <li key={f.id}>
              <button type="button" className="ob-row" onClick={() => openFacility(f)} aria-label={`${cat.building(f.type)} · ${cat.city(f.cityId)} · ${t(`decide.ops.${s.key}`)}`}>
                <span className="ob-ico" aria-hidden="true"><Icon name={f.type === "garage" ? "truck" : f.lines ? "factory" : "building"} size={18} /></span>
                <span className="ob-main"><b>{cat.building(f.type)} <span className="muted2">· {cat.city(f.cityId)}</span></b>
                  <small>{job ? <>{cat.product(job.output.productId)} {i.qty(job.output.qtyKg)} · <Countdown until={job.endsAt} /></> : f.status === "constructing" && f.constructionEndsAt ? <Countdown until={f.constructionEndsAt} /> : f.lines ? t("decide.ops.lines", { a: s.running, b: f.lines }) : null}</small>
                </span>
                <Status kind={s.kind}>{t(`decide.ops.${s.key}`)}</Status>
              </button>
            </li>
          );
        })}</ul>
      </section>

      <section className="ob-sec" aria-labelledby="ob-ship">
        <h2 id="ob-ship">{t("decide.ops.shipments")}</h2>
        {moving.length || waiting.length ? <ul className="ob-list">
          {moving.map((s) => (
            <li key={s.id}>
              <button type="button" className="ob-row" onClick={() => open("logistics", { params: { view: "ships" } })}>
                <Status kind="road">{null}</Status>
                <span className="ob-main"><b>{cat.city(s.originCityId)} → {cat.city(s.destCityId)}</b><small>{s.cargo.length ? s.cargo.map((x) => `${cat.product(x.productId)} ${i.qty(x.qtyKg)}`).join(", ") : t("logistics.emptyLoad")}</small></span>
                <span className="ob-eta"><small>{t("decide.ops.arrives")}</small><b className="num"><Countdown until={s.arrivesAt} doneText={t("logistics.arrived")} /></b></span>
              </button>
            </li>
          ))}
          {waiting.map((j) => (
            <li key={j.id}>
              <button type="button" className="ob-row" onClick={() => open("logistics", { params: { view: "board", scope: "mine" } })}>
                <Status kind="idle">{null}</Status>
                <span className="ob-main"><b>{cat.city(j.originCityId)} → {cat.city(j.destCityId)}</b><small>{j.cargo.map((x) => `${cat.product(x.productId)} ${i.qty(x.qtyKg)}`).join(", ")}</small></span>
                <span className="ob-eta"><small>{j.status === "open" ? t("decide.ops.waitCarrier") : t(`logistics.jobStatus.${j.status}`)}</small></span>
              </button>
            </li>
          ))}
        </ul> : <p className="ob-calm">{t("decide.ops.noShipments")}</p>}
      </section>
    </div>
  );
}
