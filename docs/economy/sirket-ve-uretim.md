# Şirket ve üretim: parametreler ve simülasyon

Plan: `docs/plans/sirket-ve-uretim.md`. Önceki sim: `docs/economy/ilk-surum.md`.
Parametreler: `packages/economy/src/params.ts`. Çalıştırma: `pnpm sim` (env: `SIM_PLAYERS` 300, `SIM_DAYS` 30, `SIM_SEED` 42, `SIM_ATTENTION` 120).

## Değişen / yeni parametreler (kuruş)
| Parametre | Eski | Yeni | Not |
|---|---|---|---|
| startingBalance | 1.000.000 | 10.000.000 | Ürün birim fiyatı >= 500 kuruş olmak zorunda (aşağıda), 10 batch'lik iş 450-1000 TL; eski hibe bir iş bile taşımıyordu |
| spreadBps / transactionTaxBps | 150 / 100 | 150 / 50 | Spread 150 kalır (pump-and-dump marjı için), vergi 100→50; round-trip ve çok tick'li pump testleri geçiyor |
| maxPlayerVolumePerWindow / volumeWindowTicks | - | 2000 adet / 3600 tick | Oyuncu başına ÜRÜN başına kayan pencere, alım+satım toplamı; `volumeAllowed(used, qty)`. 20 tesisli meşru üretici saatte ~2000 birim |
| maxPriceStepBps | 300 | 300 | Değişmedi |
| liquidity | 1000 | 100 | 1000'de 500 kuruşluk fiyat hareket edemiyordu (ölü bölge) |
| companyFoundingFee | - | 500.000 | |
| facilityBasePrice | - | farm 5.0M, mine 2.5M, power_plant 5.0M, mill 2.0M, steelworks 1.75M | ~12 gün geri ödeme hedefi (günde 12 iş) |
| facilityGrowthBps | - | 2000 (+%20 / tesis) | 20. tesis ~38x taban |
| upkeepBase (saat) | - | farm 2000, mine 1000, power_plant 2000, mill 800, steelworks 700 | Pasif farm sahibi günde ~%1,3 erir |
| reliefThreshold / Amount / Cooldown | - | 1.5M / 400k / 86400 | Tutar < eşik < en ucuz tesis |
| refPrice = initialPrice | - | wheat 500, iron 600, energy 500, flour 900, steel 1500 | Zincir marjı tarif başına %20-30 |
| npcBase (tick) | - | wheat 50, iron 40, energy 50, flour 40, steel 40 | |
| npcSlopeBps | - | 30000 | %1 sapma, base'in %3'ü kadar net akış |

Zincir (ref fiyat, sürtünme öncesi): farm 1 enerji 500 -> 10 buğday 5000; mine 1000 -> 5x600=3000; mill 5500 -> 8x900=7200; steelworks 4500 -> 4x1500=6000. Santral çıktısı 20→10 enerji (girdisiz), iş başına (10 batch) 50.000 kuruş, farm ile aynı seviye.

## Yöntem
300 oyuncu, 30 gün, 1 tick = 1 sn. Oyuncu kararı dakikada bir (60 tick), fiyat HER tick güncellenir; her işlem adım içinde rastgele bir tick'e düşer, NPC akışı eklenir. Tipler (300 oyuncu): aktif üretici 120 (farm 44, mine 16, santral 16, değirmen 28, çelikhane 16; ortalama 2 saatte bir döner: sat, iş başlat, genişle; tesis sayısı 20'ye kadar), pasif farm sahibi 30, tüccar 45, kumarbaz 15 (%5, tüm bakiyeyi bir ürüne yatırıp sonraki dönüşte satar, ödenek testi), nakit tutucu 90. Üretici fiyat < ref %90 ise satmaz. Defter denetimi: mint = nakit + market net + vergi + ücretler (dengeli).
Servet = nakit + envanter (sistem lehine). "Tesis dahil" = servet + tesis alış bedeli. Kaynak = satış geliri + ödenek; yutak = alım harcaması + ücret/bakım (vergi ve spread fiyatın içinde).

## Sonuç (seed 42, 300 oyuncu, 30 gün; hacim sınırı, santral 10, hasActiveFacility sonrası)
| Hedef | Ölçüm | Durum |
|---|---|---|
| Aktif üretici medyan serveti artar | 70.000 -> 98.553 TL (kurulum sonrası), tesis dahil ~3x | Tuttu |
| Pasif tesis sahibi günde %0,5-2 erir | %1,28/gün | Tuttu |
| Yalnız nakit tutan sabit | 100.000 -> 100.000 TL | Tuttu |
| Kaynak/yutak 0,9-1,15 | 1,028 (nakit arzı +%14,5) | Tuttu |
| Fiyat endeksi ±%25 | 0,962 / 1,033 | Tuttu |
| Gini < 0,45 | 0,219 (nakit+envanter), 0,347 (tesis dahil) | Tuttu |
| Ödenek alan < %10 | %5 (yalnız kumarbazlar) | Tuttu |

Duyarlılık: seed 7: kaynak/yutak 1,030, arz +%16,0, endeks 0,963-1,025, Gini 0,224/0,348. Dikkat 60 dk (saatte bir dönen): kaynak/yutak 1,076, arz +%87,7, Gini 0,383/0,577 (tesis dahil Gini HEDEF TUTMADI; santral 10'a inince önceki +%124'ten düştü).
Sim hacim sınırını uygulamaz (meşru hacim zaten altında); sınırın etkisi `pumpProfit` testleriyle kanıtlanır.

## Pump-and-dump kapatıldı
Saldırgan modeli `packages/economy/src/pump.ts` (`pumpProfit`): n tick'te her tick sınırın izin verdiği kadar al, bekle, sonra sınır elverdikçe sat; NPC akışı dahil. Sınırsız: 73 kârlı desen (örn. energy q=1000, 20 tick: +%24,8). M=2000/spread 100 ile hâlâ kârlı desen çıktı (bekleme = pencere, fiyat ölü bölgede yüksek kalıyor, tek tick etkisi ~%2,85 ≈ sürtünme). Çözüm: spread 150 (gidiş-dönüş ~%4 > tek tick etkisi). Testler: tüm ürün x miktar x süre x bekleme ızgarası + fast-check (300 koşu testte, 3x1500 koşu elle) hepsi kâr <= 0. M ile kârsızlık tekdüze değil (M=4000'de kâr var), bu yüzden M/spread değiştirilirse test yeniden koşulmalı. Not: backend pencere toplamını (son 3600 tick, ürün başına, alım+satım) tutup her emirde `volumeAllowed` çağırmalı.

## Bulgular
- Gelir üretici aktifliğiyle doğrusal artıyor. Saatte bir dönen oyuncu nüfusunda para arzı ayda %124 büyüyor ve Gini hedefi tutmuyor. Ayarlanabilir sinyal yalnız bakım ve tesis fiyat büyümesi, ikisi de sınırlı.
- Fiyat tam sayı kuruş ve `nextPrice` sıfıra doğru kestiği için düşük fiyatlarda ölü bölge var: fiyat 500 iken adım >= 1 kuruş olması için imbalans >= 20 bp gerekir. NPC tek başına ref'e ~%5'e kadar yaklaşır, test %10 tolerans kullanıyor.
- NPC akışı tam sayı ve tick başına; en küçük birim 1 birim/tick (86.400 birim/gün). Bu 300 oyuncuya göre büyük, yani NPC "alıcı garantisi" olarak çalışıyor ama üretimi fiyatla sınırlamıyor. Üretilen mal ref'in %90'ı üstünde hep satılıyor; gelir sınırı fiyat değil, aktiflik ve tesis sayısı.
- Santral çıktısı 10 enerjiye indi: iş başına 50.000 kuruş, farm ile aynı seviye, fiyat 5,0M. Sim sonuçlarında santral medyan serveti (138k TL) diğerlerine yakın.

## AÇIK KONULAR
- Backend: pencere hacmi takibi ve `volumeAllowed` çağrısı yazılmalı (Redis/DB, oyuncu x ürün). `reliefEligible` alanı `hasActiveFacility` oldu (`apps/server/src/relief/claim.ts` güncellenmeli).
- startingBalance 10M kuruş; arayüz metinleri ve 0002 seed (`initialPrice`: wheat 500, iron 600, energy 500, flour 900, steel 1500) güncellenmeli.
- Aktiflik duyarlılığı: saatte bir dönen nüfusta tesis dahil Gini 0,577. Öneri: bakım tesis sayısıyla artsın veya facilityGrowthBps 2500-3000.
- Düşük fiyatta tam sayı ölü bölgesi (NPC ref'e en fazla ~%5 yaklaşır); yeni ürün fiyatı >= 500 kuruş olmalı.
- Ödenek: kumarbazlar 30 günde ~15'er kez aldı (toplam 1,29M TL). Çoklu misafir hesap riski için hesap açma ve hız sınırı şart. Artık askıdaki tesis sahibi de alabilir; tesisini bırakmadan ödenek döngüsü ölçülen servet kuralıyla sınırlı (test var).

---

# Ortak piyasa havuzu (yeni yön, bu bölüm yukarıdaki NPC/hacim sınırı bölümlerinin yerine geçer)

Karar bekliyor (kullanıcı onayı), uygulama `packages/economy/src/pool.ts` içinde hazır ve testli.

## Mekanizma
Ürün başına TEK ortak havuz (sabit çarpımlı AMM): durum `{ units, value }`, fiyat = `value / units`. Alım units'i azaltıp value'yu artırır (fiyat yükselir), satım tersi; etki ANINDA ve KALICI, aynı tick'teki sonraki emir yeni fiyatı görür. Büyük emir emir içinde kayar (ortalama fiyat bozulur). Yol bağımsızdır: al-sat aynı miktarla havuza kâr bırakmaz, spread + vergi round-trip'i her zaman zarara çevirir. Yenilenme: her tick units hedef derinliğe (`poolDepth`), value hedef değere (`poolDepth x refPrice`) geometrik yaklaşır (`poolReplenishPpm`), hedefi aşmaz ve işlemi yapanın aleyhine çalışır. Toplam para girişi ürün başına yenilenme hızıyla tavanlıdır: oyuncu/bot sayısından bağımsız. Fazla satan fiyatı düşürür, gelirini kendisi ve diğerleri paylaşır (ortak kaynak).
- `executeAgainstPool(side, pool, qty) -> { unitPrice (ortalama), gross, tax, playerDelta, newPool, newPrice }`. Alımda havuz bedeli ve brüt yukarı, satımda gelir ve brüt aşağı yuvarlanır. `qty <= poolMaxOrder(pool)` (rezervin %10'u) değilse RangeError. Büyük işlem emirlere bölünerek yapılır.
- `replenish(pool, productId, ticks)`, `initialPool(productId)`, `poolPrice(pool)`, `poolMaxOrder(pool)`.
- `quoteTrade`/`nextPrice`/`npcFlow` eski haliyle duruyor (geriye uyumluluk), yeni akışta kullanılmamalı. `volumeAllowed` gevşek güvenlik ağı: `maxPlayerVolumePerWindow` 50.000.

## Parametreler (kuruş)
| Parametre | Değer |
|---|---|
| poolDepth (birim) | wheat 14000, iron 7000, energy 7000, flour 9000, steel 3500 |
| poolReplenishPpm | 150 (zaman sabiti ~1,8 saat) |
| poolMaxOrderBps | 1000 |
| spread / vergi | 150 / 50 bp |
| refPrice = initialPrice | wheat 560, iron 2300, energy 4000, flour 1650, steel 7600 (zincir marjı ~%25-30) |
| Tarifler | santral çıktısı 4 enerji; süreler: farm 3600, mine 5400, santral 28800, mill 7200, steelworks 14400 tick |
| facilityBasePrice | farm 1.8M, mine 2.2M, power_plant 2.5M, mill 1.8M, steelworks 2.4M |
| upkeepBase (saat) | farm 1800, mine 2200, power_plant 2100, mill 1800, steelworks 2300 |

Süreler uzatıldı: havuz fiyatı sınırlasa da bot tesisten tesis başına en fazla `10 batch / süre` üretebilir; kısa süre (60 sn) botu fiilen sınırsız yapıyordu.

## Sim (300 oyuncu, 30 gün, tek tesis/oyuncu; bot = her dakika dönen, kâr maksimize eden tam otomasyon)
| Bot % | Kaynak/yutak | Endeks min/maks | Gini (tesis dahil) | Meşru üretici günlük | Bot günlük | Nakit arzı |
|---|---|---|---|---|---|---|
| 0 | 1,087 | 0,858 / 1,174 | 0,181 | +%1,14 | - | +%13 |
| 10 (seed 42) | 1,111 | 0,838 / 1,183 | 0,210 | +%0,73 | +%2,16 | +%19 |
| 10 (seed 7) | 1,111 | 0,833 / 1,211 | 0,210 | +%0,75 | +%2,17 | +%20 |
| 20 | 1,128 | 0,812 / 1,216 | 0,228 | +%0,47 | +%1,49 | +%25 |
| 30 | 1,145 | 0,793 / 1,240 | 0,239 | +%0,29 | +%1,19 | +%31 |
Pasif farm sahibi günde %0,61 erir; nakit tutan sabit; ödenek alan %5. Tüm hedefler tuttu.

Tesis sayısı (herkes N tesisle başlar, bot %10): N=1: kaynak/yutak 1,111, bot +%2,16/gün; N=2: 1,182, +%3,33; N=3: 1,237 (hedef AŞILDI), +%6,74. Meşru üretici günlüğü 0,73 -> 0,64 -> 0,42 (kapasite paylaşıldığı için azalan verim); toplam gelir artar ama sermaye ve bakım nedeniyle tesis dahil servet payı düşer.

Pump-and-dump: `pumpProfit` (havuz + yenilenme) ve rastgele al/sat/bekle dizileri + tasfiye (fast-check) net kâr <= 0.

## Backend'in yapması gerekenler
1. `products` satırına `pool_units bigint NOT NULL`, `pool_value bigint NOT NULL` (CHECK >= 1) ekle; `price` sütunu `poolPrice(pool)` ile türetilmiş görüntü olarak kalsın (her işlemde ve her tick'te güncellenir). `pending_demand`, `pending_supply` ve `nextPrice`/`npcFlow` kullanımı kalkar.
2. Seed/migration: yeni ürünlerde ve mevcutlarda `pool_units = PARAMS.poolDepth[id]`, `pool_value = poolDepth * initialPrice[id]` (`initialPool(id)`). Mevcut ürün fiyatları yeni `initialPrice` değerlerine çekilmeli.
3. `trade.ts`: ürün satırı `FOR UPDATE` ile kilitlenip `{units: pool_units, value: pool_value}` okunur; `const r = executeAgainstPool(side, pool, quantity)`; defter bacakları `r.gross` ve `r.tax` ile (şimdiki şekil aynı); satırı `pool_units = r.newPool.units, pool_value = r.newPool.value, price = r.newPrice` ile güncelle. `quantity > poolMaxOrder(pool)` ise yeni hata kodu (örn. ORDER_TOO_LARGE; istemci emri bölsün) döndür. İşlem kaydındaki `unitPrice` = `r.unitPrice`.
4. `ticker.ts`: her tick (kilit altında) `pool = replenish(pool, id, 1n)` ve `price = poolPrice(pool)` yaz; tick kaçırılırsa `ticks = tick - ürün.tick` ile tek çağrı. `volumeAllowed` kontrolü isteğe bağlı güvenlik ağı olarak kalabilir.
5. Tarifler/süreler değişti (`RECIPES`); arayüz metinleri ve `/catalog` değerleri `RECIPES`'ten okunmalı.

## AÇIK KONULAR (havuz)
- Ortak kaynak: bot sayısı arttıkça meşru oyuncunun getirisi düşer (%30 botta +%0,29/gün), ama pozitif ve toplam para tavanlı. Bot oranı izlenmeli.
- Çok tesisli oyuncular (N>=3) kaynak/yutak hedefini aşıyor; tesis fiyat büyümesi (`facilityGrowthBps` 2000) 2500-3000'e çıkarılabilir veya bakım tesis sayısıyla artırılabilir.
- Santral hâlâ en kârlı tür (~%3/gün meşru). Enerji derinliği/santral çıktısı ile oynanabilir, sim sonucu santral oranına (burada %40 üretici) duyarlı.
- Tekil ürünlerde geçici sapma büyük (steel maks 1,6x, wheat 0,74x); endeks ortalaması ±%25 içinde. Gerekirse `poolReplenishPpm` artırılır (kapasite de artar).
- Ödenek istismarı için çoklu hesap riski sürüyor.
