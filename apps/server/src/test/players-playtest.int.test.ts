/**
 * Oyuncu Yönetimi (yönetici nakit ayarı, askıya alma) ve oyun testi kipi (her bekleme ≤ 60 sn) entegrasyon testleri.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { totpAt } from "../auth/totp";
import { accounts, adminAuditLog, ledgerTransactions, productionJobs, research, settings } from "../db/schema";
import { found as foundCo, grantStock, HOUR } from "../production/kit";
import { createHarness, type Harness, type Player } from "./harness";
import { checkInvariants } from "./invariants";

let h: Harness;
const db = () => h.deps.db;
const nowMs = () => h.deps.clock.nowMs();

beforeAll(async () => { h = await createHarness({ playtestSeconds: 60 }); });
afterAll(async () => { await h.close(); });

async function mkAdmin(): Promise<Player> {
  const p = await h.player();
  const me = await p.ok("GET", "/auth/me");
  await db().update(accounts).set({ role: "admin" }).where(eq(accounts.id, me.account.id));
  const { secret } = await p.ok("POST", "/auth/totp/setup");
  await p.ok("POST", "/auth/totp/enable", { code: totpAt(secret, Math.floor(nowMs() / 30000)) });
  return p;
}

/** settings.pace değerini yaz ve kataloğu yeniden yükle (yönetici panelindeki ayarın yaptığı) */
async function setPace(v: { maxMinutes: number; playtestSeconds: number }): Promise<void> {
  await db().insert(settings).values({ key: "pace", value: v, updatedAt: new Date() }).onConflictDoUpdate({ target: settings.key, set: { value: v } });
  await h.deps.catalog.reload(db());
}

/** test saati gerçek zamanla akar: beklenen değere ±tol ms */
const near = (actual: number, expected: number, tol = 1500) => expect(Math.abs(actual - expected), `${actual} ≈ ${expected}`).toBeLessThanOrEqual(tol);

const cashOf = async (p: Player): Promise<bigint> => BigInt((await p.ok("GET", "/company")).cash);

describe("Oyuncu Yönetimi", () => {
  let admin: Player;
  let f: Awaited<ReturnType<typeof foundCo>>;
  let accountId: string;

  beforeAll(async () => {
    admin = await mkAdmin();
    f = await foundCo(h, "crop", "yesilova");
    accountId = (await f.p.ok("GET", "/auth/me")).account.id;
  });

  it("yalnızca yöneticiler: oyuncu 403, oturumsuz 401", async () => {
    for (const r of [
      await f.p.get("/admin/players"),
      await f.p.get(`/admin/players/${accountId}`),
      await f.p.post(`/admin/players/${accountId}/balance`, { mode: "add", amount: 100, reason: "kendime para", idempotencyKey: h.key() }),
      await f.p.post(`/admin/players/${accountId}/status`, { suspended: true, reason: "deneme", idempotencyKey: h.key() }),
    ]) {
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe("FORBIDDEN");
    }
    const anon = new (f.p.constructor as new (h: Harness, u: string, ip: string) => Player)(h, "anon", "10.9.9.9");
    expect((await anon.get("/admin/players")).status).toBe(401);
    // CSRF başlığı olmadan değişiklik yapılamaz
    const raw = await h.app.inject({ method: "POST", url: `/admin/players/${accountId}/balance`, headers: { cookie: admin.cookie, "content-type": "application/json" }, payload: JSON.stringify({ mode: "add", amount: 100, reason: "abc", idempotencyKey: h.key() }) });
    expect(raw.statusCode).toBe(403);
  });

  it("arama: oyuncuyu kullanıcı adı ve şirket adıyla bulur, nakit oyuncunun gördüğüyle aynı", async () => {
    const byUser = await admin.ok("GET", `/admin/players?q=${encodeURIComponent(f.p.username)}`);
    const row = byUser.rows.find((r: { accountId: string }) => r.accountId === accountId);
    expect(row.company.id).toBe(f.companyId);
    expect(BigInt(row.cash)).toBe(await cashOf(f.p));
    expect(row.suspended).toBe(false);
    const coName = (await f.p.ok("GET", "/company")).name as string;
    const byCo = await admin.ok("GET", `/admin/players?q=${encodeURIComponent(coName.slice(-4))}`);
    expect(byCo.rows.some((r: { accountId: string }) => r.accountId === accountId)).toBe(true);
  });

  it("para ekle: tek defter işlemi, tekrar gönderim ikinci kez uygulanmaz, oyuncu yeni bakiyeyi görür", async () => {
    const before = await cashOf(f.p);
    const body = { mode: "add", amount: 2_500_000, reason: "Test ödülü", idempotencyKey: h.key() };
    const r1 = await admin.post(`/admin/players/${accountId}/balance`, body);
    expect(r1.status).toBe(200);
    expect(BigInt(r1.body.before)).toBe(before);
    expect(BigInt(r1.body.after)).toBe(before + 2_500_000n);
    // aynı istek tekrar: aynı yanıt, ikinci işlem yok
    const r2 = await admin.post(`/admin/players/${accountId}/balance`, body);
    expect(r2.body).toEqual(r1.body);
    expect(await cashOf(f.p)).toBe(before + 2_500_000n);
    const txs = await db().select().from(ledgerTransactions).where(and(eq(ledgerTransactions.kind, "admin_balance_adjust"), eq(ledgerTransactions.refId, accountId)));
    expect(txs.length).toBe(1);
    // oyuncu bildirimi
    const notes = await f.p.ok("GET", "/notifications");
    const list = Array.isArray(notes) ? notes : notes.items ?? notes.rows ?? [];
    expect(JSON.stringify(list)).toContain("admin_balance_adjusted");
    expect(await checkInvariants(db())).toEqual([]);
  });

  it("para düş: bakiyeden fazlası reddedilir; geçerli tutar düşer", async () => {
    const before = await cashOf(f.p);
    const big = await admin.post(`/admin/players/${accountId}/balance`, { mode: "deduct", amount: Number(before) + 1, reason: "fazla", idempotencyKey: h.key() });
    expect(big.body.error.code).toBe("INSUFFICIENT_FUNDS");
    expect(await cashOf(f.p)).toBe(before);
    const ok = await admin.ok("POST", `/admin/players/${accountId}/balance`, { mode: "deduct", amount: 1_000_000, reason: "Hatalı ödül düzeltmesi", idempotencyKey: h.key() });
    expect(BigInt(ok.after)).toBe(before - 1_000_000n);
    expect(await cashOf(f.p)).toBe(before - 1_000_000n);
  });

  it("tam bakiye: hedef bakiye yazılır; kayıt yönetici, gerekçe, zaman, önce/sonra taşır", async () => {
    const before = await cashOf(f.p);
    const r = await admin.ok("POST", `/admin/players/${accountId}/balance`, { mode: "set", amount: 7_777_700, reason: "Test bakiyesi", idempotencyKey: h.key() });
    expect(BigInt(r.before)).toBe(before);
    expect(r.after).toBe("7777700");
    expect(await cashOf(f.p)).toBe(7_777_700n);
    // aynı değere ayarlamak "değişiklik yok"
    const same = await admin.post(`/admin/players/${accountId}/balance`, { mode: "set", amount: 7_777_700, reason: "Test bakiyesi", idempotencyKey: h.key() });
    expect(same.body.error.code).toBe("BAD_REQUEST");

    const adminId = (await admin.ok("GET", "/auth/me")).account.id;
    const audit = await db().select().from(adminAuditLog).where(and(eq(adminAuditLog.action, "player.balance_adjust"), eq(adminAuditLog.targetId, accountId)));
    expect(audit.length).toBe(3);
    const last = audit.find((a) => (a.after as { mode: string }).mode === "set")!;
    expect(last.adminAccountId).toBe(adminId);
    expect(last.reasoning).toBe("Test bakiyesi");
    near(last.createdAt.getTime(), nowMs());
    expect((last.before as { cash: string }).cash).toBe(before.toString());
    expect((last.after as { cash: string }).cash).toBe("7777700");

    const detail = await admin.ok("GET", `/admin/players/${accountId}`);
    expect(detail.player.cash).toBe("7777700");
    expect(detail.adjustments.length).toBe(3);
    expect(detail.adjustments[0].adminUsername).toBe(admin.username);
    expect(detail.adjustments.map((a: { mode: string }) => a.mode).sort()).toEqual(["add", "deduct", "set"]);
    // oyuncunun finans ekranı da aynı bakiyeyi gösterir
    const fin = await f.p.ok("GET", "/finance");
    expect(fin.balances.cash).toBe("7777700");
    expect(await checkInvariants(db())).toEqual([]);
  });

  it("askıya al / yeniden etkinleştir; yönetici askıya alınamaz", async () => {
    await admin.ok("POST", `/admin/players/${accountId}/status`, { suspended: true, reason: "Kural ihlali incelemesi", idempotencyKey: h.key() });
    const blocked = await f.p.post("/production/start", { facilityId: f.facilityId, recipeId: "grow_fodder", batches: 1, repeat: false, idempotencyKey: h.key() });
    expect(blocked.body.error.code).toBe("ACCOUNT_FROZEN");
    const list = await admin.ok("GET", `/admin/players?q=${encodeURIComponent(f.p.username)}`);
    expect(list.rows[0].suspended).toBe(true);
    // tekrar askıya alma çakışma
    expect((await admin.post(`/admin/players/${accountId}/status`, { suspended: true, reason: "yine", idempotencyKey: h.key() })).body.error.code).toBe("CONFLICT");
    await admin.ok("POST", `/admin/players/${accountId}/status`, { suspended: false, reason: "İnceleme bitti", idempotencyKey: h.key() });
    expect((await f.p.ok("GET", "/company")).id).toBe(f.companyId);
    const detail = await admin.ok("GET", `/admin/players/${accountId}`);
    expect(detail.statusHistory.map((s: { suspended: boolean }) => s.suspended)).toEqual([false, true]);
    // yönetici hesabı askıya alınamaz
    const other = await mkAdmin();
    const otherId = (await other.ok("GET", "/auth/me")).account.id;
    expect((await admin.post(`/admin/players/${otherId}/status`, { suspended: true, reason: "deneme", idempotencyKey: h.key() })).body.error.code).toBe("FORBIDDEN");
  });
});

describe("oyun testi kipi: her bekleme ≤ 60 sn", () => {
  it("çok saatlik iş (3 sa çelik dökümü, tempo tavanı kapalı) 60 sn'de biter; geri sayım gerçek bitişle aynı, oyuncu çevrimdışıyken de", async () => {
    await setPace({ maxMinutes: 0, playtestSeconds: 60 });
    expect(h.deps.catalog.recipe("smelt_steel").minutes).toBe(180);
    const f = await foundCo(h, "manufacturing", "korfezkent", "steel_mill");
    const job = await f.p.ok("POST", "/production/start", { facilityId: f.facilityId, recipeId: "smelt_steel", batches: 1, repeat: false, idempotencyKey: h.key() });
    // oyuncunun gördüğü geri sayım = sunucudaki bitiş; süre tam 60 sn
    const row = (await db().select().from(productionJobs).where(eq(productionJobs.id, job.id)))[0]!;
    expect(row.endsAt.getTime()).toBe(Date.parse(job.endsAt));
    expect(row.endsAt.getTime() - row.startedAt.getTime()).toBe(60_000);
    // oyuncu hiçbir istek atmadan (çevrimdışı) zaman ilerler: bitişten 1 sn önce sürüyor, bitişte tamam
    const left = row.endsAt.getTime() - nowMs();
    await h.advance(left - 1_000, left);
    expect((await db().select().from(productionJobs).where(eq(productionJobs.id, job.id)))[0]!.status).toBe("running");
    await h.advance(1_100, 1_100);
    const done = (await db().select().from(productionJobs).where(eq(productionJobs.id, job.id)))[0]!;
    expect(done.status).toBe("completed");
    expect(done.completedAt!.getTime()).toBe(row.endsAt.getTime());
    expect(await checkInvariants(db())).toEqual([]);
  });

  it("araştırma (3 sa) 60 sn; dünya kataloğu kip bilgisini ve kısaltılmış süreleri gönderir", async () => {
    const f = await foundCo(h, "crop", "yesilova");
    const t0 = nowMs();
    await f.p.ok("POST", "/research/agronomy/start", { idempotencyKey: h.key() });
    const r = (await db().select().from(research).where(and(eq(research.companyId, f.companyId), eq(research.researchId, "agronomy"))))[0]!;
    near(r.endsAt!.getTime() - t0, 60_000);
    const w = await f.p.ok("GET", "/world");
    expect(w.pace.playtestSeconds).toBe(60);
    expect(w.recipes.find((x: { id: string }) => x.id === "smelt_steel").minutes).toBe(1);
    expect(w.buildingTypes ?? w.buildings).toBeTruthy();
    await h.advance(60_000, 60_000);
    const after = (await db().select().from(research).where(and(eq(research.companyId, f.companyId), eq(research.researchId, "agronomy"))))[0]!;
    expect(after.level).toBe(1);
  });

  it("kip açılınca çalışan işin kalan süresi 60 sn'ye iner; 15 sn kalan iş 15 sn kalır; kapatınca yeni işler normal sürer", async () => {
    // kip kapalı: iki iş normal sürede başlar (3 sa)
    await setPace({ maxMinutes: 0, playtestSeconds: 0 });
    const long = await foundCo(h, "manufacturing", "korfezkent", "steel_mill");
    const short = await foundCo(h, "manufacturing", "korfezkent", "steel_mill");
    const jShort = await short.p.ok("POST", "/production/start", { facilityId: short.facilityId, recipeId: "smelt_steel", batches: 1, repeat: false, idempotencyKey: h.key() });
    expect(Date.parse(jShort.endsAt) - nowMs()).toBeGreaterThan(2 * HOUR); // çok saatlik
    // kısa işin bitişine 15 sn kalana kadar ilerle
    await h.advance(Date.parse(jShort.endsAt) - nowMs() - 15_000, 15 * 60_000);
    const jLong = await long.p.ok("POST", "/production/start", { facilityId: long.facilityId, recipeId: "smelt_steel", batches: 1, repeat: false, idempotencyKey: h.key() });
    expect(Date.parse(jLong.endsAt) - nowMs()).toBeGreaterThan(2 * HOUR); // çok saatlik

    // kip açılır (yönetici paneli): zamanlayıcının ilk turu kalan süreleri min(kalan, 60 sn) yapar
    await setPace({ maxMinutes: 0, playtestSeconds: 60 });
    const t1 = nowMs();
    await h.tick();
    const rowLong = (await db().select().from(productionJobs).where(eq(productionJobs.id, jLong.id)))[0]!;
    const rowShort = (await db().select().from(productionJobs).where(eq(productionJobs.id, jShort.id)))[0]!;
    near(rowLong.endsAt.getTime() - t1, 60_000);
    // 15 sn kalan iş dokunulmadı: bitiş zamanı aynı
    expect(rowShort.endsAt.getTime()).toBe(Date.parse(jShort.endsAt));
    // (ilerletmeden bu yana gerçek zaman da aktı: kalan ≤ 15 sn ve 60 sn'ye çekilmedi)
    expect(rowShort.endsAt.getTime() - t1).toBeLessThanOrEqual(15_000);
    expect(rowShort.endsAt.getTime() - t1).toBeGreaterThan(5_000);
    // oyuncunun tesis ekranındaki bitiş zamanı aynı
    const fac = await long.p.ok("GET", `/facilities/${long.facilityId}`);
    expect(Date.parse(fac.jobs.find((j: { id: string }) => j.id === jLong.id).endsAt)).toBe(rowLong.endsAt.getTime());

    await h.advance(rowShort.endsAt.getTime() - nowMs() + 100, 60_000);
    expect((await db().select().from(productionJobs).where(eq(productionJobs.id, jShort.id)))[0]!.status).toBe("completed");
    expect((await db().select().from(productionJobs).where(eq(productionJobs.id, jLong.id)))[0]!.status).toBe("running");
    await h.advance(rowLong.endsAt.getTime() - nowMs() + 100, 60_000);
    expect((await db().select().from(productionJobs).where(eq(productionJobs.id, jLong.id)))[0]!.status).toBe("completed");

    // kip kapatılır: yeni iş yine normal sürer
    await setPace({ maxMinutes: 0, playtestSeconds: 0 });
    await grantStock(h, long.companyId, long.cityId, "iron_ore", 1, 5000, 500_000n);
    await grantStock(h, long.companyId, long.cityId, "coal", 1, 5000, 500_000n);
    const again = await long.p.ok("POST", "/production/start", { facilityId: long.facilityId, recipeId: "smelt_steel", batches: 1, repeat: false, idempotencyKey: h.key() });
    expect(Date.parse(again.endsAt) - nowMs()).toBeGreaterThan(2 * HOUR);
    expect(await checkInvariants(db())).toEqual([]);
  });

  it("yönetici panelindeki tek ayar: pace.playtestSeconds 60 → 0", async () => {
    await setPace({ maxMinutes: 60, playtestSeconds: 60 });
    const admin = await mkAdmin();
    const off = await admin.ok("PATCH", "/admin/settings", { key: "pace.playtestSeconds", value: 0, reasoning: "Test bitti" });
    expect(off.id).toBe("pace.playtestSeconds");
    expect((h.deps.catalog.settings.pace as { playtestSeconds: number }).playtestSeconds).toBe(0);
    expect(h.deps.catalog.settings.pace.maxMinutes).toBe(60);
    await admin.ok("PATCH", "/admin/settings", { key: "pace.playtestSeconds", value: 60, reasoning: "Teste dön" });
    expect((h.deps.catalog.settings.pace as { playtestSeconds: number }).playtestSeconds).toBe(60);
    // oyuncu bu ayarı değiştiremez
    const p = await h.player();
    expect((await p.patch("/admin/settings", { key: "pace.playtestSeconds", value: 0, reasoning: "hile" })).status).toBe(403);
  });
});
