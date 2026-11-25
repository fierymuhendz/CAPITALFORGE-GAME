/**
 * Oyun testi kipi: çalışan işlerin KALAN süresini tavana çeker (min(kalan, tavan)).
 * Yeni işler zaten tavanla başlar (pace.ts); bu görev kip açıldığında, sunucu yeniden başladığında veya
 * kip açıkken başka bir yoldan uzun süreli kayıt oluştuğunda devreye girer. Bitiş zamanları veritabanındaki
 * sütunlarda güncellendiği için geri sayım ile gerçek bitiş aynıdır; oyuncu çevrimdışıyken de zamanlayıcı yerleştirir.
 *
 * Kapsam: üretim işleri, inşaat ve yükseltmeler, araştırma, yoldaki sevkiyatlar (kendi taşıma, navlun işi,
 * sözleşme teslimatı, boş dönüş) ve sözleşme teslim penceresinin açılması.
 * Kapsam dışı (son tarihler ve altyapı): sözleşme vadeleri/ek süreleri, kredi taksitleri, günlük bakım,
 * oturumlar, hız sınırları, temizlik görevleri.
 */
import { and, eq, gt, isNull } from "drizzle-orm";
import { contractInstallments, contracts, facilities, productionJobs, research, shipments } from "../db/schema";
import type { Deps } from "../deps";
import { UnitOfWork } from "../events/bus";
import { playtestSeconds } from "./pace";

export async function clampActiveWaits(deps: Deps, now: Date): Promise<number> {
  const cap = playtestSeconds(deps.catalog);
  if (cap <= 0) return 0;
  const limit = new Date(now.getTime() + cap * 1000);
  const uow = new UnitOfWork();
  let n = 0;

  const jobs = await deps.db
    .update(productionJobs)
    .set({ endsAt: limit })
    .where(and(eq(productionJobs.status, "running"), gt(productionJobs.endsAt, limit)))
    .returning({ companyId: productionJobs.companyId });
  for (const r of jobs) uow.invalidate(r.companyId, "facilities", "company");
  n += jobs.length;

  const built = await deps.db
    .update(facilities)
    .set({ constructionEndsAt: limit })
    .where(gt(facilities.constructionEndsAt, limit))
    .returning({ companyId: facilities.companyId });
  const upgraded = await deps.db
    .update(facilities)
    .set({ upgradeEndsAt: limit })
    .where(gt(facilities.upgradeEndsAt, limit))
    .returning({ companyId: facilities.companyId });
  for (const r of [...built, ...upgraded]) uow.invalidate(r.companyId, "facilities", "company", "map");
  n += built.length + upgraded.length;

  const res = await deps.db
    .update(research)
    .set({ endsAt: limit })
    .where(gt(research.endsAt, limit))
    .returning({ companyId: research.companyId });
  for (const r of res) uow.invalidate(r.companyId, "research", "company");
  n += res.length;

  const ships = await deps.db
    .update(shipments)
    .set({ arrivesAt: limit })
    .where(and(eq(shipments.status, "in_transit"), gt(shipments.arrivesAt, limit)))
    .returning({ companyId: shipments.carrierCompanyId, id: shipments.id });
  for (const r of ships) uow.invalidate(r.companyId, "shipments", "freight", "inventory");
  n += ships.length;
  if (ships.length) uow.world("map");

  // sözleşme teslim penceresi: açılmasını beklemek bir bekleme; vade ve ek süre (son tarihler) değişmez
  const wins = await deps.db
    .update(contractInstallments)
    .set({ windowOpensAt: limit })
    .where(and(eq(contractInstallments.status, "scheduled"), isNull(contractInstallments.settledAt), gt(contractInstallments.windowOpensAt, limit)))
    .returning({ contractId: contractInstallments.contractId });
  if (wins.length) {
    const ids = [...new Set(wins.map((w) => w.contractId))];
    for (const id of ids) {
      const k = (await deps.db.select({ s: contracts.sellerCompanyId, b: contracts.buyerCompanyId }).from(contracts).where(eq(contracts.id, id)).limit(1))[0];
      uow.invalidate(k?.s, "contracts");
      uow.invalidate(k?.b, "contracts");
    }
  }
  n += wins.length;

  if (n > 0) uow.flush(deps.events);
  return n;
}
