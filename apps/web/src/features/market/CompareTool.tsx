"use client";
import { useMemo, useState } from "react";
import { applyBp, estimateOwnTrip, landedCost, systemCarrierQuote, travelMinutes } from "@capitalforge/economy";
import { roadDistanceKm, type WorldDto } from "@capitalforge/shared";
import { useCat } from "@/lib/catalog";
import { useT, type I18n } from "@/lib/i18n";
import { Badge, Card, IntInput, Notice, PriceInput, QtyInput, SelectField } from "@/ui";

/**
 * Karşılaştırma araçları. Yalnızca packages/economy saf fonksiyonlarını kullanır (navlun, teslim maliyeti);
 * sonuçlar tahmindir, işlemi sunucu kesinleştirir.
 */

function km(a: string, b: string): number { return a === b ? 0 : roadDistanceKm(a, b); }

export function freightFor(w: WorldDto, method: string, originCityId: string, destCityId: string, kg: number): { total: bigint; minutes: number } {
  const dist = km(originCityId, destCityId);
  if (dist === 0 || kg <= 0) return { total: 0n, minutes: 0 };
  if (method === "system") {
    const truck = w.vehicleModels[0]!;
    return { total: systemCarrierQuote(dist, kg, BigInt(w.freight.systemBaseFee), BigInt(w.freight.systemPerKm), truck.capacityKg), minutes: travelMinutes(dist, truck.speedKmh) };
  }
  const v = w.vehicleModels.find((m) => m.id === method) ?? w.vehicleModels[0]!;
  const wage = BigInt(w.cities.find((c) => c.id === originCityId)?.wage ?? "0");
  const trip = estimateOwnTrip(dist, { capacityKg: v.capacityKg, speedKmh: v.speedKmh, fuelPerKm: BigInt(v.fuelPerKm) }, wage, { loadingHours: w.freight.driverHoursPerTrip });
  const loads = BigInt(Math.max(1, Math.ceil(kg / v.capacityKg)));
  return { total: trip.total * loads, minutes: trip.minutes * Number(loads) };
}

function dur(i: I18n, minutes: number): string {
  if (minutes <= 0) return i.t("compare.instant");
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return h ? `${h} ${i.t("common.hourShort")} ${m} ${i.t("common.minShort")}` : `${m} ${i.t("common.minShort")}`;
}

function MethodSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const i = useT();
  const cat = useCat();
  return <SelectField label={i.t("compare.method")} value={value} onChange={onChange} options={[{ id: "system", label: i.t("compare.systemCarrier") }, ...cat.world.vehicleModels.map((v) => ({ id: v.id, label: `${i.t("compare.own")}: ${i.name(v.name)}` }))]} />;
}
function CitySelect({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const i = useT();
  const cat = useCat();
  return <SelectField label={label} value={value} onChange={onChange} options={cat.world.cities.map((c) => ({ id: c.id, label: i.name(c.name) }))} />;
}

export function CompareTool() {
  return <div className="col"><Landed /><NearVsFar /></div>;
}

function Landed() {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const w = cat.world;
  const [qty, setQty] = useState<number | null>(12000);
  const [dest, setDest] = useState(w.cities[0]!.id);
  const [a, setA] = useState<{ price: number | null; city: string; method: string }>({ price: null, city: w.cities[1]!.id, method: "system" });
  const [b, setB] = useState<{ price: number | null; city: string; method: string }>({ price: null, city: w.cities[2]!.id, method: "system" });
  const calc = (o: typeof a) => {
    if (!qty || !o.price) return null;
    const f = freightFor(w, o.method, o.city, dest, qty);
    return { ...landedCost(qty, o.price, f.total), minutes: f.minutes, km: km(o.city, dest) };
  };
  const ra = useMemo(() => calc(a), [a, qty, dest]); // eslint-disable-line react-hooks/exhaustive-deps
  const rb = useMemo(() => calc(b), [b, qty, dest]); // eslint-disable-line react-hooks/exhaustive-deps
  const best = ra && rb ? (ra.perKg === rb.perKg ? null : ra.perKg < rb.perKg ? "a" : "b") : null;
  const diff = ra && rb ? (ra.perKg > rb.perKg ? ra.perKg - rb.perKg : rb.perKg - ra.perKg) : 0n;
  const side = (name: string, o: typeof a, set: (v: typeof a) => void, r: typeof ra, id: "a" | "b") => (
    <Card selected={best === id}><div className="col">
      <div className="row between"><h4>{name}</h4>{best === id ? <Badge tone="good">✓ {t("compare.cheaper")}</Badge> : null}</div>
      <PriceInput label={t("compare.supplierPrice")} value={o.price} onChange={(price) => set({ ...o, price })} />
      <CitySelect label={t("compare.supplierCity")} value={o.city} onChange={(city) => set({ ...o, city })} />
      <MethodSelect value={o.method} onChange={(method) => set({ ...o, method })} />
      {r ? (
        <div className="col tight" aria-live="polite">
          <div className="kv"><span className="k">{t("compare.distance")}</span><span className="v">{r.km} km</span></div>
          <div className="kv"><span className="k">{t("compare.goods")}</span><span className="v">{i.money(r.goods.toString())}</span></div>
          <div className="kv"><span className="k">{t("compare.freight")}</span><span className="v">{i.money(r.freight.toString())}</span></div>
          <div className="kv"><span className="k">{t("compare.total")}</span><span className="v"><b>{i.money(r.total.toString())}</b></span></div>
          <div className="kv"><span className="k">{t("compare.perKg")}</span><span className="v"><b>{i.price(r.perKg.toString())}</b> <span className="muted xs">({i.money(r.perKg.toString())}/kg)</span></span></div>
          <div className="kv"><span className="k">{t("compare.time")}</span><span className="v">{dur(i, r.minutes)}</span></div>
        </div>
      ) : <p className="muted small">{t("compare.fill")}</p>}
    </div></Card>
  );
  return (
    <section className="col">
      <h3 style={{ fontSize: "var(--fs-md)" }}>{t("compare.landedTitle")}</h3>
      <p className="muted2 small">{t("compare.landedHint")}</p>
      <div className="grid2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        <QtyInput label={t("compare.qty")} value={qty} onChange={setQty} />
        <CitySelect label={t("compare.dest")} value={dest} onChange={setDest} />
      </div>
      <div className="cards" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
        {side(t("compare.offerA"), a, setA, ra, "a")}
        {side(t("compare.offerB"), b, setB, rb, "b")}
      </div>
      {best ? <Notice tone="good">✓ {t("compare.verdict", { who: best === "a" ? t("compare.offerA") : t("compare.offerB"), diff: i.price(diff.toString()) })}</Notice> : null}
      <Notice tone="steel">{t("compare.estimateNote")}</Notice>
    </section>
  );
}

function NearVsFar() {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const w = cat.world;
  const [qty, setQty] = useState<number | null>(24000);
  const [cost, setCost] = useState<number | null>(null);
  const [home, setHome] = useState(w.cities[0]!.id);
  const [pNear, setPNear] = useState<number | null>(null);
  const [pFar, setPFar] = useState<number | null>(null);
  const [far, setFar] = useState(w.cities[1]!.id);
  const [method, setMethod] = useState("system");
  const [n, setN] = useState(4);
  const [every, setEvery] = useState(24);
  const ok = !!qty && !!cost && !!pNear && !!pFar && n >= 1 && n <= 30 && every >= 1;
  const res = useMemo(() => {
    if (!ok || !qty || !cost || !pNear || !pFar) return null;
    const q = BigInt(qty);
    const costTotal = q * BigInt(cost);
    const revNear = q * BigInt(pNear);
    const fee = applyBp(revNear, w.marketFeeBp);
    const netNear = revNear - fee - costTotal;
    const per = Math.ceil(qty / n);
    const f = freightFor(w, method, home, far, per);
    const revFar = q * BigInt(pFar);
    const freight = f.total * BigInt(n);
    const netFar = revFar - freight - costTotal;
    return { revNear, fee, netNear, revFar, freight, netFar, costTotal, minutes: (n - 1) * every * 60 + f.minutes, perTrip: f.total, per };
  }, [ok, qty, cost, pNear, pFar, n, every, method, home, far, w]);
  const better = res ? (res.netNear === res.netFar ? null : res.netNear > res.netFar ? "near" : "far") : null;
  const box = (id: "near" | "far", title: string, rows: Array<[string, string]>, net: bigint, time: string) => (
    <Card selected={better === id}><div className="col tight">
      <div className="row between"><h4>{title}</h4>{better === id ? <Badge tone="good">✓ {t("compare.moreProfit")}</Badge> : null}</div>
      {rows.map(([k, v]) => <div key={k} className="kv"><span className="k">{k}</span><span className="v">{v}</span></div>)}
      <hr className="sep" />
      <div className="kv"><span className="k"><b>{t("compare.net")}</b></span><span className="v"><b className={net >= 0n ? "good" : "bad"}>{net >= 0n ? "▲ +" : "▼ "}{i.money(net.toString())}</b></span></div>
      <div className="kv"><span className="k">{t("compare.cashIn")}</span><span className="v">{time}</span></div>
    </div></Card>
  );
  return (
    <section className="col">
      <h3 style={{ fontSize: "var(--fs-md)" }}>{t("compare.nearFarTitle")}</h3>
      <p className="muted2 small">{t("compare.nearFarHint")}</p>
      <div className="grid2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        <QtyInput label={t("compare.totalQty")} value={qty} onChange={setQty} />
        <PriceInput label={t("compare.myCost")} value={cost} onChange={setCost} />
        <CitySelect label={t("compare.myCity")} value={home} onChange={setHome} />
        <PriceInput label={t("compare.nearPrice")} value={pNear} onChange={setPNear} />
        <CitySelect label={t("compare.farCity")} value={far} onChange={setFar} />
        <PriceInput label={t("compare.farPrice")} value={pFar} onChange={setPFar} />
        <MethodSelect value={method} onChange={setMethod} />
        <IntInput label={t("compare.deliveries")} value={n} onChange={setN} min={1} max={30} />
        <IntInput label={t("compare.interval")} value={every} onChange={setEvery} min={1} max={168} suffix={t("common.hourShort")} />
      </div>
      {res ? (
        <div className="cards" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }} aria-live="polite">
          {box("near", t("compare.sellNow"), [[t("compare.revenue"), i.money(res.revNear.toString())], [t("compare.fees"), `− ${i.money(res.fee.toString())}`], [t("compare.cost"), `− ${i.money(res.costTotal.toString())}`]], res.netNear, t("compare.instant"))}
          {box("far", t("compare.regular", { n }), [[t("compare.revenue"), i.money(res.revFar.toString())], [t("compare.freightTotal"), `− ${i.money(res.freight.toString())}`], [t("compare.cost"), `− ${i.money(res.costTotal.toString())}`]], res.netFar, dur(i, res.minutes))}
        </div>
      ) : <p className="muted small">{t("compare.fill")}</p>}
      <Notice tone="steel">{t("compare.estimateNote")}</Notice>
    </section>
  );
}
