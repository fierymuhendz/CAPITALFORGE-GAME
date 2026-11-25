# CapitalForge

Arkadaş grubunun haftalarca aynı kalıcı dünyada oynadığı, tarayıcıda çalışan çok oyunculu ekonomi simülasyonu. Her oyuncunun bir şirketi var: arsa alır, üretir, taşır, piyasada ve sözleşmelerle satar, borçlanır, araştırır. Ayrıntılı tasarım `docs/plans/v2-oyun-tasarimi.md`, kısa rehber `docs/PROJE-REHBERI.md`.

## Teknoloji yığını

| Katman | Seçim |
|---|---|
| Arayüz | Next.js (App Router), TypeScript, Tailwind; 3D şehir three.js (prosedürel, harici model yok), hafif görünüm için 2D harita |
| Sunucu | Node.js 22, TypeScript, Fastify 5 (REST) + `@fastify/websocket` (`/events`, yalnızca "şu veri değişti" bildirimi) |
| Veritabanı | PostgreSQL, Drizzle ORM; tüm tablolar `cf` şemasında, migration kaydı `cf_migrations` |
| Önbellek | Redis (`cf:` önekli hız sınırı sayaçları) |
| Zamanlama | Veritabanı tabanlı zamanlayıcı (`apps/server/src/scheduler`), `FOR UPDATE SKIP LOCKED` ile tam bir kez yerleşme |
| Test | Vitest (`unit` ve `integration` projeleri), fast-check, Playwright |
| Paket yönetimi | pnpm workspaces |

## Klasör yapısı

```
apps/web/            Next.js istemcisi (src/scene 3D, src/map2d 2D, src/ui bileşenler)
apps/server/         HTTP API, zamanlayıcı, defter, modüller (http/modules/a-economy, b-trade, c-admin)
packages/shared/     Katalog (şehir, ürün, tarif, bina, arsa), zod şemaları, API tipleri, TR/EN sözlük
packages/economy/    Saf ekonomi formülleri ve denge simülasyonu (sim/run.ts)
docs/plans/          Planlar (özellik başına bir dosya)
docs/economy/        Denge simülasyonu çıktısı (denge.md)
deploy/              Üretim compose, Caddy, yedek/geri yükleme
e2e/                 Canlı adres duman testi
```

## Değişmez kurallar

1. **Sunucu otoritedir.** İstemci yalnızca niyet gönderir. Fiyat, bakiye, stok, süre yalnızca sunucuda hesaplanır.
2. **Para tam sayıdır.** Tutarlar kuruş cinsinden `bigint`, miktarlar tam sayı kg, fiyatlar kuruş/kg. API'de para string döner. `float` ile para hesabı yasak; yuvarlama `packages/economy/src/money.ts` içinde.
3. **Çift taraflı defter.** Her para hareketi `ledger/post.ts` üzerinden; her işlem şirket başına dengeli (toplam sıfır), benzersiz `idempotency_key` taşır. Kayıtlı defter satırı değiştirilmez, düzeltme `reverse()` ile.
4. **Atomiklik.** Para ve stok işlemleri tek transaction'da, satır kilidiyle. Mutasyon istekleri `idempotencyKey` taşır, tekrarında aynı yanıt döner.
5. **Ekonomi formülleri saftır.** `packages/economy` veritabanına, ağa, saate erişmez.
6. **Girdi doğrulama.** Her istek `packages/shared` zod şemasıyla doğrulanır.
7. **Hız sınırı** Redis üzerinde, mutasyonlar `x-cf-intent: 1` başlığı ister (CSRF).
8. **Sırlar ve IP'ler koda, loga, rapora girmez.** IP yalnızca HMAC karması olarak `connection_records`'ta, 30 gün.
9. **Oyuncu ilerlemesi korunur.** Şema değişikliği yeni migration ile; katalog tohumlama yalnızca eksik satırları ekler. Eski oyunun silinmesi yalnızca `reset-legacy.yml` ile, elle.

## Kod standartları

- TypeScript `strict`, `any` yok. Ortak tipler yalnızca `@capitalforge/shared` içinden.
- Her yeni para akışı veya formül için test. Entegrasyon testlerinden sonra `checkInvariants` çağrılır.
- Migration'lar geri alınabilir (`apps/server/drizzle/down/`).
- Kullanıcıya görünen her metin TR ve EN sözlükte (`packages/shared/src/i18n`).
- Commit mesajları kısa ve emir kipinde.

## Komutlar

```
pnpm install
pnpm dev                 # web + server
pnpm test                # birim testleri
pnpm test:int            # entegrasyon (TEST_DATABASE_URL, adında "test" geçen veritabanı)
pnpm typecheck
pnpm sim                 # denge simülasyonu, docs/economy/denge.md yazar, sorun varsa çıkış 1
pnpm db:generate         # şemadan migration üret
pnpm db:migrate          # migration + katalog tohumlama
```

## Ajan ekibi

`.claude/agents/` altında: mimar (plan), oyun-tasarimci (katalog ve denge), backend-dev, sehir-3d, arayuz-dev, test-qa, guvenlik-reviewer, yayin. Her ajanın teslimatı ve doğrulama yöntemi kendi dosyasında. Ne zaman hangisi: `docs/PROJE-REHBERI.md`.

- Tek dosyalık düzeltme, metin değişikliği gibi küçük işlerde ajan çağırma.
- Bağımsız işler paralel; her ajan kendi dosya sahipliğinde çalışır, bilgi aktarımı `docs/plans/` üzerinden.
- Ajan raporu: `DEĞİŞEN DOSYALAR` ve `AÇIK KONULAR`, başka açıklama yok.
