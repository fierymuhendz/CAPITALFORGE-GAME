# Şirket ve üretim

## Amaç
Oyuncu bir şirket kurar, şehir haritasında bir arsaya tesis satın alır, tariflerle hammaddeyi süreli üretimle ürüne çevirip piyasaya satar. Bu, başlangıç hibesi dışındaki ilk sürekli gelir kaynağıdır. Aktif üreticinin serveti büyüyebilmeli, pasif tesis sahibi bakım giderleriyle yavaşça erimeli, parası biten oyuncu asgari ödenekle oyuna dönebilmeli. Her para ve stok hareketi tek transaction içinde, idempotent ve sunucu otoritesinde işlenir.

## Kapsam dışı
3D şehir görseli (veri modeli hazır: şehir, arsa koordinatı, tesis türü, seviye), tesis yükseltme/satma, birden fazla şirket, çalışan/maaş, borç/faiz, enflasyon, oyuncular arası transfer, hisse, BullMQ'ya geçiş.

## Veri modeli (migration `0002_*`, geri alma `drizzle/down/0002_*.sql`)
- `game_clock`: tek satır (`id=1`, `tick bigint`), fiyat tick'iyle aynı transaction'da artar. Üretim süreleri buna göre ölçülür.
- `companies`: `id`, `player_id UNIQUE` (v1'de oyuncu başına bir şirket), `name` (`lower(name)` UNIQUE), `city_id default 'merkez'`, `founded_at`.
- `facilities`: `id`, `company_id`, `type`, `level`, `city_id`, `plot_x`, `plot_y` (sınır CHECK), `status active|suspended`, `purchase_price`, `upkeep_paid_period`, `created_at`. UNIQUE `(city_id, plot_x, plot_y)`: aynı arsa iki kez satılamaz.
- `production_jobs`: `id`, `facility_id`, `player_id`, `recipe_id`, `batches 1..10`, `started_tick`, `completes_at_tick`, `status running|done`, `inputs jsonb`, `output_product_id`, `output_qty >0`, `completed_tick`. Kısmi UNIQUE `(facility_id) WHERE status='running'`: tesiste aynı anda tek iş.
- `player_actions`: ticaret dışı tüm niyetler için genel idempotency tablosu. PK `(player_id, client_key)`, `kind`, `payload_hash`, `result jsonb`.
- `relief_claims`: PK `(player_id, period)`, `amount`, `transfer_id`.
- Seed: `system:fees` hesabı; yeni ürünler `flour` (un) ve `steel` (çelik).

## Ekonomi (`packages/economy`, saf; sayılar simülasyonla kesinleşir, 1 tick = 1 sn)
- Tarifeler:
  - Çiftlik: 1 enerji → 10 buğday, 60 tick
  - Maden: 2 enerji → 5 demir, 90 tick
  - Santral: girdi yok → 20 enerji, 60 tick
  - Değirmen: 10 buğday + 1 enerji → 8 un, 120 tick
  - Çelikhane: 5 demir + 3 enerji → 4 çelik, 180 tick
  - Bir iş `batches` ile çarpılır, süre değişmez.
- `facilityPrice(type, sahipOlunanSayı)`: her yeni tesis daha pahalı (bileşik büyüme), şirket başına en fazla 20 tesis.
- `upkeep(type, level)`: saatlik sabit bakım. Pasif oyuncunun erimesi buradan gelir.
- `companyFoundingFee`: tek seferlik kuruluş ücreti.
- `npcFlow`: her ürün için referans fiyata doğru çeken NPC talep/arzı. Üretilen malın hep alıcısı olur, fiyat sıfıra kaymaz.
- Asgari ödenek: nakit + envanter değeri eşiğin altındaysa ve tesisi yoksa günde bir kez ödeme. Envanter değeri sistemin lehine (`fiyat − spread`) hesaplanır.
- Spread 150 bp + vergi 100 bp önceki simde ağır çıktı; 100/50 veya fiyat adımı 200 bp seçenekleri al-sat kârsızlık testiyle sınanır.
- fast-check özellikleri: tesis fiyatı tekdüze artar; NPC akışı referans fiyatta dengede; NPC akışıyla da fiyat adım sınırı aşılmaz; tarif çıktısı batch ile doğrusal; ödenek istismar döngüsü üretemez.
- Sim hedefleri (`docs/economy/sirket-ve-uretim.md`, 300 oyuncu, 30 oyun günü): aktif üreticinin medyan serveti artar; pasif tesis sahibi günde %0,5–2 erir; yalnızca nakit tutan sabit kalır; kaynak/yutak oranı 0,9–1,15; fiyat endeksi ±%25; Gini < 0,45; ödenek alan oyuncu < %10.

## Para ve stok akışları (`ledger_entries` toplamı 0)
- Kuruluş: `oyuncu −ücret`, `system:fees +ücret`. Anahtar `company:found:<playerId>`.
- Tesis alımı: `oyuncu −fiyat`, `system:fees +fiyat`. Anahtar `facility:buy:<playerId>:<clientKey>`.
- Bakım: `oyuncu −bakım`, `system:fees +bakım`. Anahtar `upkeep:<facilityId>:<dönem>`. Bakiye yetmezse tesis `suspended` olur, borç oluşmaz; sonraki dönemde ödenirse yeniden `active`.
- Ödenek: `system:mint −R`, `oyuncu +R`. Anahtar `relief:<playerId>:<dönem>` ve `relief_claims` PK.
- Üretim başlatma: girdiler envanterden düşer (CHECK ≥ 0), para hareketi yok.
- Üretim tamamlama: çıktı envantere eklenir. Paraya dönüşmesi mevcut satış akışıyla olur; asıl para kaynağı piyasanın üretilmiş malı satın almasıdır.

## Eşzamanlılık ve idempotency
- Kilit sırası: `products` → `companies` → `facilities` → `production_jobs` → oyuncu hesabı → `inventories` (ürün id artan). Ticaret bunun alt kümesi, deadlock yok.
- Ticaret dışı her niyet önce `player_actions`'a yazılır; tekrarda hash farklıysa `IDEMPOTENCY_MISMATCH`, aynıysa kayıtlı sonuç döner.
- `startProduction`: tesis `FOR UPDATE`, durum `active` ve sahibi oyuncu olmalı; girdiler kilitlenip düşülür; kısmi UNIQUE ikinci savunma.
- Tamamlama: tick döngüsünün ikinci fazı, `status='running' AND completes_at_tick <= t` işleri `FOR UPDATE SKIP LOCKED` ile en fazla 500'lük partilerle `done` yapar, envanter aynı transaction'da. İki işçi ya da tekrar eden tick aynı işi iki kez tamamlayamaz. Tamamlayan sunucudur, istemci "topla" demez.
- Bakım fazı: saatte bir, tesis başına küçük transaction, `upkeep_paid_period < dönem` koşulu.
- Hız sınırı: eylem kovası 2/sn/oyuncu, Redis hatasında red.

## API ve Colyseus (zod şemaları `packages/shared`)
- HTTP: `GET /catalog` (tarifeler, tesis türleri, oyuncuya özel tesis fiyatı, bakım), `GET /company` (şirket, tesisler, işler, sunucu tick'i), `GET /city?cityId=` (herkese açık arsa listesi; ileride 3D görünüm bunu kullanacak).
- İstemci → sunucu (hepsinde `idempotencyKey`, `.strict()`): `foundCompany {name}`, `buyFacility {type, plotX, plotY}`, `startProduction {facilityId, recipeId, batches 1..10}`, `claimRelief {}`.
- Sunucu → istemci: `actionResult` (hata kodları: INVALID, UNAUTHORIZED, RATE_LIMITED, NO_COMPANY, COMPANY_EXISTS, NAME_TAKEN, PLOT_TAKEN, FACILITY_LIMIT, FACILITY_BUSY, FACILITY_SUSPENDED, UNKNOWN_RECIPE, RECIPE_FACILITY_MISMATCH, INSUFFICIENT_FUNDS, INSUFFICIENT_INVENTORY, NOT_ELIGIBLE, IDEMPOTENCY_MISMATCH, INTERNAL), `company`, `portfolio`, `jobCompleted`. Tick yayınına `clockTick` eklenir; ilerleme çubuğu istemci saatine güvenmez.

## Görevler
- **ekonomi-tasarimci**: `params.ts`, yeni `recipes.ts`, `production.ts`, `relief.ts`, `pricing.ts` (`npcFlow`), özellik testleri, `sim/run.ts` (aktif üretici, pasif üretici, tüccar, nakit tutucu), `docs/economy/sirket-ve-uretim.md`.
- **backend-dev**: shared şemaları; `db/schema.ts`, 0002 migration + down + seed; `actions/idempotency.ts`, `company/found.ts`, `company/buyFacility.ts`, `production/start.ts`, `production/complete.ts`, `production/upkeep.ts`, `relief/claim.ts`; `market/ticker.ts` fazları; `MarketRoom.ts`; `/catalog`, `/company`, `/city`; eylem hız sınırı.
- **frontend-dev**: `CompanyPanel`, `CityGrid` (2D arsa seçici, aynı `/city` verisi), `FacilityList` (sunucu tick'iyle ilerleme), `ProductionForm`, `ReliefButton`, 5 ürünlü ticker ve grafik. Değerler `/catalog`'dan; istemci hesap yapmaz.
- **test-qa**: aynı tesise 20 paralel başlatma → 1 iş; tek işlik girdiyle 10 paralel başlatma → 1 başarı; iki paralel tamamlama + tekrar tick → çıktı bir kez; aynı arsaya 10 paralel alım → 1 başarı; tesis limiti; bakım aynı dönem iki kez → tek kesinti, yetmezse `suspended` ve bakiye ≥ 0; ödenek dönem başına bir kez; her testten sonra defter toplamı 0 ve bakiye = defter; şema testleri.
- **guvenlik-reviewer**: ödenek istismarı, başkasının tesisinde üretim, arsa yarışı.

## Riskler
- Çoklu misafir hesapla ödenek/hibe toplama: oyuncular arası transfer yok, ödenek tesisi olmayan ve eşik altındakiyle sınırlı, giriş hız sınırı sürüyor; sim ve izleme ile takip.
- Kaynak yutaktan büyük çıkarsa enflasyon: NPC akışı, artan tesis fiyatı ve bakım dengeler.
- Girdisiz santral bedava enerji üretir: bakım ve süreyle sınırlı, fazla enerji fiyatı düşürür.
- Tamamlama birikmesi: 500'lük partiler, faz süreleri loglanır.

## Kararlar (öneriler)
1. Pasif erime: tesis başına saatlik bakım (alternatif: nakit servet vergisi).
2. v1'de oyuncu başına bir şirket.
3. İflas kurtarma: koşullu, günde bir kez asgari ödenek (alternatif: tek seferlik "yeniden başla").
