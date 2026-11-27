"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { HoldingDto, MovementDto } from "@capitalforge/shared";
import { useCat } from "@/lib/catalog";
import { useData } from "@/lib/data";
import { sellParams, setMarketIntent } from "@/lib/intent";
import { useT } from "@/lib/i18n";
import { Async, Button, EmptyState, Icon, KV, Sheet, SkeletonList, Table, type Col } from "@/ui";
import { usePlay } from "../play/context";

import "../market/trade.css";

export function InventoryPanel() {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const { open } = usePlay();
  const res = useData<HoldingDto[]>("/inventory", undefined, ["inventory"]);
  const [city, setCity] = useState<string>("");
  const [sel, setSel] = useState<HoldingDto | null>(null);
  const sell = (h: HoldingDto) => { setMarketIntent({ productId: h.productId, cityId: h.cityId, side: "sell", quality: h.quality, qtyKg: h.availableKg }); setSel(null); open("market", { params: sellParams(h) }); };
  // Üretim bitti bildiriminden / tesisten gelen ürün: ilgili lot doğrudan açılır
  const sp = useSearchParams();
  const want = sp.get("product");
  const wantCity = sp.get("city");
  const wantQ = sp.get("quality");
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !want || !res.data) return;
    const h = res.data.filter((x) => x.productId === want && (!wantCity || x.cityId === wantCity) && (!wantQ || String(x.quality) === wantQ)).sort((a, b) => b.availableKg - a.availableKg)[0];
    opened.current = true;
    if (h) setSel(h);
  }, [want, wantCity, wantQ, res.data]);
  const cities = useMemo(() => [...new Set((res.data ?? []).map((h) => h.cityId))], [res.data]);
  const cols: Col<HoldingDto>[] = [
    { key: "p", head: t("inventory.product"), lead: true, cell: (h) => <span className="inventory-product"><span className="inventory-emblem" aria-hidden="true"><span className="trade-swatch" style={{ backgroundColor: cat.productColor(h.productId) }} /><Icon name="box" size={19} /></span><b>{cat.product(h.productId)}</b><span className="trade-quality" aria-label={`${t("common.quality")} ${h.quality}`}>★ {h.quality}</span></span> },
    { key: "n", head: t("inventory.qty"), right: true, cell: (h) => <span className="num">{i.qty(h.qtyKg)}</span> },
    { key: "a", head: t("inventory.available"), right: true, cell: (h) => <span className="inventory-available"><b className="num">{i.qty(h.availableKg)}</b><span className="inventory-meter" aria-hidden="true"><span style={{ width: `${h.qtyKg > 0 ? Math.min(100, 100 * h.availableKg / h.qtyKg) : 0}%` }} /></span>{h.reservedKg ? <small>{t("inventory.reserved")} {i.qty(h.reservedKg)}</small> : null}</span> },
    { key: "c", head: t("inventory.city"), cell: (h) => cat.city(h.cityId) },
    { key: "u", head: t("inventory.avgCost"), right: true, cell: (h) => <span className="num">{i.price(h.avgCostPerKg)}</span> },
    { key: "s", head: "", bare: true, act: true, cell: (h) => h.availableKg > 0 ? <Button size="sm" onClick={(e) => { e.stopPropagation(); sell(h); }}>{t("inventory.sell")}</Button> : null },
  ];
  return (
    <Async res={res}>
      {(all) => {
        const rows = all.filter((h) => !city || h.cityId === city);
        if (!all.length) return <EmptyState icon="box" title={t("inventory.emptyTitle")} text={t("inventory.emptyText")} action={<div className="row wrap"><Button variant="primary" onClick={() => open("facilities")}>{t("inventory.goProduce")}</Button><Button onClick={() => open("market")}>{t("inventory.goMarket")}</Button></div>} />;
        const total = rows.reduce((sum, h) => ({
          quantity: sum.quantity + h.qtyKg,
          available: sum.available + h.availableKg,
          cost: sum.cost + BigInt(h.costTotal),
        }), { quantity: 0, available: 0, cost: 0n });
        return (
          <div className="col stock-register">
            <div className="pill-scroll" role="group" aria-label={t("inventory.city")}>
              <button type="button" className="chip" aria-pressed={!city} onClick={() => setCity("")}>{t("common.all")}</button>
              {cities.map((c) => <button key={c} type="button" className="chip" aria-pressed={city === c} onClick={() => setCity(c)}>{cat.city(c)}</button>)}
            </div>
            <dl className="inventory-totals">
              <div><dt><Icon name="box" size={16} />{t("inventory.qty")}</dt><dd>{i.qty(total.quantity)}</dd></div>
              <div><dt><Icon name="check" size={16} />{t("inventory.available")}</dt><dd>{i.qty(total.available)}</dd></div>
              <div><dt><Icon name="coins" size={16} />{t("inventory.totalCost")}</dt><dd>{i.money(total.cost)}</dd></div>
            </dl>
            <Table cols={cols} rows={rows} rowKey={(h) => `${h.cityId}-${h.productId}-${h.quality}`} onRow={setSel} rowLabel={(h) => `${cat.product(h.productId)} · ${t("common.quality")} ${h.quality} · ${cat.city(h.cityId)}`} />
            <Detail h={sel} onClose={() => setSel(null)} onSell={sell} />
          </div>
        );
      }}
    </Async>
  );
}

function Detail({ h, onClose, onSell }: { h: HoldingDto | null; onClose: () => void; onSell: (h: HoldingDto) => void }) {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const mv = useData<MovementDto[]>(h ? "/inventory/movements" : null, h ? { productId: h.productId, cityId: h.cityId, quality: h.quality } : undefined, ["inventory"]);
  return (
    <Sheet open={!!h} onClose={onClose} closeLabel={t("common.close")} wide title={h ? `${cat.product(h.productId)} ★${h.quality} · ${cat.city(h.cityId)}` : ""}
      footer={h ? <Button variant="primary" onClick={() => onSell(h)}>{t("inventory.sell")}</Button> : undefined}>
      {h ? (
        <div className="col">
          <KV k={t("inventory.qty")} v={i.qty(h.qtyKg)} />
          <KV k={t("inventory.available")} v={i.qty(h.availableKg)} />
          <KV k={t("inventory.totalCost")} v={i.money(h.costTotal)} />
          <KV k={t("inventory.avgCost")} v={i.price(h.avgCostPerKg)} />
          <h4>{t("inventory.movements")}</h4>
          {mv.data ? (mv.data.length ? mv.data.map((m) => (
            <div key={m.id} className="card flat tight col tight">
              <div className="row between"><b>{i.kind(m.kind)}</b><span className="muted small">{i.date(m.at)}</span></div>
              <div className="row between small"><span className="num">{i.qty(m.qtyKg)}</span><span className="num">{i.money(m.cost)}</span></div>
              {m.breakdown ? (
                <div className="col tight small muted2">
                  {m.breakdown.inputs.map((x, n) => <KV key={n} k={`${cat.product(x.productId)} ★${x.quality} ${i.qty(x.qtyKg)}`} v={i.money(x.cost)} />)}
                  <KV k={t("quote.energy")} v={i.money(m.breakdown.energy)} />
                  <KV k={t("quote.water")} v={i.money(m.breakdown.water)} />
                  <KV k={t("quote.labor")} v={i.money(m.breakdown.labor)} />
                  {m.breakdown.freightIn && m.breakdown.freightIn !== "0" ? <KV k={t("inventory.freightIn")} v={i.money(m.breakdown.freightIn)} /> : null}
                  {m.breakdown.purchase && m.breakdown.purchase !== "0" ? <KV k={t("inventory.purchase")} v={i.money(m.breakdown.purchase)} /> : null}
                  <KV k={t("quote.total")} v={<b>{i.money(m.breakdown.total)}</b>} />
                </div>
              ) : null}
            </div>
          )) : <p className="muted small">{t("common.none")}</p>) : <SkeletonList n={2} />}
        </div>
      ) : null}
    </Sheet>
  );
}
