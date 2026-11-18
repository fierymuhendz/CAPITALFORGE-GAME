"use client";

import { useState, type FormEvent } from "react";
import { formatMoney } from "@capitalforge/economy";
import { CompanyNameSchema } from "@capitalforge/shared";
import { ACTION_ERROR_TEXT } from "../lib/labels";
import { useGame } from "./GameProvider";
import { Feedback, useAction } from "./useAction";

const focus = "outline-none focus-visible:ring-2 focus-visible:ring-white";

export function CompanyPanel() {
  const { company, catalog } = useGame();
  const { run, busy, message, setMessage, connected } = useAction("foundCompany");
  const [name, setName] = useState("");

  if (!company) {
    return (
      <section aria-label="Şirket" className="rounded-lg bg-slate-900 p-4 text-sm text-slate-400">
        Şirket bilgisi yükleniyor…
      </section>
    );
  }

  if (!company.company) {
    const submit = async (e: FormEvent) => {
      e.preventDefault();
      const parsed = CompanyNameSchema.safeParse(name);
      if (!parsed.success) {
        setMessage({ kind: "err", text: ACTION_ERROR_TEXT.INVALID });
        return;
      }
      await run({ name: parsed.data }, () => "Şirket kuruldu.");
    };
    return (
      <form onSubmit={submit} aria-label="Şirket kur" className="flex flex-col gap-3 rounded-lg bg-slate-900 p-4">
        <h2 className="text-sm text-slate-400">Şirket kur</h2>
        <p className="text-sm">
          Üretim yapmak için bir şirket kurun.
          {catalog && (
            <>
              {" "}Kuruluş ücreti: <strong data-testid="founding-fee">{formatMoney(BigInt(catalog.companyFoundingFee))}</strong>
            </>
          )}
        </p>
        <label className="flex flex-col gap-1 text-sm">
          Şirket adı
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={32}
            autoComplete="off"
            className={`rounded bg-slate-800 p-3 text-base ${focus}`}
          />
        </label>
        <button
          type="submit"
          disabled={busy || !connected}
          className={`rounded bg-emerald-600 p-3 font-semibold hover:bg-emerald-500 disabled:opacity-50 ${focus}`}
        >
          {busy ? "Kuruluyor…" : "Şirketi kur"}
        </button>
        <Feedback message={message} testId="company-message" />
      </form>
    );
  }

  return (
    <section aria-label="Şirket" className="rounded-lg bg-slate-900 p-4">
      <h2 className="text-sm text-slate-400">Şirket</h2>
      <p data-testid="company-name" className="text-xl font-bold">{company.company.name}</p>
      <p className="mt-1 text-sm text-slate-400">
        Tesis: <span className="tabular-nums text-slate-100">{company.facilities.length}</span>
        {catalog && <> / <span className="tabular-nums">{catalog.maxFacilitiesPerCompany}</span></>}
      </p>
    </section>
  );
}
