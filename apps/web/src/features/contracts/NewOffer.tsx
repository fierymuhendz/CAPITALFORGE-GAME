"use client";
import { useState } from "react";
import { ContractProposalReq, type PublicCompanyDto } from "@capitalforge/shared";
import { api } from "@/lib/api";
import { useAction } from "@/lib/action";
import { useCat } from "@/lib/catalog";
import { serverNow } from "@/lib/clock";
import { useList } from "@/lib/data";
import { isoToLocalInput, localInputToIso } from "@/lib/numbers";
import { useT } from "@/lib/i18n";
import { ActionBar, Button, Field, IntInput, Notice, PriceInput, ProductPicker, QtyInput, SelectField, Seg, TextField } from "@/ui";

export function NewOffer({ onDone }: { onDone: () => void }) {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const w = cat.world;
  const { run, busy } = useAction();
  const [role, setRole] = useState<"seller" | "buyer">("seller");
  const [direct, setDirect] = useState(false);
  const [q, setQ] = useState("");
  const [cp, setCp] = useState<PublicCompanyDto | null>(null);
  const [productId, setProduct] = useState(w.products[0]!.id);
  const [minQuality, setMinQ] = useState(2);
  const [qty, setQty] = useState<number | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [city, setCity] = useState(w.cities[0]!.id);
  const [payer, setPayer] = useState<"seller" | "buyer">("seller");
  const [n, setN] = useState(4);
  const [first, setFirst] = useState(() => isoToLocalInput(new Date(serverNow() + 24 * 3600_000).toISOString()));
  const [every, setEvery] = useState(24);
  const [grace, setGrace] = useState(2);
  const [penalty, setPenalty] = useState(10);
  const [expires, setExpires] = useState(24);
  const [note, setNote] = useState("");
  const found = useList<PublicCompanyDto>(direct && !cp && q.trim().length >= 2 ? "/companies/search" : null, { q: q.trim() }, []);
  const body = {
    role, counterpartyCompanyId: direct ? cp?.id : undefined, productId, minQuality, qtyPerInstallmentKg: qty, pricePerKg: price, deliveryCityId: city, freightPayer: payer,
    installments: n, firstDueAt: localInputToIso(first) ?? "", intervalHours: every, graceHours: grace, penaltyBp: penalty * 100, expiresInHours: expires, note: note.trim() || undefined,
  };
  const parsed = ContractProposalReq.omit({ idempotencyKey: true }).safeParse(body);
  const ok = parsed.success && (!direct || !!cp);
  return (
    <form className="col" onSubmit={(e) => { e.preventDefault(); if (!ok) return; void run(() => api.post("/contracts", body), { ok: "contracts.created" }).then((r) => { if (r) onDone(); }); }}>
      <Field label={t("contracts.myRole")}>{() => <Seg label={t("contracts.myRole")} value={role} onChange={setRole} items={[{ id: "seller", label: t("contracts.iSell") }, { id: "buyer", label: t("contracts.iBuy") }]} />}</Field>
      <Field label={t("contracts.audience")}>{() => <Seg label={t("contracts.audience")} value={direct ? "direct" : "board"} onChange={(v) => { setDirect(v === "direct"); setCp(null); }} items={[{ id: "board", label: t("contracts.toBoard") }, { id: "direct", label: t("contracts.toCompany") }]} />}</Field>
      {direct ? (
        <div className="col tight">
          <TextField label={t("contracts.companySearch")} value={cp ? cp.name : q} onChange={(e) => { setCp(null); setQ(e.target.value); }} hint={t("contracts.companySearchHint")} />
          {found.data?.length ? found.data.map((c) => <Button key={c.id} size="sm" onClick={() => setCp(c)}>{c.name} · {t("common.level")} {c.level} · {i.pct(c.reputationBp)}</Button>) : null}
          {q.trim().length >= 2 && !cp && found.data && !found.data.length ? <p className="muted small">{t("contracts.noCompany")}</p> : null}
        </div>
      ) : null}
      <ProductPicker label={t("inventory.product")} value={productId} onChange={setProduct} products={w.products} />
      <SelectField label={t("market.minQuality")} value={String(minQuality)} onChange={(v) => setMinQ(Number(v))} options={[1, 2, 3, 4, 5].map((x) => ({ id: String(x), label: `★${x}` }))} />
      <QtyInput label={t("contracts.qtyPer")} value={qty} onChange={setQty} />
      <PriceInput label={t("market.price")} value={price} onChange={setPrice} />
      <SelectField label={t("contracts.deliveryCity")} value={city} onChange={setCity} options={w.cities.map((c) => ({ id: c.id, label: i.name(c.name) }))} />
      <SelectField label={t("contracts.freightPayer")} value={payer} onChange={(v) => setPayer(v as "seller" | "buyer")} options={[{ id: "seller", label: t("contracts.role.seller") }, { id: "buyer", label: t("contracts.role.buyer") }]} hint={t(`contracts.freightWho.${payer}`)} />
      <IntInput label={t("contracts.installments")} value={n} onChange={setN} min={1} max={30} />
      <TextField label={t("contracts.firstDue")} type="datetime-local" value={first} onChange={(e) => setFirst(e.target.value)} />
      <IntInput label={t("contracts.interval")} value={every} onChange={setEvery} min={1} max={168} suffix={t("common.hourShort")} />
      <IntInput label={t("contracts.grace")} value={grace} onChange={setGrace} min={0} max={24} suffix={t("common.hourShort")} />
      <IntInput label={t("contracts.missingPenalty")} value={penalty} onChange={setPenalty} min={0} max={50} suffix="%" hint={t("contracts.missingPenaltyHint")} />
      <IntInput label={t("contracts.expiresIn")} value={expires} onChange={setExpires} min={1} max={168} suffix={t("common.hourShort")} />
      <TextField label={t("contracts.note")} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
      {qty && price ? <div className="notice steel small col tight"><b>{t("contracts.summary")}</b><span>{t("contracts.summaryLine", { q: i.qty(qty), n, p: i.price(price), h: every, city: cat.city(city) })}</span><span>{t("contracts.freightWho." + payer)}</span><span>{t("contracts.summaryPenalty", { pct: penalty })}</span></div> : null}
      {!parsed.success && qty && price ? <Notice tone="warn">{t("contracts.checkForm")}</Notice> : null}
      <ActionBar><Button type="submit" variant="primary" loading={busy} disabled={!ok}>{t("contracts.create")}</Button></ActionBar>
    </form>
  );
}
