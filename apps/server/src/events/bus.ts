/**
 * Olay yolu: veritabanı işlemi tamamlandıktan sonra ilgili şirketlerin istemcilerine
 * WebSocket üzerinden "şunu yenile" sinyali gider. Kaynak her zaman PostgreSQL'dir; olay kaybolsa
 * istemci periyodik yenilemeyle yine doğru veriyi görür.
 */
import { EventEmitter } from "node:events";
import type { NotificationDto, ServerEvent, Topic } from "@capitalforge/shared";

export class EventBus {
  private readonly em = new EventEmitter();
  constructor() {
    this.em.setMaxListeners(10_000);
  }
  /** companyId → olay; "*" tüm bağlı istemciler */
  emit(companyId: string | "*", ev: ServerEvent): void {
    this.em.emit(companyId, ev);
  }
  on(companyId: string | "*", fn: (ev: ServerEvent) => void): () => void {
    this.em.on(companyId, fn);
    return () => this.em.off(companyId, fn);
  }
}

/** İşlem birimi: işlem sırasında biriken olaylar commit sonrası yayınlanır. */
export class UnitOfWork {
  readonly invalidations = new Map<string, Set<Topic>>();
  readonly notifications: Array<{ companyId: string; n: NotificationDto }> = [];
  worldTopics = new Set<"map" | "market">();

  invalidate(companyId: string | null | undefined, ...topics: Topic[]): void {
    if (!companyId) return;
    const s = this.invalidations.get(companyId) ?? new Set<Topic>();
    for (const t of topics) s.add(t);
    this.invalidations.set(companyId, s);
  }
  world(...t: Array<"map" | "market">): void {
    for (const x of t) this.worldTopics.add(x);
  }
  flush(bus: EventBus): void {
    for (const [cid, topics] of this.invalidations) bus.emit(cid, { type: "invalidate", topics: [...topics] });
    for (const { companyId, n } of this.notifications) bus.emit(companyId, { type: "notification", notification: n });
    if (this.worldTopics.size) bus.emit("*", { type: "world", topics: [...this.worldTopics] });
  }
}
