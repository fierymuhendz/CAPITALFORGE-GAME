# v2 sunucu modülleri: iş bölümü ve para akışları

Önce oku: `docs/plans/v2-oyun-tasarimi.md`, `packages/shared/src/api.ts` (yanıt tipleri), `packages/shared/src/schemas.ts` (istekler),
`apps/server/src/http/route.ts`, `ledger/post.ts`, `inventory/holdings.ts`, `company/found.ts` (örnek akış), `test/harness.ts`, `test/invariants.ts`.

Genel kurallar
- Uçlar öneksizdir (`/production/start`); istemci `/api/production/start` çağırır.
- Değiştiren uç: `kind: "mutation"`, gövdede `idempotencyKey`. İşlem içindeki her `post()` çağrısının idempotencyKey'i olaydan türetilir (ör. `prod-start:${jobId}`), istek anahtarından değil; tekrar isteği zaten route düzeyinde yakalanır.
- Para tutarları API'de metin (`m(bigint)`), miktarlar kg sayı.
- Her mutation sonunda `uow.invalidate(companyId, ...topics)`; harita değişiyorsa `uow.world("map")`.
- Bildirim: `notify(tx, uow, companyId, kind, params, now, link)`. `kind` istemcide `notifications.<kind>` çevirisidir; yeni kind eklersen `docs/plans/v2-bildirimler.md` listesine yaz (arayüz ekibi çevirir).
- Zamanlayıcı görevi: `registerTask({ name, everyMs, run(deps, now) })`, modülün `register*Tasks()` fonksiyonunda; `http/modules.ts` içindeki `registerTasks()` bunu çağırır.
- Şehir sektör çarpanı: tarla `fertilityBp` × 10000 (şehir verimi arsaya zaten dahil), ahır `pastureBp` × 10000, maden `depositRichnessBp` × `city.sectorYieldBp.mining`, fabrika 10000 × `city.sectorYieldBp.manufacturing`.
- XP: `addXp(tx, companyId, amount, settings.levelXp)` (company/found.ts).

## Modül A — üretim, tesis, araştırma, finans, şirket (backend-dev A)
Klasörler: `src/production`, `src/facilities`, `src/research`, `src/finance`, `src/company` (found.ts hariç), `src/inventory/routes.ts`, `src/notifications`.

Uçlar
- `GET /company` → `CompanyDto` (tesisler, araçlar, araştırma, 7 günlük gelir/kâr, `nextSteps` önerileri: ilk iş, ilk satış, depo boş, kredi, yükseltme vb.)
- `GET /companies/:id` (herkese açık profil: ad, sektör, şehir, seviye, itibar), `GET /companies/search?q=`
- `POST /account/dissolve` (`DissolveReq`): şirketi kapat. Açık emir/sözleşme/iş varsa önce iptal kurallarını uygula (sözleşme iptal cezası), arsa serbest, tesis `demolished`, araçlar `sold`, stok ve nakit sisteme devredilir (defterde `exp_other`/`equity` ile kapanış). Geçmiş kayıtlar silinmez.
- `GET /facilities`, `GET /facilities/:id` (`FacilityDto`)
- `POST /production/quote` → `ProductionQuoteDto` (girdiler, mevcut stok, çıktı, kalite, süre, maliyet kırılımı, birim maliyet, en iyi alıcılar)
- `POST /production/start` → iş. `POST /production/:id/stop-repeat`
- `POST /plots/:plotId/buy` (`BuyPlotReq`: buildingType): seviye ve nakit ayrı ayrı denetlenir, çelik `buildSteelKg` binanın şehrindeki depodan düşer, inşaat `buildMinutes` sürer.
- `POST /facilities/:id/upgrade`, `POST /facilities/:id/quality`
- `GET /research`, `POST /research/:id/start`
- `GET /inventory` → `HoldingDto[]`, `GET /inventory/movements?productId=&cityId=&quality=` → `MovementDto[]`
- `GET /finance` → `FinanceDto`, `GET /finance/ledger?before=` → `LedgerLineDto[]`, `GET /finance/sales` → `SaleDto[]`, `GET /finance/sales/:id` (iz: sözleşme, sevkiyat, defter işlemleri ve satırları)
- `POST /finance/loans` (`LoanReq`), `POST /finance/loans/:id/repay` (`RepayReq`), `POST /finance/arrears/pay`
- `GET /notifications`, `POST /notifications/read`

Para akışları (satırlar şirket içinde dengeli)
- Üretim başlangıcı: girdiler `removeStock` (WAC) → `wip +girdiMaliyeti`, `inventory −girdiMaliyeti`; enerji+su+ücret → `wip +E`, `cash −E`. Kilit: tesis satırı FOR UPDATE, boş hat ve parti kapasitesi denetimi. `arrears` borcu varsa `ARREARS_OUTSTANDING`.
- Üretim bitişi (görev, `production_jobs.status running→completed`): `inventory +toplam`, `wip −toplam`; `addStock` çıktı (kalite, maliyet kırılımı). Tekrar modunda yeni iş aynı tarifin işin BAŞLANGIÇ anlık görüntüsüyle değil, katalogdaki güncel tarifle başlar; girdi veya nakit yoksa `stalledReason` yazılır ve bildirim gider.
- Arsa: `fixed_assets +P`, `cash −P`. İnşaat: `fixed_assets +C`, `cash −C`; çelik: `removeStock` → `fixed_assets +çelikMaliyeti`, `inventory −çelikMaliyeti`.
- Yükseltme ve kalite iyileştirme: aynı (fixed_assets). Bitiş görevi seviyeyi artırır.
- Araştırma: `exp_research +C`, `cash −C`; bitiş görevi seviyeyi artırır.
- Kredi kullanımı: `cash +P`, `loans −P`. Taksit (görev, `next_due_at`): `loans +anapara`, `exp_interest +faiz`, `cash −(anapara+faiz)`. Nakit yetmezse: ödenebilen kısmı öde, kalanı `arrears` (`exp_interest +x`/`arrears −x` faiz için; anapara için `loans +y`/`arrears −y`) ve gecikme ücreti (`exp_penalties`). Erken ödeme: tahakkuk faizi + anapara.
- Günlük bakım (görev, `companies.next_upkeep_at`): bina seviyesi `upkeepPerDay` + araç `upkeepPerDay` → `exp_upkeep +U`, `cash −U`; yetmezse kalan `arrears`. `arrears` > 0 iken şirketin her nakit girişinden sonra `settleArrears(tx, companyId)` çağrılabilir (A modülü sağlar, B modülü satış ve teslim sonrası çağırır).
- Net değer (snapshot, saatlik): nakit + stok + wip + escrow + prepaid_freight + fixed_assets − loans − arrears.

## Modül B — piyasa, sözleşme, lojistik, sistem şirketleri (backend-dev B)
Klasörler: `src/market`, `src/contracts`, `src/logistics`, `src/system`.

Uçlar
- `GET /market?cityId=&productId=` → `MarketDto`; `GET /market/overview` → `MarketOverviewDto`; `GET /market/history?cityId=&productId=`
- `POST /market/listings` (stok rezerve), `POST /market/orders` (bedel `escrow`'a), `POST /market/listings/:id/buy`, `POST /market/orders/:id/sell`, `POST /market/listings/:id/cancel`, `POST /market/orders/:id/cancel`
- `GET /contracts?scope=board|mine`, `GET /contracts/:id` → `ContractDetailDto`, `POST /contracts`, `POST /contracts/:id/accept|decline|withdraw|cancel`, `POST /contracts/installments/:id/deliver`
- `GET /fleet`, `POST /fleet/buy` (`BuyVehicleReq`), `POST /shipments` (kendi aracı; boş yük = konum değiştirme), `GET /shipments?scope=mine`, `GET /shipments/:id`
- `GET /freight-jobs?scope=board|mine`, `POST /freight-jobs`, `POST /freight-jobs/:id/accept`, `POST /freight-jobs/:id/cancel`
- `GET /freight/quote?originCityId=&destCityId=&kg=&modelId=` (sistem taşımacısı fiyatı + kendi aracınla tahmini maliyet ve süre)

Para akışları
- Anlık satış (alıcı ilandan alır): satıcı `removeStock(fromReserved)` → `cogs +c`, `inventory −c`; alıcı `addStock(maliyet = brüt)` → `inventory +brüt`, `cash −brüt`; satıcı `cash +(brüt − komisyon)`, `exp_fees +komisyon`, `revenue_sales −brüt`. `sales` satırı: brüt, SMM, navlun 0, ücret, net kâr. `trades` satırı.
- Alım emri: açılışta `escrow +B`, `cash −B` (B = miktar × azami fiyat). Satıcı doldurunca emanetten ödenir: `escrow −brüt` (alıcı), stok alıcıya; artan emanet emir kapanınca iade.
- Sözleşme kabulü: alıcı `escrow +V`, `cash −V`; satıcı `escrow +D`, `cash −D`. Koşullar `terms` JSON'a yazılır, taksitler oluşturulur.
- Teslim (elle veya sözleşmeye bağlı sevkiyat varışında): satıcı stoktan çıkar (`cogs`/`inventory`), alıcı `addStock(maliyet = brüt)`, alıcı `inventory +brüt`, `escrow −brüt`; satıcı `cash +net`, `revenue_sales −brüt`, geç ise `exp_penalties +gecikme`, alıcı `cash +gecikme`, `revenue_other −gecikme`. Satıcının ödediği navlun bu teslime düşen pay kadar `exp_freight` olarak satış kaydına yazılır.
- Taksit kapanışı (görev, `grace_ends_at`): eksik bedel alıcıya (`escrow −`, `cash +`), ceza teminattan (`satıcı escrow −p`, `exp_penalties +p`; alıcı `cash +p`, `revenue_other −p`), kalan teminat payı satıcıya (`escrow −`, `cash +`). İtibar: tam ve zamanında → `on_time_deliveries++`, değilse `late_or_missed++`.
- İptal: `cancellationPenalty` (economy) ile.
- Kendi aracıyla sevkiyat kalkışı: yakıt + sürücü → `prepaid_freight +T`, `cash −T`; yük `removeStock` → yoldaki yük `shipment_cargo.cost_basis` (defterde `inventory` hesabında kalır; invariants yoldaki yükü sayar). Varış: navlun payı transfer ise yükün maliyetine eklenir (`inventory +pay`, `prepaid_freight −pay`), sözleşme teslimi ise `exp_freight +pay`, `prepaid_freight −pay`. Konum değiştirme (boş): `exp_fleet` (taşımacının işletme gideri).
- Taşıma işi: açılışta yük sahibi `escrow +ücret`, `cash −ücret`, yük rezerve. Kabulde yük `removeStock(fromReserved)`, sevkiyat başlar; taşımacı yakıt+sürücü → `exp_fleet +T`, `cash −T`. Varışta: taşımacı `cash +ücret`, `revenue_freight −ücret`; yük sahibi `escrow −ücret` ve karşılığı yükün maliyetine (transfer) veya `exp_freight` (sözleşme teslimi). Teslim kanıtı `shipments.proof` (alıcı, satırlar, zaman, sha256).
- Süresi geçen açık iş: emanet iade, rezerv serbest.
- Sistem şirketleri (görev, saatlik): stok yenileme (sistem satıcı stoğu `inventory +maliyet`, `equity −maliyet` = sistem üretimi), alım emirleri ve ilanlar (bütçe ve kapasite sınırlı, `system_daily`), sahipsiz ilan/emir/taşıma işi tespiti, oyuncu payına göre küçülme, tekrarlayan sistem alım sözleşmeleri, sistem taşıma işleri (taşımacılar için gelir). Sistem alış fiyatı `systemBid(..., cap)` (cap = ürünün en düşük taban sistem satış fiyatının %80'i).
- Referans fiyat güncelleme (görev, saatlik): `nextDriftBp`, `price_history`.

## Modül C — yönetim ve adil oyun (backend-dev C)
Klasörler: `src/admin`, `src/fairplay`.

Uçlar (hepsi `auth: "admin"`; IP grupları ayrıca `can_review_connections`)
- `GET /admin/overview` → `AdminProductMetricsDto` (ürün × şehir: stok, açık ilan/emir, alıcı bulma süresi, ref, 24s VWAP, hacim, sistem payı, 24s fiyat değişimi)
- `GET /admin/products/:productId?cityId=` (kırılım: şirket bazında stok, son işlemler)
- `GET /admin/search?q=` (hesap ve şirket), `GET /admin/companies/:id` (özet, defter, satışlar, stok, tesis durumları)
- `GET /admin/alerts?kind=` → `AdminAlertDto[]`; `POST /admin/alerts/:id/ack`
- `GET /admin/connections` → `AdminConnectionGroupDto[]`; `GET /admin/connections/:groupId` → `AdminReviewDto` (aynı karma IP'yi paylaşan hesaplar arasındaki anlık işlemler, teklifler, sözleşmeler, taşıma işleri, değer transferleri; anomali bilgisiyle). Her erişim `admin_audit_log`'a yazılır. Grup kimliği IP karmasının kendisi DEĞİL, ondan türetilmiş kısa kimliktir; yanıt asla karma veya IP içermez.
- `GET/POST /admin/cases`, `POST /admin/cases/:id/notes`, `POST /admin/cases/:id/close`, `POST /admin/cases/:id/enforce` (hesap dondurma/çözme, işlemi `reverse()` ile ters kayıt, ilan/sözleşme iptali). Hepsi denetim kaydında.
- `GET /admin/catalog`, `PATCH /admin/catalog/recipes/:id`, `PATCH /admin/catalog/products/:id`, `PATCH /admin/settings` (`AdminSettingReq`), `GET /admin/audit`: değişiklik `catalog_history` + `admin_audit_log` (önce/sonra, gerekçe, etkilenen kayıt sayısı: ör. bu tarifi kullanan çalışan iş sayısı — çalışan işler ve kabul edilmiş sözleşmeler kendi anlık görüntüleriyle devam eder). Sonra `deps.catalog.reload`.
- `POST /admin/accounts/:id/reset-password` (`AdminResetPasswordReq`)
- `POST /admin/time/advance` (`AdminTimeReq`, yalnızca `config.allowTimeTravel`)

Görevler
- Fiyat sapması (her 5 dk): yeni `trades` ve kabul edilen sözleşmeler için `priceAnomaly` (kalite 2'ye normalize, teslim şehri, 72 saat). |sapma| ≥ eşik → `alerts(kind=price_anomaly)`, yetersiz veride `details.insufficientData=true`.
- Kıtlık (açık alım emri var, ilan yok, 6 saat), stok fazlası (stok > 7 günlük hacim × 3), servet sıçraması (24 saatte net değer +%300 ve > ₺200.000), fiyat sıçraması (ref 24 saatte ±%40), taşımacısız iş (2 saat), girdi eksikliğinden duran hat.
- IP kaydı temizliği (günlük): `ipRetentionDays` öncesi `connection_records` silinir.
- Şirket snapshot'ı (saatlik) A modülünde; C okur.
