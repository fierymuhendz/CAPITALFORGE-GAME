"use client";
import { useEffect, useMemo, useState } from "react";
import { peekShipIntent, takeShipIntent, type ShipIntent } from "@/lib/intent";
import { BuyVehicleReq, FreightJobReq, ShipmentReq, type FreightJobDto, type FreightQuoteDto, type PublicCompanyDto, type ShipmentDto, type VehicleDto } from "@capitalforge/shared";
import { api } from "@/lib/api";
import { useAction } from "@/lib/action";
import { useApp } from "@/lib/app";
import { useCat } from "@/lib/catalog";
import { useData, useList } from "@/lib/data";
import { useT } from "@/lib/i18n";
import { ActionBar, Async, Badge, Button, Card, Countdown, Disclosure, EmptyState, Icon, IntInput, KV, MoneyInput, Notice, SelectField, Stat, SystemBadge, TextField, TimeProgress, Table, Tabs, Tag, Trend, type Col } from "@/ui";
import { usePlay } from "../play/context";
import "../facilities/operations.css";
import { CargoPicker, cargoBody, cargoTotal, type CargoLine } from "./CargoPicker";

export function LogisticsPanel() {
  const { t } = useT();
  const [intent, setIntent] = useState<ShipIntent | null>(() => peekShipIntent());
  useEffect(() => { takeShipIntent(); }, []);
  const [vehicleId, setVehicleId] = useState("");
  const [tab, setTab] = useState(intent ? "send" : "fleet");
  return (
    <div className="col ops-panel">
      <Tabs label={t("panels.logistics")} value={tab} onChange={setTab} items={[{ id: "fleet", label: t("logistics.fleet") }, { id: "send", label: t("logistics.send") }, { id: "board", label: t("logistics.board") }, { id: "post", label: t("logistics.postJob") }, { id: "ships", label: t("logistics.shipments") }]} />
      {tab === "fleet" ? <Fleet onSend={(id) => { setIntent(null); setVehicleId(id); setTab("send"); }} /> : tab === "send" ? <Send intent={intent} initialVehicleId={vehicleId} onDepart={() => { setIntent(null); setVehicleId(""); setTab("ships"); }} /> : tab === "board" ? <Board /> : tab === "post" ? <PostJob /> : <Shipments />}
    </div>
  );
}

const useFleet = () => useList<VehicleDto>("/fleet", undefined, ["shipments", "company"]);

function Fleet({ onSend }: { onSend: (id: string) => void }) {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const { me } = useApp();
  const { company } = usePlay();
  const { run, busy } = useAction();
  const res = useFleet();
  const garageCities = [...new Set((company.data?.facilities ?? []).filter((f) => f.type === "garage" && f.status !== "constructing").map((f) => f.cityId))];
  const [model, setModel] = useState(cat.world.vehicleModels[0]!.id);
  const [city, setCity] = useState("");
  const cityId = city || garageCities[0] || "";
  const m = cat.world.vehicleModels.find((x) => x.id === model)!;
  const valid = BuyVehicleReq.omit({ idempotencyKey: true }).safeParse({ modelId: model, cityId }).success;
  const lvlOk = (me?.company?.level ?? 1) >= m.minCompanyLevel;
  return (
    <div className="col">
      <Async res={res}>
        {(vs) => vs.length ? <div className="col">
          <div className="ops-metrics ops-pair">
            <Stat label={t("logistics.idle")} value={i.num(vs.filter((x) => x.status === "idle").length)} />
            <Stat label={t("logistics.shipStatus.in_transit")} value={i.num(vs.filter((x) => x.status === "in_transit").length)} />
          </div>
          {vs.map((v) => {
            const model = cat.world.vehicleModels.find((m) => m.id === v.modelId);
            const inTransit = v.status === "in_transit";
            return <Card key={v.id} className="ops-site">
              <div className="ops-identity"><span className="ops-symbol"><Icon name="truck" /></span>
                <div><h3>{cat.vehicle(v.modelId)}</h3><span className="small muted2">{t(inTransit ? "logistics.destination" : "logistics.location")} · {cat.city(inTransit ? v.destCityId : v.cityId)}</span></div>
                <Badge tone={inTransit ? "forge" : "good"}>{t(inTransit ? "logistics.shipStatus.in_transit" : "logistics.idle")}</Badge>
              </div>
              <div className="ops-fleet-facts">{model ? <span><Icon name="box" size={15} />{t("logistics.capacity")} · {i.qty(model.capacityKg)}</span> : null}
                {inTransit && v.arrivesAt ? <span><Icon name="clock" size={15} />{t("logistics.eta")} · <Countdown until={v.arrivesAt} doneText={t("logistics.arrived")} /></span> : null}
              </div>
              {!inTransit ? <Button size="sm" className="ops-site-action" onClick={() => onSend(v.id)}>{t("logistics.sendNow")} <span aria-hidden="true">→</span></Button> : null}
            </Card>;
          })}</div> : <EmptyState icon="truck" title={t("logistics.noFleet")} text={t("logistics.noFleetText")} />}
      </Async>
      <Card><div className="col">
        <h4>{t("logistics.buyVehicle")}</h4>
        <SelectField label={t("logistics.model")} value={model} onChange={setModel} options={cat.world.vehicleModels.map((v) => ({ id: v.id, label: `${i.name(v.name)} — ${i.money(v.price)}` }))} />
        <KV k={t("logistics.capacity")} v={i.qty(m.capacityKg)} />
        <KV k={t("logistics.speed")} v={`${m.speedKmh} km/h`} />
        <KV k={t("logistics.fuel")} v={`${i.money(m.fuelPerKm)}/km`} />
        <KV k={t("facility.upkeep")} v={`${i.money(m.upkeepPerDay)}/${t("common.day")}`} />
        {!lvlOk ? <span className="small warn">⚠ {t("research.needLevel", { n: m.minCompanyLevel })}</span> : null}
        {garageCities.length ? <SelectField label={t("logistics.garageCity")} value={cityId} onChange={setCity} options={garageCities.map((c) => ({ id: c, label: cat.city(c) }))} hint={t("logistics.garageHint")} />
          : <Notice tone="warn">{t("logistics.needGarage")}</Notice>}
        <Button variant="primary" loading={busy} disabled={!valid || !lvlOk} onClick={() => void run(() => api.post("/fleet/buy", { modelId: model, cityId }), { ok: "logistics.bought" })}>{t("logistics.buy")}</Button>
      </div></Card>
    </div>
  );
}

function RouteLine({ origin, destination }: { origin: string; destination: string }) {
  const { t } = useT();
  const cat = useCat();
  return <div className="ops-route">
    <div><span>{t("logistics.origin")}</span><b>{cat.city(origin)}</b></div>
    <span className="ops-route-link" aria-hidden="true"><Icon name="truck" size={19} /></span>
    <div><span>{t("logistics.destination")}</span><b>{cat.city(destination)}</b></div>
  </div>;
}

function Send({ intent, initialVehicleId, onDepart }: { intent: ShipIntent | null; initialVehicleId: string; onDepart: () => void }) {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const { run, busy } = useAction();
  const fleet = useFleet();
  const idle = (fleet.data ?? []).filter((v) => v.status === "idle" && v.cityId);
  const [vid, setVid] = useState(initialVehicleId);
  const [dest, setDest] = useState(intent?.destCityId ?? "");
  const [cargo, setCargo] = useState<{ origin: string | null; lines: CargoLine[] }>({
    origin: intent?.fromCityId ?? null,
    lines: intent ? [{ productId: intent.productId, quality: intent.quality, qtyKg: intent.qtyKg }] : [],
  });
  const intentVeh = intent ? idle.find((x) => x.cityId === intent.fromCityId) : undefined;
  const v = idle.find((x) => x.id === vid) ?? intentVeh ?? idle[0];
  const lines = v?.cityId === cargo.origin ? cargo.lines : [];
  const setLines = (lines: CargoLine[]) => setCargo({ origin: v?.cityId ?? null, lines });
  const dst = dest && dest !== v?.cityId ? dest : cat.world.cities.find((c) => c.id !== v?.cityId)?.id ?? "";
  const kg = cargoTotal(lines);
  const model = cat.world.vehicleModels.find((m) => m.id === v?.modelId);
  const quote = useData<FreightQuoteDto>(v?.cityId && dst && kg > 0 ? "/freight/quote" : null, { originCityId: v?.cityId ?? "", destCityId: dst, kg, modelId: v?.modelId }, []);
  const rate = quote.data?.originCityId === v?.cityId && quote.data?.destCityId === dst && quote.data?.kg === kg ? quote.data : null;
  const mine = rate?.own.find((o) => o.modelId === v?.modelId);
  const body = { vehicleId: v?.id, destCityId: dst, cargo: cargoBody(lines) };
  const ok = !!v && lines.every((l) => l.qtyKg !== null && l.qtyKg > 0) && ShipmentReq.omit({ idempotencyKey: true }).safeParse(body).success && (!model || kg <= model.capacityKg);
  if (fleet.data && !idle.length) return <EmptyState icon="truck" title={t("logistics.noIdle")} text={t("logistics.noIdleText")} />;
  return (
    <Async res={fleet}>
      {() => (
        <div className="col">
          {intent && !intentVeh ? <Notice tone="warn">{t("operations.unavailableOrigin", { city: cat.city(intent.fromCityId) })}</Notice> : null}
          <div className="ops-fields">
            <SelectField label={t("logistics.vehicle")} value={v?.id ?? ""} onChange={setVid} options={idle.map((x) => ({ id: x.id, label: `${cat.vehicle(x.modelId)} — ${cat.city(x.cityId)}` }))} />
            <SelectField label={t("logistics.destination")} value={dst} onChange={setDest} options={cat.world.cities.filter((c) => c.id !== v?.cityId).map((c) => ({ id: c.id, label: i.name(c.name) }))} />
          </div>
          {v?.cityId && dst ? <RouteLine origin={v.cityId} destination={dst} /> : null}
          <Card className="ops-site">
            <h4 className="ops-section-title"><Icon name="box" size={18} />{t("logistics.cargo")}</h4>
            {v?.cityId ? <CargoPicker cityId={v.cityId} lines={lines} onChange={setLines} allowEmpty /> : null}
            {model ? <div className="ops-load"><span>{t("operations.cargoLoad")}</span><b>{i.qty(kg)} / {i.qty(model.capacityKg)}</b><progress value={Math.min(kg, model.capacityKg)} max={model.capacityKg} aria-label={t("operations.cargoLoad")} /></div> : null}
          </Card>
          {model && kg > model.capacityKg ? <Notice tone="bad">{t("errors.VEHICLE_CAPACITY")} ({i.qty(model.capacityKg)})</Notice> : null}
          {kg > 0 && quote.error ? <Notice tone="warn">{i.err(quote.error)}</Notice> : null}
          {kg > 0 && quote.loading && !mine ? <div className="ops-info" role="status"><span className="spin" />{t("operations.routeEstimate")}</div> : null}
          {mine && rate ? <div className="col" aria-live="polite">
            <div className="ops-metrics"><Stat label={t("operations.distance")} value={`${i.num(rate.distanceKm)} km`} /><Stat label={t("logistics.truckTime")} value={i.dur(mine.minutes)} /><Stat label={t("logistics.estCost")} value={i.money(mine.total)} /></div>
            <Disclosure summary={t("facility.breakdown")}>
              <KV k={t("logistics.fuelCost")} v={i.money(mine.fuel)} /><KV k={t("logistics.driverCost")} v={i.money(mine.driver)} />
              <KV k={t("logistics.eta")} v={i.date(mine.arrivesAt)} /><KV k={t("logistics.systemQuote")} v={i.money(rate.systemQuote)} />
            </Disclosure>
          </div> : null}
          <ActionBar><Button variant="primary" loading={busy} disabled={!ok} onClick={() => void run(() => api.post("/shipments", body), { ok: "logistics.shipped" }).then((r) => { if (r) onDepart(); })}>{lines.length ? t("logistics.shipBtn") : t("logistics.moveEmpty")}</Button></ActionBar>
        </div>
      )}
    </Async>
  );
}

function Board() {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const [scope, setScope] = useState<"board" | "mine">("board");
  const res = useList<FreightJobDto>("/freight-jobs", { scope }, ["freight", "shipments"]);
  const { run, busy } = useAction();
  const bestId = useMemo(() => {
    let best: FreightJobDto | null = null;
    for (const j of res.data ?? []) if (j.status === "open" && j.netPerHourForMe !== null && (!best || BigInt(j.netPerHourForMe) > BigInt(best.netPerHourForMe!))) best = j;
    return best && BigInt(best.netPerHourForMe!) > 0n ? best.id : null;
  }, [res.data]);
  const accept = (j: FreightJobDto) => void run(() => api.post(`/freight-jobs/${j.id}/accept`, { vehicleId: j.bestVehicleIdForMe }), { ok: "logistics.accepted" });
  const cols: Col<FreightJobDto>[] = [
    { key: "r", head: t("logistics.route"), lead: true, cell: (j) => <span className="col tight" style={{ gap: 0, minWidth: 0 }}><b className="nm">{cat.city(j.originCityId)} → {cat.city(j.destCityId)} · {j.distanceKm} km</b><span className="muted xs nm">{j.cargo.length ? j.cargo.map((c) => `${cat.product(c.productId)} ${i.qty(c.qtyKg)}`).join(", ") : i.qty(j.totalKg)} · {j.shipperName}</span></span> },
    { key: "p", head: t("logistics.pay"), right: true, nowrap: true, cell: (j) => <b className="num">{i.money(j.payAmount)}</b> },
    { key: "m", head: t("logistics.truckTime"), right: true, nowrap: true, cell: (j) => j.estMinutesForMe !== null ? <span className="num">{i.dur(j.estMinutesForMe)}</span> : <span className="muted">—</span> },
    { key: "c", head: t("logistics.estCost"), right: true, nowrap: true, cell: (j) => j.estCostForMe ? <span className="num">{i.money(j.estCostForMe)}</span> : <span className="muted">—</span> },
    { key: "n", head: t("logistics.net"), right: true, nowrap: true, cell: (j) => j.estCostForMe ? <Trend value={(BigInt(j.payAmount) - BigInt(j.estCostForMe)).toString()} text={i.signed((BigInt(j.payAmount) - BigInt(j.estCostForMe)).toString())} /> : <span className="muted">—</span> },
    { key: "h", head: t("logistics.netPerHour"), right: true, nowrap: true, cell: (j) => j.netPerHourForMe !== null ? <Trend value={j.netPerHourForMe} text={`${i.signed(j.netPerHourForMe)}/${t("common.hourShort")}`} /> : <span className="muted">—</span> },
    { key: "d", head: t("logistics.deadline"), nowrap: true, cell: (j) => <Countdown until={j.deadlineAt} doneText={t("logistics.expired")} /> },
    { key: "t", head: "", bare: true, wide: true, cell: (j) => <span className="tags">{j.id === bestId ? <Tag tone="forge" icon="star">{t("logistics.bestNet")}</Tag> : null}{j.status !== "open" ? <Badge>{t(`logistics.jobStatus.${j.status}`)}</Badge> : null}{j.isSystem ? <SystemBadge /> : null}</span> },
    { key: "a", head: "", bare: true, act: true, cell: (j) => j.status === "open" && j.mine === "shipper" ? <Button size="sm" variant="danger" loading={busy} onClick={() => void run(() => api.post(`/freight-jobs/${j.id}/cancel`), { ok: "logistics.jobCancelled" })}>{t("common.cancel")}</Button>
      : j.status === "open" ? (j.bestVehicleIdForMe ? <Button size="sm" variant="primary" loading={busy} onClick={() => accept(j)}>{t("logistics.accept")}</Button> : <span className="warn xs">⚠ {t("logistics.noFitVehicle", { city: cat.city(j.originCityId) })}</span>) : null },
  ];
  return (
    <div className="col">
      <div className="pill-scroll"><button type="button" className="chip" aria-pressed={scope === "board"} onClick={() => setScope("board")}>{t("logistics.openJobs")}</button><button type="button" className="chip" aria-pressed={scope === "mine"} onClick={() => setScope("mine")}>{t("logistics.myJobs")}</button></div>
      <Async res={res}>
        {(jobs) => !jobs.length ? <EmptyState icon="truck" title={t("logistics.noJobs")} text={t(scope === "board" ? "logistics.noJobsText" : "logistics.noMyJobsText")} /> : (
          <Table cols={cols} rows={jobs} rowKey={(j) => j.id} rowClass={(j) => (j.id === bestId ? "best" : "")} />
        )}
      </Async>
    </div>
  );
}

function PostJob() {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const { run, busy } = useAction();
  const [origin, setOrigin] = useState(cat.world.cities[0]!.id);
  const [dest, setDest] = useState(cat.world.cities[1]!.id);
  const [lines, setLines] = useState<CargoLine[]>([]);
  const [pay, setPay] = useState<number | null>(null);
  const [hours, setHours] = useState(24);
  const [allowSys, setAllowSys] = useState(true);
  const [q, setQ] = useState("");
  const [consignee, setConsignee] = useState<PublicCompanyDto | null>(null);
  const kg = cargoTotal(lines);
  const quote = useData<FreightQuoteDto>(kg > 0 && origin !== dest ? "/freight/quote" : null, { originCityId: origin, destCityId: dest, kg }, []);
  const found = useList<PublicCompanyDto>(q.trim().length >= 2 ? "/companies/search" : null, { q: q.trim() }, []);
  const body = { originCityId: origin, destCityId: dest, cargo: cargoBody(lines), consigneeCompanyId: consignee?.id, payAmount: pay, deadlineHours: hours, allowSystemCarrier: allowSys };
  const ok = FreightJobReq.omit({ idempotencyKey: true }).safeParse(body).success;
  return (
    <div className="col">
      <div className="grid2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
        <SelectField label={t("logistics.origin")} value={origin} onChange={(v) => { setOrigin(v); setLines([]); }} options={cat.world.cities.map((c) => ({ id: c.id, label: i.name(c.name) }))} />
        <SelectField label={t("logistics.destination")} value={dest} onChange={setDest} options={cat.world.cities.map((c) => ({ id: c.id, label: i.name(c.name) }))} />
      </div>
      {origin === dest ? <Notice tone="warn">{t("errors.SAME_CITY")}</Notice> : null}
      <CargoPicker cityId={origin} lines={lines} onChange={setLines} />
      <TextField label={t("logistics.consignee")} value={consignee ? consignee.name : q} onChange={(e) => { setConsignee(null); setQ(e.target.value); }} hint={t("logistics.consigneeHint")} />
      {!consignee && found.data?.length ? <div className="col tight">{found.data.map((c) => <Button key={c.id} size="sm" onClick={() => setConsignee(c)}>{c.name} · {t("common.level")} {c.level}</Button>)}</div> : null}
      <MoneyInput label={t("logistics.pay")} value={pay} onChange={setPay} hint={quote.data ? `${t("logistics.systemQuote")}: ${i.money(quote.data.systemQuote)} (${quote.data.distanceKm} km)` : t("logistics.payHint")} />
      <IntInput label={t("logistics.deadlineHours")} value={hours} onChange={setHours} min={1} max={168} suffix={t("common.hourShort")} />
      <label className="row" style={{ minHeight: 44 }}><input type="checkbox" checked={allowSys} onChange={(e) => setAllowSys(e.target.checked)} style={{ width: 20, height: 20 }} /> {t("logistics.allowSystem")}</label>
      <ActionBar><Button variant="primary" loading={busy} disabled={!ok} onClick={() => void run(() => api.post("/freight-jobs", body), { ok: "logistics.jobPosted" }).then((r) => { if (r) { setLines([]); setPay(null); } })}>{t("logistics.postBtn")}</Button></ActionBar>
    </div>
  );
}

function Shipments() {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const res = useList<ShipmentDto>("/shipments", { scope: "mine" }, ["shipments"]);
  const sorted = useMemo(() => [...(res.data ?? [])].sort((a, b) => b.departedAt.localeCompare(a.departedAt)), [res.data]);
  return (
    <Async res={res}>
      {() => !sorted.length ? <EmptyState icon="truck" title={t("logistics.noShipments")} text={t("logistics.noShipmentsText")} /> : (
        <div className="col">{sorted.map((s) => (
          <Card key={s.id} className="ops-shipment"><div className="col">
            <div className="row between wrap"><span className="ops-info"><Icon name="truck" size={17} />{t(`logistics.purpose.${s.purpose}`)} · {i.num(s.distanceKm)} km</span><Badge tone={s.status === "delivered" ? "good" : "forge"}>{t(`logistics.shipStatus.${s.status}`)}</Badge></div>
            <RouteLine origin={s.originCityId} destination={s.destCityId} />
            <span className="small muted2">{cat.vehicle(s.modelId)} · {s.carrierName}</span>
            <span className="small">{s.cargo.length ? s.cargo.map((c) => `${cat.product(c.productId)} ★${c.quality} ${i.qty(c.qtyKg)}`).join(", ") : t("logistics.emptyLoad")}</span>
            {s.status === "in_transit" ? <><TimeProgress from={s.departedAt} to={s.arrivesAt} steel /><span className="small">{t("logistics.eta")}: <Countdown until={s.arrivesAt} doneText={t("logistics.arrived")} /></span></> : null}
            {s.cost ? <KV k={t("logistics.estCost")} v={`${i.money(s.cost.total)} (${t("logistics.fuelCost")} ${i.money(s.cost.fuel)} + ${t("logistics.driverCost")} ${i.money(s.cost.driver)})`} /> : null}
            {s.proof ? (
              <Disclosure summary={t("logistics.proof")}>
                <span className="small">{t("logistics.receivedBy")}: {s.proof.receivedBy} · {i.date(s.proof.deliveredAt)}</span>
                <span className="small">{s.proof.lines.map((l) => `${cat.product(l.productId)} ${i.qty(l.qtyKg)}`).join(", ")}</span>
                <code className="xs" style={{ wordBreak: "break-all" }}>sha256: {s.proof.hash}</code>
              </Disclosure>
            ) : null}
          </div></Card>
        ))}</div>
      )}
    </Async>
  );
}
