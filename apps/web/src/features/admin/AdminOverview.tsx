"use client";
import { useState } from "react";
import type { AdminAlertDto, AdminProductDetailDto, AdminProductMetricsDto } from "@capitalforge/shared";
import { api } from "@/lib/api";
import { useAction } from "@/lib/action";
import { useCat } from "@/lib/catalog";
import { useData, useList } from "@/lib/data";
import { useT } from "@/lib/i18n";
import { Async, Badge, Button, Card, EmptyState, KV, SelectField, Sheet, SkeletonList, SystemBadge, Table, TextField, Trend, type Col } from "@/ui";

type Row = AdminProductMetricsDto["rows"][number];

export function Overview() {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const [product, setProduct] = useState("");
  const [city, setCity] = useState("");
  const [sel, setSel] = useState<Row | null>(null);
  const res = useData<AdminProductMetricsDto>("/admin/overview", { byCity: "1", productId: product, cityId: city }, ["*"]);
  const cols: Col<Row>[] = [
    { key: "p", head: t("inventory.product"), cell: (r) => <b>{cat.product(r.productId)}</b> },
    { key: "c", head: t("inventory.city"), cell: (r) => cat.city(r.cityId) },
    { key: "s", head: t("admin.stock"), right: true, cell: (r) => i.qty(r.inventoryKg) },
    { key: "l", head: t("admin.openListings"), right: true, cell: (r) => i.qty(r.openListingsKg) },
    { key: "o", head: t("admin.openOrders"), right: true, cell: (r) => i.qty(r.openOrdersKg) },
    { key: "h", head: t("admin.hoursToBuyer"), right: true, cell: (r) => r.avgHoursToBuyer === null ? "—" : `${r.avgHoursToBuyer.toFixed(1)} ${t("common.hourShort")}` },
    { key: "r", head: t("market.ref"), right: true, cell: (r) => i.price(r.refPricePerKg) },
    { key: "v", head: "VWAP 24h", right: true, cell: (r) => r.vwap24h ? i.price(r.vwap24h) : "—" },
    { key: "d", head: t("admin.change24h"), right: true, cell: (r) => r.priceChange24hBp === null ? "—" : <Trend value={r.priceChange24hBp} text={`${r.priceChange24hBp > 0 ? "+" : ""}${i.pct(r.priceChange24hBp)}`} /> },
    { key: "m", head: t("market.volume24h"), right: true, cell: (r) => i.qty(r.volume24hKg) },
    { key: "w", head: t("admin.volume7d"), right: true, cell: (r) => i.qty(r.volume7dKg) },
    { key: "x", head: t("admin.systemShare"), right: true, cell: (r) => i.pct(r.systemShareBp) },
  ];
  return (
    <div className="col">
      <div className="grid2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        <SelectField label={t("inventory.product")} value={product} onChange={setProduct} options={[{ id: "", label: t("common.all") }, ...cat.world.products.map((p) => ({ id: p.id, label: i.name(p.name) }))]} />
        <SelectField label={t("inventory.city")} value={city} onChange={setCity} options={[{ id: "", label: t("common.all") }, ...cat.world.cities.map((c) => ({ id: c.id, label: i.name(c.name) }))]} />
      </div>
      <Async res={res}>{(d) => d.rows.length ? <Table cols={cols} rows={d.rows} rowKey={(r) => `${r.productId}-${r.cityId}`} onRow={setSel} rowLabel={(r) => cat.product(r.productId)} /> : <EmptyState title={t("common.none")} />}</Async>
      <ProductSheet row={sel} onClose={() => setSel(null)} />
    </div>
  );
}

function ProductSheet({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const res = useData<AdminProductDetailDto>(row ? `/admin/products/${row.productId}` : null, { cityId: row?.cityId ?? undefined }, []);
  return (
    <Sheet open={!!row} onClose={onClose} wide closeLabel={t("common.close")} title={row ? `${cat.product(row.productId)} · ${cat.city(row.cityId)}` : ""}>
      <Async res={res} skeleton={<SkeletonList n={3} />}>
        {(d) => (
          <div className="col">
            <h4>{t("admin.holders")}</h4>
            {d.holders.slice(0, 20).map((h, n) => <KV key={n} k={<span className="row">{h.companyName} {h.isSystem ? <SystemBadge /> : null} · {cat.city(h.cityId)} ★{h.quality}</span>} v={`${i.qty(h.qtyKg)} (${t("inventory.reserved")} ${i.qty(h.reservedKg)}) · ${i.price(h.avgCostPerKg)}`} />)}
            <h4>{t("market.recent")}</h4>
            {d.recentTrades.map((x) => <KV key={x.id} k={<span>{i.date(x.at)} · {x.sellerName}{x.sellerIsSystem ? " (S)" : ""} → {x.buyerName}{x.buyerIsSystem ? " (S)" : ""}</span>} v={`${i.qty(x.qtyKg)} · ${i.price(x.pricePerKg)}`} />)}
          </div>
        )}
      </Async>
    </Sheet>
  );
}

const KINDS = ["price_anomaly", "shortage", "excess_inventory", "wealth_spike", "price_spike", "unfilled_freight", "stalled_production"] as const;

export function Alerts({ goCases }: { goCases: () => void }) {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const { run, busy } = useAction();
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("open");
  const [caseFor, setCaseFor] = useState<AdminAlertDto | null>(null);
  const [title, setTitle] = useState("");
  const [why, setWhy] = useState("");
  const res = useList<AdminAlertDto>("/admin/alerts", { kind, status }, ["*"]);
  const d = (a: AdminAlertDto, k: string) => a.details[k];
  return (
    <div className="col">
      <div className="grid2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        <SelectField label={t("admin.alertKind")} value={kind} onChange={setKind} options={[{ id: "", label: t("common.all") }, ...KINDS.map((k) => ({ id: k, label: t(`admin.alertKinds.${k}`) }))]} />
        <SelectField label={t("common.status")} value={status} onChange={setStatus} options={[{ id: "", label: t("common.all") }, ...(["open", "acknowledged", "case_opened"] as const).map((s) => ({ id: s, label: t(`admin.alertStatus.${s}`) }))]} />
      </div>
      <Async res={res}>
        {(rows) => !rows.length ? <EmptyState icon="shield" title={t("admin.noAlerts")} /> : (
          <div className="col">{rows.map((a) => {
            const dev = typeof d(a, "deviationBp") === "number" ? (d(a, "deviationBp") as number) : null;
            return (
              <Card key={a.id}><div className="col tight">
                <div className="row between wrap"><b>{t(`admin.alertKinds.${a.kind}`)}</b><span className="row"><Badge tone={a.severity === "high" ? "bad" : a.severity === "warn" ? "warn" : undefined}>{a.severity === "high" ? "▲▲ " : a.severity === "warn" ? "▲ " : ""}{t(`admin.severity.${a.severity}`)}</Badge>{d(a, "insufficientData") === true ? <Badge tone="warn">{t("admin.insufficient")}</Badge> : null}{d(a, "sameConnectionGroup") === true ? <Badge tone="bad">{t("admin.sameGroup")}</Badge> : null}</span></div>
                <span className="small muted">{i.date(a.at)} · {a.productId ? cat.product(a.productId) : ""} {a.cityId ? `· ${cat.city(a.cityId)}` : ""}</span>
                {a.kind === "price_anomaly" ? (
                  <>
                    <KV k={t("admin.refPrice")} v={typeof d(a, "refPricePerKg") === "string" ? i.price(d(a, "refPricePerKg") as string) : "—"} />
                    <KV k={t("admin.tradePrice")} v={typeof d(a, "pricePerKg") === "string" ? i.price(d(a, "pricePerKg") as string) : "—"} />
                    <KV k={t("admin.deviation")} v={dev === null ? "—" : <Trend value={dev} text={`${dev > 0 ? "+" : ""}${i.pct(dev)}`} />} />
                    <KV k={t("admin.comparables")} v={String(d(a, "comparables") ?? "—")} />
                  </>
                ) : Object.entries(a.details).map(([k, v]) => <KV key={k} k={k} v={String(v)} />)}
                {a.companyNames.length ? <KV k={t("admin.parties")} v={a.companyNames.join(" ↔ ")} /> : null}
                <div className="row wrap">
                  {a.status === "open" ? <Button size="sm" loading={busy} onClick={() => void run(() => api.post(`/admin/alerts/${a.id}/ack`), { ok: "admin.acked" })}>{t("admin.ack")}</Button> : <Badge>{t(`admin.alertStatus.${a.status}`)}</Badge>}
                  {a.status !== "case_opened" ? <Button size="sm" variant="primary" onClick={() => { setCaseFor(a); setTitle(`${t(`admin.alertKinds.${a.kind}`)} ${a.productId ? cat.product(a.productId) : ""}`.trim()); setWhy(""); }}>{t("admin.openCase")}</Button> : null}
                </div>
              </div></Card>
            );
          })}</div>
        )}
      </Async>
      <Sheet open={!!caseFor} onClose={() => setCaseFor(null)} closeLabel={t("common.close")} title={t("admin.openCase")}>
        <div className="col">
          <TextField label={t("admin.caseTitle")} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
          <TextField label={t("admin.reasoning")} value={why} onChange={(e) => setWhy(e.target.value)} maxLength={2000} hint={t("admin.reasoningHint")} />
          <Button variant="primary" loading={busy} disabled={title.trim().length < 3 || why.trim().length < 3} onClick={() => void run(() => api.post("/admin/cases", { subjectType: "alert", subjectId: caseFor!.id, title, reasoning: why }), { ok: "admin.caseOpened" }).then((r) => { if (r) { setCaseFor(null); goCases(); } })}>{t("admin.openCase")}</Button>
        </div>
      </Sheet>
    </div>
  );
}
