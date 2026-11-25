"use client";
import { useEffect, useMemo, useState } from "react";
import { BuyVehicleReq, FreightJobReq, ShipmentReq, type FreightJobDto, type FreightQuoteDto, type PublicCompanyDto, type ShipmentDto, type VehicleDto } from "@capitalforge/shared";
import { api } from "@/lib/api";
import { useAction } from "@/lib/action";
import { useApp } from "@/lib/app";
import { useCat } from "@/lib/catalog";
import { useData, useList } from "@/lib/data";
import { useT } from "@/lib/i18n";
import { Async, Badge, Button, Card, Countdown, EmptyState, IntInput, KV, MoneyInput, Notice, SelectField, SystemBadge, TextField, TimeProgress, Tabs, Trend } from "@/ui";
import { usePlay } from "../play/context";
import { CargoPicker, cargoBody, cargoTotal, type CargoLine } from "./CargoPicker";

export function LogisticsPanel() {
  const { t } = useT();
  const [tab, setTab] = useState("fleet");
  return (
    <div className="col">
      <Tabs label={t("panels.logistics")} value={tab} onChange={setTab} items={[{ id: "fleet", label: t("logistics.fleet") }, { id: "send", label: t("logistics.send") }, { id: "board", label: t("logistics.board") }, { id: "post", label: t("logistics.postJob") }, { id: "ships", label: t("logistics.shipments") }]} />
      {tab === "fleet" ? <Fleet go={setTab} /> : tab === "send" ? <Send /> : tab === "board" ? <Board /> : tab === "post" ? <PostJob /> : <Shipments />}
    </div>
  );
}

const useFleet = () => useList<VehicleDto>("/fleet", undefined, ["shipments", "company"]);

function Fleet({ go }: { go: (t: string) => void }) {
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
        {(vs) => vs.length ? <div className="col">{vs.map((v) => (
          <Card key={v.id} tight><div className="col tight">
            <div className="row between"><b>{cat.vehicle(v.modelId)}</b>{v.status === "in_transit" ? <Badge tone="forge">→ {cat.city(v.destCityId)}</Badge> : <Badge tone="good">{t("logistics.idle")}</Badge>}</div>
            <span className="small muted2">{cat.city(v.cityId)}</span>
            {v.status === "in_transit" && v.arrivesAt ? <span className="small">{t("logistics.eta")}: <Countdown until={v.arrivesAt} doneText={t("logistics.arrived")} /></span> : <Button size="sm" onClick={() => go("send")}>{t("logistics.sendNow")}</Button>}
          </div></Card>
        ))}</div> : <EmptyState icon="truck" title={t("logistics.noFleet")} text={t("logistics.noFleetText")} />}
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

function Send() {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const { run, busy } = useAction();
  const fleet = useFleet();
  const idle = (fleet.data ?? []).filter((v) => v.status === "idle" && v.cityId);
  const [vid, setVid] = useState("");
  const [dest, setDest] = useState("");
  const [lines, setLines] = useState<CargoLine[]>([]);
  const v = idle.find((x) => x.id === vid) ?? idle[0];
  const dst = dest && dest !== v?.cityId ? dest : cat.world.cities.find((c) => c.id !== v?.cityId)?.id ?? "";
  const kg = cargoTotal(lines);
  const model = cat.world.vehicleModels.find((m) => m.id === v?.modelId);
  const quote = useData<FreightQuoteDto>(v?.cityId && dst && kg > 0 ? "/freight/quote" : null, { originCityId: v?.cityId ?? "", destCityId: dst, kg, modelId: v?.modelId }, []);
  const mine = quote.data?.own.find((o) => o.modelId === v?.modelId);
  useEffect(() => { setLines([]); }, [v?.id]);
  const body = { vehicleId: v?.id, destCityId: dst, cargo: cargoBody(lines) };
  const ok = !!v && ShipmentReq.omit({ idempotencyKey: true }).safeParse(body).success && (!model || kg <= model.capacityKg);
  if (fleet.data && !idle.length) return <EmptyState icon="truck" title={t("logistics.noIdle")} text={t("logistics.noIdleText")} />;
  return (
    <Async res={fleet}>
      {() => (
        <div className="col">
          <p className="muted2 small">{t("logistics.sendHint")}</p>
          <SelectField label={t("logistics.vehicle")} value={v?.id ?? ""} onChange={setVid} options={idle.map((x) => ({ id: x.id, label: `${cat.vehicle(x.modelId)} — ${cat.city(x.cityId)}` }))} />
          <SelectField label={t("logistics.destination")} value={dst} onChange={setDest} options={cat.world.cities.filter((c) => c.id !== v?.cityId).map((c) => ({ id: c.id, label: i.name(c.name) }))} />
          {v?.cityId ? <CargoPicker cityId={v.cityId} lines={lines} onChange={setLines} allowEmpty /> : null}
          {model && kg > model.capacityKg ? <Notice tone="bad">{t("errors.VEHICLE_CAPACITY")} ({i.qty(model.capacityKg)})</Notice> : null}
          {!lines.length ? <Notice tone="steel">{t("logistics.repositionNote")}</Notice> : null}
          {mine ? <Card flat tight><div className="col tight" aria-live="polite">
            <KV k={t("logistics.estCost")} v={<b>{i.money(mine.total)}</b>} /><KV k={t("logistics.fuelCost")} v={i.money(mine.fuel)} /><KV k={t("logistics.driverCost")} v={i.money(mine.driver)} />
            <KV k={t("logistics.eta")} v={`${t("common.minutes", { n: mine.minutes })} (${i.date(mine.arrivesAt)})`} />
            <KV k={t("logistics.systemQuote")} v={i.money(quote.data!.systemQuote)} />
          </div></Card> : null}
          <div className="sticky-cta"><Button variant="primary" size="lg" loading={busy} disabled={!ok} onClick={() => void run(() => api.post("/shipments", body), { ok: "logistics.shipped" }).then((r) => { if (r) setLines([]); })}>{lines.length ? t("logistics.shipBtn") : t("logistics.moveEmpty")}</Button></div>
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
  const fleet = useFleet();
  const { run, busy } = useAction();
  const [pick, setPick] = useState<Record<string, string>>({});
  return (
    <div className="col">
      <div className="pill-scroll"><button type="button" className="chip" aria-pressed={scope === "board"} onClick={() => setScope("board")}>{t("logistics.openJobs")}</button><button type="button" className="chip" aria-pressed={scope === "mine"} onClick={() => setScope("mine")}>{t("logistics.myJobs")}</button></div>
      <Async res={res}>
        {(jobs) => !jobs.length ? <EmptyState icon="truck" title={t("logistics.noJobs")} text={t(scope === "board" ? "logistics.noJobsText" : "logistics.noMyJobsText")} /> : (
          <div className="col">{jobs.map((j) => {
            const fits = (fleet.data ?? []).filter((v) => v.status === "idle" && v.cityId === j.originCityId && (cat.world.vehicleModels.find((m) => m.id === v.modelId)?.capacityKg ?? 0) >= j.totalKg);
            const vid = pick[j.id] ?? fits[0]?.id ?? "";
            const net = j.estCostForMe ? BigInt(j.payAmount) - BigInt(j.estCostForMe) : null;
            return (
              <Card key={j.id}><div className="col tight">
                <div className="row between wrap"><b>{cat.city(j.originCityId)} → {cat.city(j.destCityId)} · {j.distanceKm} km</b><Badge tone={j.status === "open" ? "good" : undefined}>{t(`logistics.jobStatus.${j.status}`)}</Badge></div>
                <span className="small muted2">{j.cargo.map((c) => `${cat.product(c.productId)} ★${c.quality} ${i.qty(c.qtyKg)}`).join(", ")}</span>
                <span className="small muted">{j.shipperName} {j.isSystem ? <SystemBadge /> : null} → {j.consigneeName}</span>
                <KV k={t("logistics.pay")} v={<b>{i.money(j.payAmount)}</b>} />
                <KV k={t("logistics.deadline")} v={<Countdown until={j.deadlineAt} doneText={t("logistics.expired")} />} />
                {j.estCostForMe && net !== null ? <>
                  <KV k={t("logistics.estCost")} v={i.money(j.estCostForMe)} />
                  <KV k={t("logistics.estNet")} v={<Trend value={net.toString()} text={i.signed(net.toString())} />} />
                </> : null}
                {j.status === "open" && j.mine !== "shipper" ? (fits.length ? (
                  <div className="row wrap" style={{ alignItems: "flex-end" }}>
                    <div className="grow"><SelectField label={t("logistics.vehicle")} value={vid} onChange={(v) => setPick({ ...pick, [j.id]: v })} options={fits.map((v) => ({ id: v.id, label: cat.vehicle(v.modelId) }))} /></div>
                    <Button variant="primary" loading={busy} onClick={() => void run(() => api.post(`/freight-jobs/${j.id}/accept`, { vehicleId: vid }), { ok: "logistics.accepted" })}>{t("logistics.accept")}</Button>
                  </div>
                ) : <span className="small warn">⚠ {t("logistics.noFitVehicle", { city: cat.city(j.originCityId) })}</span>) : null}
                {j.status === "open" && j.mine === "shipper" ? <Button size="sm" variant="danger" loading={busy} onClick={() => void run(() => api.post(`/freight-jobs/${j.id}/cancel`), { ok: "logistics.jobCancelled" })}>{t("common.cancel")}</Button> : null}
              </div></Card>
            );
          })}</div>
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
      <p className="muted2 small">{t("logistics.postHint")}</p>
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
      <Button variant="primary" size="lg" loading={busy} disabled={!ok} onClick={() => void run(() => api.post("/freight-jobs", body), { ok: "logistics.jobPosted" }).then((r) => { if (r) { setLines([]); setPay(null); } })}>{t("logistics.postBtn")}</Button>
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
          <Card key={s.id}><div className="col tight">
            <div className="row between wrap"><b>{cat.city(s.originCityId)} → {cat.city(s.destCityId)} · {s.distanceKm} km</b><Badge tone={s.status === "delivered" ? "good" : "forge"}>{s.status === "delivered" ? "✓ " : "▶ "}{t(`logistics.shipStatus.${s.status}`)}</Badge></div>
            <span className="small muted2">{cat.vehicle(s.modelId)} · {t(`logistics.purpose.${s.purpose}`)} · {s.carrierName}</span>
            <span className="small">{s.cargo.length ? s.cargo.map((c) => `${cat.product(c.productId)} ★${c.quality} ${i.qty(c.qtyKg)}`).join(", ") : t("logistics.emptyLoad")}</span>
            {s.status === "in_transit" ? <><TimeProgress from={s.departedAt} to={s.arrivesAt} steel /><span className="small">{t("logistics.eta")}: <Countdown until={s.arrivesAt} doneText={t("logistics.arrived")} /></span></> : null}
            {s.cost ? <KV k={t("logistics.estCost")} v={`${i.money(s.cost.total)} (${t("logistics.fuelCost")} ${i.money(s.cost.fuel)} + ${t("logistics.driverCost")} ${i.money(s.cost.driver)})`} /> : null}
            {s.proof ? (
              <div className="notice good col tight">
                <b>✓ {t("logistics.proof")}</b>
                <span className="small">{t("logistics.receivedBy")}: {s.proof.receivedBy} · {i.date(s.proof.deliveredAt)}</span>
                <span className="small">{s.proof.lines.map((l) => `${cat.product(l.productId)} ${i.qty(l.qtyKg)}`).join(", ")}</span>
                <code className="xs" style={{ wordBreak: "break-all" }}>sha256: {s.proof.hash}</code>
              </div>
            ) : null}
          </div></Card>
        ))}</div>
      )}
    </Async>
  );
}
