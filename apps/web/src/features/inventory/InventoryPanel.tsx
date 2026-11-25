"use client";
import { useMemo, useState } from "react";
import type { HoldingDto, MovementDto } from "@capitalforge/shared";
import { useCat } from "@/lib/catalog";
import { useData } from "@/lib/data";
import { setMarketIntent } from "@/lib/intent";
import { useT } from "@/lib/i18n";
import { Async, Button, EmptyState, KV, Sheet, SkeletonList, Table, type Col } from "@/ui";
import { usePlay } from "../play/context";

export function InventoryPanel() {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const { open } = usePlay();
  const res = useData<HoldingDto[]>("/inventory", undefined, ["inventory"]);
  const [city, setCity] = useState<string>("");
  const [sel, setSel] = useState<HoldingDto | null>(null);
  const cities = useMemo(() => [...new Set((res.data ?? []).map((h) => h.cityId))], [res.data]);
  const cols: Col<HoldingDto>[] = [
    { key: "p", head: t("inventory.product"), cell: (h) => <b>{cat.product(h.productId)}</b> },
    { key: "q", head: t("common.quality"), cell: (h) => `★${h.quality}` },
    { key: "n", head: t("inventory.qty"), right: true, cell: (h) => <span className="num">{i.qty(h.qtyKg)}</span> },
    { key: "a", head: t("inventory.available"), right: true, cell: (h) => <span className="num">{i.qty(h.availableKg)}{h.reservedKg ? <span className="muted"> ({t("inventory.reserved")} {i.qty(h.reservedKg)})</span> : null}</span> },
    { key: "c", head: t("inventory.city"), cell: (h) => cat.city(h.cityId) },
    { key: "u", head: t("inventory.avgCost"), right: true, cell: (h) => <span className="num">{i.price(h.avgCostPerKg)}</span> },
  ];
  return (
    <Async res={res}>
      {(all) => {
        const rows = all.filter((h) => !city || h.cityId === city);
        if (!all.length) return <EmptyState icon="box" title={t("inventory.emptyTitle")} text={t("inventory.emptyText")} action={<div className="row wrap"><Button variant="primary" onClick={() => open("facilities")}>{t("inventory.goProduce")}</Button><Button onClick={() => open("market")}>{t("inventory.goMarket")}</Button></div>} />;
        return (
          <div className="col">
            <div className="pill-scroll" role="group" aria-label={t("inventory.city")}>
              <button type="button" className="chip" aria-pressed={!city} onClick={() => setCity("")}>{t("common.all")}</button>
              {cities.map((c) => <button key={c} type="button" className="chip" aria-pressed={city === c} onClick={() => setCity(c)}>{cat.city(c)}</button>)}
            </div>
            <Table cols={cols} rows={rows} rowKey={(h) => `${h.cityId}-${h.productId}-${h.quality}`} onRow={setSel} rowLabel={(h) => cat.product(h.productId)} />
            <Detail h={sel} onClose={() => setSel(null)} onSell={(h) => { setMarketIntent({ productId: h.productId, cityId: h.cityId, side: "sell", quality: h.quality }); setSel(null); open("market"); }} />
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
    <Sheet open={!!h} onClose={onClose} closeLabel={t("common.close")} wide title={h ? `${cat.product(h.productId)} ★${h.quality} · ${cat.city(h.cityId)}` : ""}>
      {h ? (
        <div className="col">
          <KV k={t("inventory.qty")} v={i.qty(h.qtyKg)} />
          <KV k={t("inventory.available")} v={i.qty(h.availableKg)} />
          <KV k={t("inventory.totalCost")} v={i.money(h.costTotal)} />
          <KV k={t("inventory.avgCost")} v={i.price(h.avgCostPerKg)} />
          <Button variant="primary" onClick={() => onSell(h)}>{t("inventory.sell")}</Button>
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
