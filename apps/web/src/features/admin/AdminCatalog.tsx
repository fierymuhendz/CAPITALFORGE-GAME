"use client";
import { useState } from "react";
import { AdminProductPatchReq, AdminRecipePatchReq, AdminSettingReq, AdminTimeReq, type AdminAuditDto, type AdminCatalogDto, type AdminChangeResultDto } from "@capitalforge/shared";
import { api } from "@/lib/api";
import { useAction } from "@/lib/action";
import { useCat } from "@/lib/catalog";
import { useData } from "@/lib/data";
import { useT } from "@/lib/i18n";
import { useToast } from "@/ui";
import { Async, Button, Card, KV, Notice, Sheet, TextField } from "@/ui";

interface RecipeData { minutes?: number; laborHours?: number; energyKwh?: number; waterM3?: number; output?: { kg?: number }; name?: { tr: string; en: string } }
interface ProductData { basePricePerKg?: number }

function useChange() {
  const { run, busy } = useAction();
  const toast = useToast();
  const { t } = useT();
  const go = async (fn: () => Promise<AdminChangeResultDto>) => {
    const r = await run(fn);
    if (r) toast({ kind: "good", text: `${t("admin.changed", { v: r.version })} ${Object.entries(r.affected).map(([k, n]) => `${k}: ${n}`).join(", ")}`, ms: 9000 });
    return r;
  };
  return { go, busy };
}

export function CatalogTab() {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const res = useData<AdminCatalogDto>("/admin/catalog", undefined, []);
  const [edit, setEdit] = useState<{ kind: "recipe" | "product" | "setting"; id: string } | null>(null);
  return (
    <Async res={res}>
      {(d) => (
        <div className="col">
          <Notice tone="steel">{t("admin.catalogNote")}</Notice>
          <h3>{t("admin.recipes")}</h3>
          {d.recipes.map((r) => { const x = r.data as RecipeData; return (
            <Card key={r.id} onClick={() => setEdit({ kind: "recipe", id: r.id })} tight><div className="row between wrap"><b>{cat.recipe(r.id)}</b><span className="small muted">v{r.version} · {x.minutes} {t("common.minShort")} · {x.energyKwh} kWh · {x.waterM3} m³ · {x.laborHours} {t("found.hour")} · {x.output?.kg} kg</span></div></Card>
          ); })}
          <h3>{t("admin.products")}</h3>
          {d.products.map((p) => <Card key={p.id} onClick={() => setEdit({ kind: "product", id: p.id })} tight><div className="row between"><b>{cat.product(p.id)}</b><span className="small muted">v{p.version} · {(p.data as ProductData).basePricePerKg !== undefined ? i.price(String((p.data as ProductData).basePricePerKg)) : ""}</span></div></Card>)}
          <h3>{t("admin.settings")}</h3>
          {Object.entries(d.settings).map(([k, s]) => <Card key={k} onClick={() => setEdit({ kind: "setting", id: k })} tight><div className="col tight"><b className="small">{k}</b><code className="xs muted" style={{ wordBreak: "break-all" }}>{JSON.stringify(s.value).slice(0, 160)}</code></div></Card>)}
          {edit ? <EditSheet cat={d} edit={edit} onClose={() => setEdit(null)} /> : null}
        </div>
      )}
    </Async>
  );
}

function EditSheet({ cat: d, edit, onClose }: { cat: AdminCatalogDto; edit: { kind: "recipe" | "product" | "setting"; id: string }; onClose: () => void }) {
  const i = useT();
  const { t } = i;
  const { go, busy } = useChange();
  const recipe = edit.kind === "recipe" ? d.recipes.find((r) => r.id === edit.id) : undefined;
  const product = edit.kind === "product" ? d.products.find((r) => r.id === edit.id) : undefined;
  const rd = (recipe?.data ?? {}) as RecipeData;
  const [f, setF] = useState<Record<string, string>>({
    minutes: String(rd.minutes ?? ""), laborHours: String(rd.laborHours ?? ""), energyKwh: String(rd.energyKwh ?? ""), waterM3: String(rd.waterM3 ?? ""), outputKg: String(rd.output?.kg ?? ""),
    price: String((product?.data as ProductData | undefined)?.basePricePerKg ?? ""),
    json: JSON.stringify(d.settings[edit.id]?.value ?? null, null, 2),
  });
  const [why, setWhy] = useState("");
  const set = (k: string, v: string) => setF({ ...f, [k]: v });
  const num = (k: string, cur: number | undefined) => (f[k] !== "" && Number(f[k]) !== cur ? Number(f[k]) : undefined);
  let body: Record<string, unknown> = {}; let valid = false;
  if (edit.kind === "recipe") {
    body = { minutes: num("minutes", rd.minutes), laborHours: num("laborHours", rd.laborHours), energyKwh: num("energyKwh", rd.energyKwh), waterM3: num("waterM3", rd.waterM3), outputKg: num("outputKg", rd.output?.kg), reasoning: why };
    valid = AdminRecipePatchReq.omit({ idempotencyKey: true }).safeParse(body).success && Object.entries(body).some(([k, v]) => k !== "reasoning" && v !== undefined);
  } else if (edit.kind === "product") {
    body = { basePricePerKg: Number(f.price), reasoning: why };
    valid = AdminProductPatchReq.omit({ idempotencyKey: true }).safeParse(body).success;
  } else {
    let value: unknown = null; let ok = true;
    try { value = JSON.parse(f.json!); } catch { ok = false; }
    body = { key: edit.id, value, reasoning: why };
    valid = ok && AdminSettingReq.omit({ idempotencyKey: true }).safeParse(body).success;
  }
  const path = edit.kind === "recipe" ? `/admin/catalog/recipes/${edit.id}` : edit.kind === "product" ? `/admin/catalog/products/${edit.id}` : "/admin/settings";
  return (
    <Sheet open onClose={onClose} closeLabel={t("common.close")} title={edit.id}>
      <div className="col">
        {recipe ? (<>
          <KV k={t("admin.version")} v={`v${recipe.version}`} />
          {(["minutes", "laborHours", "energyKwh", "waterM3", "outputKg"] as const).map((k) => <TextField key={k} label={t(`admin.fields.${k}`)} inputMode="numeric" value={f[k]!} onChange={(e) => set(k, e.target.value.replace(/\D/g, ""))} />)}
        </>) : null}
        {product ? <TextField label={t("admin.fields.basePrice")} inputMode="numeric" value={f.price!} onChange={(e) => set("price", e.target.value.replace(/\D/g, ""))} hint={t("admin.fields.basePriceHint")} /> : null}
        {edit.kind === "setting" ? <div className="field"><label htmlFor="json">JSON</label><textarea id="json" className="input" rows={8} value={f.json} onChange={(e) => set("json", e.target.value)} style={{ fontFamily: "monospace" }} /></div> : null}
        <TextField label={t("admin.reasoning")} value={why} onChange={(e) => setWhy(e.target.value)} maxLength={500} hint={t("admin.reasoningHint")} />
        <Notice tone="warn">{t("admin.effectNote")}</Notice>
        <Button variant="primary" loading={busy} disabled={!valid} onClick={() => void go(() => api.patch<AdminChangeResultDto>(path, body)).then((r) => { if (r) onClose(); })}>{t("common.save")}</Button>
      </div>
    </Sheet>
  );
}

export function AuditTab() {
  const i = useT();
  const { t } = i;
  const res = useData<AdminAuditDto>("/admin/audit", { limit: 100 }, []);
  return (
    <Async res={res}>
      {(d) => !d.rows.length ? <p className="muted">{t("common.none")}</p> : (
        <div className="col">{d.rows.map((r) => (
          <Card key={r.id} tight><div className="col tight">
            <div className="row between wrap"><b className="small">{auditLabel(t, r.action)}</b><span className="xs muted">{r.adminUsername} · {i.date(r.at)}</span></div>
            <span className="small muted2">{r.target}</span>
            {r.reasoning ? <span className="small">{r.reasoning}</span> : null}
            {r.before !== null || r.after !== null ? <details><summary className="small">{t("admin.beforeAfter")}</summary><pre className="xs" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{JSON.stringify({ before: r.before, after: r.after }, null, 1)}</pre></details> : null}
          </div></Card>
        ))}</div>
      )}
    </Async>
  );
}

export function TimeTab() {
  const { t } = useT();
  const { run, busy } = useAction();
  const [m, setM] = useState("60");
  const body = { minutes: Number(m) };
  return (
    <Card><div className="col">
      <Notice tone="warn">{t("admin.timeNote")}</Notice>
      <TextField label={t("admin.minutes")} inputMode="numeric" value={m} onChange={(e) => setM(e.target.value.replace(/\D/g, ""))} />
      <div className="row wrap">{[60, 360, 1440].map((n) => <Button key={n} size="sm" onClick={() => setM(String(n))}>{n >= 1440 ? `${n / 1440} ${t("common.day")}` : `${n / 60} ${t("common.hourShort")}`}</Button>)}</div>
      <Button variant="primary" loading={busy} disabled={!AdminTimeReq.safeParse(body).success} onClick={() => void run(() => api.post("/admin/time/advance", body), { ok: "admin.timeAdvanced" })}>{t("admin.advance")}</Button>
    </div></Card>
  );
}

/** Denetim eylem kodunu çevirir; bilinmeyen kod ham gösterilir */
function auditLabel(t: (k: string) => string, action: string): string {
  const key = `admin.auditAction.${action.replace(/\./g, "_")}`;
  const v = t(key);
  return v === key ? action : v;
}
