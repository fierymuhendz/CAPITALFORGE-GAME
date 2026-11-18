"use client";

import { useMemo, useState, type FormEvent } from "react";
import { MAX_BATCHES, StartProductionSchema, type RecipeIdString } from "@capitalforge/shared";
import { ACTION_ERROR_TEXT, facilityLabel, productLabel, recipeLabel } from "../lib/labels";
import { useGame } from "./GameProvider";
import { Feedback, useAction } from "./useAction";

const focus = "outline-none focus-visible:ring-2 focus-visible:ring-white";

export function ProductionForm() {
  const { company, catalog } = useGame();
  const { run, busy, message, setMessage, connected } = useAction("startProduction");
  const [facilityId, setFacilityId] = useState("");
  const [recipeId, setRecipeId] = useState<RecipeIdString | "">("");
  const [batches, setBatches] = useState("1");

  const facilities = company?.facilities ?? [];
  const facility = facilities.find((f) => f.id === facilityId) ?? facilities[0];
  const recipes = useMemo(
    () => catalog?.recipes.filter((r) => r.facilityType === facility?.type) ?? [],
    [catalog, facility?.type],
  );
  const recipe = recipes.find((r) => r.id === recipeId) ?? recipes[0];

  if (!company?.company || facilities.length === 0) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!facility || !recipe) return;
    const parsed = StartProductionSchema.omit({ idempotencyKey: true }).safeParse({
      facilityId: facility.id,
      recipeId: recipe.id,
      batches: Number(batches),
    });
    if (!parsed.success) {
      setMessage({ kind: "err", text: ACTION_ERROR_TEXT.INVALID });
      return;
    }
    await run(parsed.data, () => "Üretim başladı.");
  }

  const busyIds = new Set(company.jobs.map((j) => j.facilityId));
  const line = (l: { productId: string; qty: string }) => `${l.qty} ${productLabel(l.productId)}`;

  return (
    <form onSubmit={submit} aria-label="Üretim başlat" className="flex flex-col gap-3 rounded-lg bg-slate-900 p-4">
      <h2 className="text-sm text-slate-400">Üretim</h2>
      <label className="flex flex-col gap-1 text-sm">
        Tesis
        <select
          value={facility?.id ?? ""}
          onChange={(e) => {
            setFacilityId(e.target.value);
            setRecipeId("");
          }}
          data-testid="production-facility"
          className={`rounded bg-slate-800 p-3 ${focus}`}
        >
          {facilities.map((f) => (
            <option key={f.id} value={f.id}>
              {facilityLabel(f.type)} ({f.plotX}, {f.plotY})
              {f.status === "suspended" ? " — askıda" : busyIds.has(f.id) ? " — meşgul" : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Tarif
        <select
          value={recipe?.id ?? ""}
          onChange={(e) => setRecipeId(e.target.value as RecipeIdString)}
          data-testid="production-recipe"
          className={`rounded bg-slate-800 p-3 ${focus}`}
        >
          {recipes.map((r) => (
            <option key={r.id} value={r.id}>{recipeLabel(r.id)}</option>
          ))}
        </select>
      </label>
      {recipe && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm" data-testid="recipe-info">
          <dt className="text-slate-400">Girdi (parti başına)</dt>
          <dd>{recipe.inputs.length ? recipe.inputs.map(line).join(" + ") : "Yok"}</dd>
          <dt className="text-slate-400">Çıktı (parti başına)</dt>
          <dd>{line(recipe.output)}</dd>
          <dt className="text-slate-400">Süre</dt>
          <dd>{recipe.durationTicks} tick</dd>
        </dl>
      )}
      <label className="flex flex-col gap-1 text-sm">
        Parti sayısı (1–{MAX_BATCHES})
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_BATCHES}
          step={1}
          value={batches}
          onChange={(e) => setBatches(e.target.value)}
          data-testid="production-batches"
          className={`rounded bg-slate-800 p-3 ${focus}`}
        />
      </label>
      <button
        type="submit"
        disabled={busy || !connected || !recipe}
        data-testid="start-production"
        className={`rounded bg-emerald-600 p-3 font-semibold hover:bg-emerald-500 disabled:opacity-50 ${focus}`}
      >
        {busy ? "Gönderiliyor…" : "Üretimi başlat"}
      </button>
      <Feedback message={message} testId="production-message" />
    </form>
  );
}
