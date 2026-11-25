/**
 * Veritabanı tabanlı zamanlayıcı. Her görev vadesi gelen kayıtları `FOR UPDATE SKIP LOCKED` ile alır
 * ve durum geçişini aynı işlemde yapar: her iş tam bir kez yerleşir. Sunucu yeniden başlarsa
 * gecikmiş işler ilk turda yerleşir. Testler `runDue(deps, now)` ile zamanı elle ilerletir.
 */
import type { Deps } from "../deps";

export interface Task {
  name: string;
  /** en az bu kadar aralıkla çalışır (ms); 0 = her tur */
  everyMs: number;
  /** vadesi gelenleri işle; işlenen kayıt sayısını döndür */
  run: (deps: Deps, now: Date) => Promise<number>;
}

const tasks: Task[] = [];
const lastRun = new Map<string, number>();

export function registerTask(t: Task): void {
  if (tasks.some((x) => x.name === t.name)) return;
  tasks.push(t);
}

export function listTasks(): string[] {
  return tasks.map((t) => t.name);
}

/** Tüm görevleri bir kez çalıştırır (aralığı dolanları). force=true aralığı yok sayar. */
export async function runDue(deps: Deps, now: Date = deps.clock.now(), force = false): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of tasks) {
    const last = lastRun.get(t.name) ?? 0;
    if (!force && t.everyMs > 0 && now.getTime() - last < t.everyMs) continue;
    lastRun.set(t.name, now.getTime());
    try {
      out[t.name] = await t.run(deps, now);
    } catch (err) {
      deps.log.error({ err, task: t.name }, "zamanlayıcı görevi başarısız");
      out[t.name] = -1;
    }
  }
  return out;
}

/** Test: zamanı adım adım ilerletip her adımda görevleri çalıştır */
export async function resetTaskTimers(): Promise<void> {
  lastRun.clear();
}

export function startScheduler(deps: Deps): () => void {
  let stopped = false;
  let running = false;
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await deps.clock.load(deps.db);
      await runDue(deps);
    } finally {
      running = false;
    }
  };
  const h = setInterval(() => void tick(), deps.config.schedulerIntervalMs);
  void tick();
  return () => {
    stopped = true;
    clearInterval(h);
  };
}
