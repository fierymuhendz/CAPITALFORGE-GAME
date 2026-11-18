# İlk oynanabilir sürüm

## Amaç
Misafir oyuncu kullanıcı adıyla girer ve bir kez başlangıç parası alır. Birkaç mal için sunucunun belirlediği fiyattan alım ve satım yapar, fiyatı canlı grafikte izler. Her para ve stok hareketi tek transaction içinde, çift taraflı defterle ve idempotent olarak işlenir. Bu akış gerçek PostgreSQL üzerinde eşzamanlılık testleriyle kanıtlanır.

## Kapsam dışı
Şirket, üretim, borç, faiz, enflasyon, oyuncular arası emir defteri, limit emir, kalıcı hesap (şifre/OAuth), çoklu sunucu örneği, Playwright e2e (yalnızca iskelet), yönetim paneli.

## Mevcut kodda düzeltilecekler
- `ledger/transfer.ts` kendi transaction'ını açıyor. Ticarette envanter de aynı işlemde değişmeli. Çözüm: `applyTransfer(tx, …)` çekirdeği çıkarılır, `transfer(db, …)` bunu saran ince katman olarak kalır.
- `transfers.idempotency_key` global. Anahtar sunucuda kapsamlanır: `trade:<playerId>:<uuid>`, `grant:start:<playerId>`.
- Duplicate yanıtı orijinal sonucu döndürmüyor. Sonuç `trades` tablosundan okunarak döndürülür.
- `MarketRoom` fiyatı bellekte tutuyor ve oda başına tick atıyor. Fiyatın otoritesi DB'ye taşınır, tick tek bir sunucu döngüsüne alınır.
- Ekonomi açığı: tick başına en büyük fiyat adımı (`maxPriceStepBps`=500) > gidiş-dönüş vergi (2×100). Büyük alım fiyatı +%5 iter, sonraki tick'te satış ~%3 kâr eder. Spread ve likidite ile kapatılır.
- Yeni ortam değişkenleri `.env.example` dosyasına eklenir.

## Veri modeli (migration `0001_*`, geri alma `drizzle/down/0001_*.sql`)
- `products`: `id text PK` (`wheat`, `iron`, `energy`), `name`, `price bigint CHECK (price >= 1)`, `pending_demand bigint ≥0`, `pending_supply bigint ≥0`, `tick bigint`.
- `inventories`: `(player_id, product_id)` PK, `quantity bigint CHECK (quantity >= 0)`.
- `trades`: `id uuid`, `player_id`, `client_key uuid`, `side buy|sell`, `product_id`, `quantity >0`, `unit_price`, `gross`, `tax`, `transfer_id UNIQUE`, `created_at`. UNIQUE `(player_id, client_key)`.
- `price_history`: PK `(product_id, tick)`, `price`, `at`.
- `accounts`: oyuncu başına tek cüzdan için kısmi UNIQUE indeks.
- Seed: `system:mint`, `system:tax`, `system:market` hesapları; 3 ürün ve başlangıç fiyatları.

## Ekonomi (`packages/economy`, saf)
- Yeni parametreler (sim ile kesinleşir): `startingBalance 1_000_000n` (10.000 TL), `spreadBps 150n`, `maxPriceStepBps 300n`, `liquidity 1_000n`, `maxPrice 10n**12n`.
- `quoteTrade(side, price, qty) → { unitPrice, gross, tax, playerDelta }`. Alımda `price + spread`, satımda `price − spread` (min fiyatla kırpılır). Vergi yukarı yuvarlanır. Yuvarlama hep sistemin lehine, para yaratılmaz.
- `nextPrice(price, demand, supply, liquidity)`: `imbalanceBps = (d−s)*maxStep/(d+s+L)`, sonuç `[minPrice, maxPrice]` aralığında.
- fast-check özellikleri: fiyat aralıkta kalır; adım sınırı aşılmaz; sistem tarafı toplamı ≥ 0; tek tick'te al, sonraki tick'te sat her miktar için kârsız; `tax ≤ gross`.
- `sim/run.ts` güncellenir, sonuç `docs/economy/ilk-surum.md`.

## Para akışları (`ledger_entries`, toplam 0)
- Başlangıç: `system:mint −S`, `player +S`. Anahtar `grant:start:<playerId>`.
- Alım: `player −(gross+tax)`, `system:market +gross`, `system:tax +tax`, envanter `+qty`.
- Satım: `system:market −gross`, `player +(gross−tax)`, `system:tax +tax`, envanter `−qty`.
- `system:market` sonsuz stoklu karşı taraftır, bakiyesi negatif olabilir.

## Akış ve eşzamanlılık
`executeTrade(db, playerId, order)` (`apps/server/src/market/trade.ts`), tek transaction:
1. `INSERT trades … ON CONFLICT (player_id, client_key) DO NOTHING`. Mevcutsa: payload farklıysa `IDEMPOTENCY_MISMATCH`, aynıysa kayıtlı sonuç `duplicate:true` ile döner.
2. Sabit kilit sırası: `products` → oyuncu hesabı → `inventories` (`FOR UPDATE`). Tick ürünleri id sırasıyla kilitler. Deadlock önlenir.
3. Fiyat kilitli satırdan okunur, `quoteTrade` hesaplanır.
4. Bakiye/envanter ön kontrolü, açık hata kodu. CHECK kısıtları ikinci savunma.
5. `applyTransfer`, envanter upsert, `pending_demand/supply += qty`, trade satırı doldurulur.
6. Commit sonrası oyuncuya `portfolio` mesajı.

- Tick (`market/ticker.ts`) 1 sn, Redis kilidi `SET market:tick NX PX 900`. Ürünleri kilitler, `nextPrice` uygular, pending sıfırlar, `price_history` yazar, commit sonrası odalara yayınlar.
- Hız sınırı (`security/rateLimit.ts`): emir 5/sn/oyuncu, misafir girişi 5/dk/IP. Redis hatasında emir reddedilir.

## API ve Colyseus (zod şemaları `packages/shared`)
- Para JSON'da kuruş cinsinden string. Kullanıcı adı `^[a-zA-Z0-9_]{3,20}$`.
- `POST /auth/guest {username}` → `{token, playerId, username}`. Ad alınmışsa 409. Tek transaction'da oyuncu, cüzdan, başlangıç parası. Token 32 bayt rastgele, Redis'te `sess:<sha256(token)>`, TTL 7 gün.
- `GET /me` → bakiye ve envanter.
- `GET /market/history?productId=` → son 300 nokta.
- Web `/api/*` isteklerini Next rewrites ile sunucuya yönlendirir.
- `MarketRoom`: `onAuth` token doğrular. State: ürün başına fiyat ve tick. İstemci → `placeOrder {productId, side, quantity, idempotencyKey}`. Sunucu → `orderResult` (hata kodları: `INVALID, UNAUTHORIZED, RATE_LIMITED, UNKNOWN_PRODUCT, INSUFFICIENT_FUNDS, INSUFFICIENT_INVENTORY, IDEMPOTENCY_MISMATCH, INTERNAL`) ve `portfolio`.

## Görevler
- **ekonomi-tasarimci**: `params.ts`, `pricing.ts` (`quoteTrade`, likiditeli `nextPrice`), `economy.test.ts`, `sim/run.ts`, `docs/economy/ilk-surum.md`.
- **backend-dev**: `packages/shared` şemaları; `db/schema.ts` + migration + down; `ledger/transfer.ts`; yeni `market/trade.ts`, `market/ticker.ts`, `auth/session.ts`, `auth/guest.ts`, `security/rateLimit.ts`, `redis.ts`, `http/routes.ts`; `MarketRoom.ts`, `index.ts`, `config.ts`, `.env.example`.
- **frontend-dev**: `next.config.ts` rewrites; `page.tsx`, `LoginForm.tsx`, `Portfolio.tsx`, `OrderForm.tsx` (yeniden denemede aynı anahtar), `PriceChart.tsx` (lightweight-charts), `MarketTicker.tsx`; Tailwind kurulumu. İstemci para hesabı yapmaz.
- **test-qa**: `vitest.config.ts` unit/integration ayrımı, `test:int` betiği, `test/db.ts`. `trade.int.test.ts`: 10 alımlık bakiyeyle 50 paralel alım → tam 10 başarılı; aynı anahtarla 20 paralel istek → 1 trade; paralel satışta envanter negatife düşmez; farklı payload aynı anahtar → mismatch; her testten sonra defter toplamı 0 ve bakiye = defter. `guest.int.test.ts`, `rateLimit.int.test.ts`, `schemas.test.ts`. CI'a postgres:17 ve redis:7 servisleri, `db:migrate`, `test:int`.
- **guvenlik-reviewer**: birleştirmeden önce denetim.

## Riskler
- Round-trip kârı: spread/likidite + özellik testi.
- Başkasının idempotency anahtarı: anahtar oyuncuya kapsamlı.
- Ad ile oturum devralma: mevcut ad reddedilir.
- Çift harcama: FOR UPDATE + CHECK. Çift tick: Redis kilidi + PK.
- Ürün satırı kilidi ürün başına ticareti seri yapar, v1 için kabul.
- Token `localStorage`'da (XSS riski), httpOnly cookie sonraki sürüme.
- Tick ile emir arasında kayma olabilir, gerçekleşen fiyat yanıtta döner.

## Kararlar (öneriler)
1. Sistem hesaplarının `balance` alanı güncellenmez, bakiye defterden türetilir (sıcak nokta kilidini önler).
2. Fiyat etkisi tick bazlı + spread + likidite. Emir içi kayma sonraki sürüm.
3. Ticaret yalnızca Colyseus `placeOrder` ile; iş mantığı `executeTrade` içinde.
