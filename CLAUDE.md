# CapitalForge

Çok oyunculu, ekonomi temalı, tarayıcıda çalışan bir strateji oyunu. Oyuncular şirket kurar, üretir, alır, satar, borçlanır ve vergi öder. Fiyatlar arz-talep, enflasyon ve faizle canlı olarak değişir.

## Teknoloji yığını

| Katman | Seçim |
|---|---|
| Arayüz | Next.js (App Router), TypeScript, Tailwind, grafikler için lightweight-charts veya Recharts |
| Sunucu | Node.js 22, TypeScript, REST/HTTP için Fastify, para defteri `apps/server/src/ledger` |
| Gerçek zamanlı | Colyseus (odalar, durum senkronizasyonu) |
| Veritabanı | PostgreSQL, şema ve migration için Drizzle ORM |
| Önbellek / kuyruk | Redis (oturum, sıralama tabloları, pub/sub, BullMQ işleri) |
| Test | Vitest (birim), Playwright (uçtan uca), fast-check (özellik tabanlı ekonomi testleri) |
| Paket yönetimi | pnpm workspaces (monorepo) |

Farklı bir yığın seçilirse sadece bu bölümü güncelle.

## Klasör yapısı

```
apps/web/          Next.js istemcisi
apps/server/       Node + Colyseus oyun sunucusu, HTTP API
packages/shared/   Ortak tipler, şemalar (zod), sabitler
packages/economy/  Saf ekonomi formülleri (yan etkisiz, test edilebilir)
docs/plans/        Mimarın planları (özellik başına bir dosya)
docs/economy/      Ekonomi parametreleri ve simülasyon sonuçları
```

## Değişmez kurallar

1. **Sunucu otoritedir.** İstemci sadece niyet gönderir ("şunu al"). Fiyat, bakiye, stok hesabını sadece sunucu yapar. İstemciden gelen hiçbir sayıya güvenilmez.
2. **Para tam sayıdır.** Tüm tutarlar en küçük birimde `BIGINT` (ör. kuruş) tutulur. `float` ile para hesabı yasak. Yuvarlama kuralı `packages/economy` içinde tek yerde tanımlıdır.
3. **Çift taraflı defter.** Her para hareketi `ledger_entries` tablosuna borç ve alacak olarak yazılır, toplam her zaman sıfırdır. Bakiye defterden türetilir veya defterle aynı işlemde güncellenir.
4. **Para işlemleri atomiktir.** Tek bir veritabanı işleminde (transaction) yapılır, satır kilidi (`SELECT ... FOR UPDATE`) veya uygun izolasyon kullanılır. Her işlemin bir `idempotency_key` değeri vardır, aynı istek iki kez işlenmez.
5. **Ekonomi formülleri saftır.** `packages/economy` içindeki fonksiyonlar veritabanına, ağa, saate erişmez. Zaman ve rastgelelik parametre olarak verilir (tohumlu RNG).
6. **Girdi doğrulama.** Sunucuya gelen her mesaj `packages/shared` içindeki zod şemasıyla doğrulanır. Negatif, sıfır, aşırı büyük ve tam sayı olmayan miktarlar reddedilir.
7. **Hız sınırı.** Oyuncu başına işlem hız sınırı Redis üzerinde uygulanır.
8. **Sırlar koda girmez.** `.env` dosyaları commit edilmez, `.env.example` güncel tutulur.

## Kod standartları

- TypeScript `strict` açık, `any` yok (gerekirse gerekçeli `unknown`).
- Ortak tipler sadece `packages/shared` içinden içe aktarılır, kopyalanmaz.
- Her yeni para akışı veya formül için test zorunludur.
- Migration'lar geri alınabilir yazılır.
- Commit mesajları Türkçe veya İngilizce olabilir, kısa ve emir kipinde.

## Komutlar

```
pnpm install
pnpm dev             # web + server birlikte
pnpm test            # tüm birim testleri
pnpm db:generate     # Drizzle migration üret
pnpm lint && pnpm typecheck
pnpm sim             # ekonomi denge simülasyonu (packages/economy)
```

Playwright uçtan uca testleri ilk oynanabilir akışla birlikte eklenecek.

## Ajan ekibi ve iş akışı

Büyük bir özellik şu sırayla ilerler. Bir aşama özelliğe dokunmuyorsa atlanır (ör. sadece arayüz değişikliğinde ekonomi-tasarimci çağrılmaz).

1. **mimar** (Opus, sadece okur): plan çıkarır. Ana oturum planı `docs/plans/<ozellik>.md` olarak kaydeder.
2. **ekonomi-tasarimci** (Sonnet): formülleri `packages/economy` içine yazar, simülasyon çalıştırır.
3. **backend-dev** (Sonnet): sunucu, veritabanı, Colyseus odaları, para işlemleri.
4. **frontend-dev** (Sonnet): arayüz, grafikler, canlı veri.
5. **test-qa** (Haiku): test yazar ve çalıştırır, hata raporlar.
6. **guvenlik-reviewer** (Sonnet, sadece okur): para çoğaltma, hile, yetki açıklarını denetler.

### Kredi kuralları

- Tek dosyalık düzeltme, küçük yeniden adlandırma, metin değişikliği gibi işlerde ajan çağırma, ana oturum doğrudan yapsın.
- Kod içinde arama için yerleşik Explore ajanını kullan, yeni ajan ekleme.
- Bir ajana iş verirken plan dosyasının yolunu ve ilgili dosyaları açıkça yaz, ajan her şeyi baştan keşfetmesin.
- Ajanlar arası bilgi aktarımı dosya üzerinden olur (`docs/plans/`, `docs/economy/`), uzun mesajlarla değil.

### Rapor kuralı (tüm ajanlar)

Her ajan işini şu kısa formatta bitirir, başka açıklama yazmaz:

```
DEĞİŞEN DOSYALAR:
- yol/dosya.ts — tek satır ne değişti
AÇIK KONULAR:
- (varsa) çözülmeyen sorun, karar bekleyen nokta
```
