# Şirket ve üretim: ekonomi parametreleri ve simülasyon

Plan: `docs/plans/sirket-ve-uretim.md`. Önceki sim: `docs/economy/ilk-surum.md`.
Parametreler: `packages/economy/src/params.ts`. Sim: `pnpm sim` (env: `SIM_PLAYERS` 300, `SIM_DAYS` 30, `SIM_SEED` 42, `SIM_ATTENTION` 120 dk, `SIM_BOT_PCT` 10, `SIM_START_FAC` 1, `SIM_FAC_SHARE` 50).

## Ortak piyasa havuzu
Ürün başına TEK ortak havuz (sabit çarpımlı AMM): durum `{ units, value }`, fiyat = `value / units`. Alım units'i azaltıp value'yu artırır (fiyat yükselir), satım tersi; etki ANINDA ve KALICI, aynı tick'teki sonraki emir yeni fiyatı görür. Büyük emir emir içinde kayar. Yol bağımsızdır: al-sat aynı miktarla havuza kâr bırakmaz, spread + vergi round-trip'i zarara çevirir. Yenilenme: her tick units hedef derinliğe (`poolDepth`), value hedef değere (`poolDepth x refPrice`) geometrik yaklaşır (`poolReplenishPpm`), hedefi aşmaz ve işlemi yapanın aleyhine çalışır. Para girişi ürün başına yenilenme hızıyla tavanlıdır, oyuncu/bot sayısından bağımsızdır; fazla satan fiyatı düşürür, gelir paylaşılır (ortak kaynak).
- `executeAgainstPool(side, pool, qty) -> { unitPrice (ortalama), gross, tax, playerDelta, newPool, newPrice }`. Alımda havuz bedeli ve brüt yukarı, satımda gelir ve brüt aşağı yuvarlanır. `qty <= poolMaxOrder(pool)` (rezervin %10'u) değilse RangeError; büyük işlem emirlere bölünür.
- `replenish(pool, productId, ticks)`, `initialPool(productId)`, `poolPrice(pool)`, `poolMaxOrder(pool)`.
- Eski `quoteTrade`/`nextPrice`/`npcFlow` geriye uyumluluk için duruyor, yeni akışta kullanılmaz. `volumeAllowed` gevşek güvenlik ağı (`maxPlayerVolumePerWindow` 50.000).

## Parametreler (kuruş)
| Parametre | Değer |
|---|---|
| startingBalance | 10.000.000 (birim fiyat/iş büyüklüğü ölçeği) |
| spread / vergi | 150 / 50 bp |
| poolDepth (birim) | wheat 84000, iron 42000, energy 42000, flour 54000, steel 21000 |
| poolReplenishPpm / poolMaxOrderBps | 150 (zaman sabiti ~1,8 saat) / 1000 |
| refPrice = initialPrice | wheat 560, iron 2300, energy 4000, flour 1650, steel 7600 (zincir marjı ~%25-30) |
| Tarifler | farm 1 enerji -> 10 buğday; mine 2 enerji -> 5 demir; santral -> 2 enerji; mill 10 buğday + 1 enerji -> 8 un; steelworks 5 demir + 3 enerji -> 4 çelik |
| Süreler (tick) | farm 7200, mine 7200, santral 28800, mill 7200, steelworks 14400 |
| facilityBasePrice | farm 1.8M, mine 2.2M, power_plant 2.5M, mill 1.8M, steelworks 2.4M |
| facilityGrowthBps | 2500 (+%25 / sahip olunan tesis), en çok 20 |
| upkeepBase (saat) | farm 1800, mine 2200, power_plant 2100, mill 1800, steelworks 2300 |
| upkeepCountGrowthBps | 200: `upkeep(type, level, ownedCount?)` her ek tesis için bakımı %2 artırır; `ownedCount` verilmezse eski davranış |
| companyFoundingFee | 500.000 |
| relief | eşik 1.5M, tutar 400k, 86400 tick; `reliefEligible({cash, inventoryValue, hasActiveFacility})` |

Süreler: kısa süre (60 sn) botu tesis başına fiilen sınırsız yapıyordu; saatler mertebesi bot ile meşru oyuncu verimini birbirine yaklaştırır. Santral çıktısı 2 enerji (10 iken santral oranı tüm sonuçları belirliyordu).

## Sim yöntemi
300 oyuncu, 30 gün, 1 tick = 1 sn; oyuncu dakikada bir karar verir, havuz adım başına (60 tick) yenilenir, emirler havuza sırayla uygulanır (önizleme ve gerçek aynı fonksiyon). Tipler: 120 aktif üretici (ortalama 2 saatte bir döner, kâr maksimize eden batch seçer, ref %60 altında satmaz), %0-30 bot (her dakika döner, tam otomasyon, ref %75 altında satmaz, her şeyi kâr için optimize eder), 30 pasif farm sahibi, tüccar, kumarbaz (ödenek testi), nakit tutucu. Üreticilerin %40'ı santral (enerjiyi bu tür sağlar). Defter denetimi dengeli. Kaynak = satış geliri + ödenek; yutak = alım + ücret/bakım; kurulum (capex) hariç.

## Sonuç (tek tesis/oyuncu, 30 gün)
| Bot % | Kaynak/yutak | Endeks min/maks | Gini (nakit+env / tesis dahil) | Meşru üretici günlük kazanç | Bot günlük getiri |
|---|---|---|---|---|---|
| 0 | 1,040 | 0,975 / 1,025 | 0,108 / 0,128 | 1.274 TL | - |
| 10 (seed 42) | 1,069 | 0,969 / 1,028 | 0,128 / 0,147 | 1.231 TL | +%1,84 |
| 10 (seed 7) | 1,069 | 0,967 / 1,030 | 0,127 / 0,146 | 1.234 TL | +%1,84 |
| 20 | 1,090 | 0,964 / 1,031 | 0,139 / 0,154 | 1.170 TL | +%1,85 |
| 30 | 1,104 | 0,958 / 1,034 | 0,145 / 0,152 | 1.093 TL | +%1,86 |
Pasif farm sahibi günde %0,61 erir, nakit tutan sabit, ödenek alan %3. Tüm hedefler tuttu. Santral oranı duyarlılığı düştü: santral üretici günlük getirisi %1,59, diğerleri %0,43-1,58 (önceki ayarda santral ~%3, diğerleri ~%0).

## Tesis sayısı (N)
Üretici ve botların rastgele ~%65'i N tesisle, kalanı 1 tesisle başlar (N'li gruba capex farkı hibe edilir, kurulum sonrası servet karşılaştırılabilir). Tablo: N'li meşru üretici günlük kazancı (aynı koşuda 1 tesisli meşru grubun kazancı parantezde), kaynak/yutak, endeks aralığı.
| N | Bot %10: kaynak/yutak | Endeks | Kazanç N (N=1 grubu) | Bot %20: kaynak/yutak | Kazanç N (N=1 grubu) |
|---|---|---|---|---|---|
| 1 | 1,069 | 0,969-1,028 | 1.231 TL | 1,090 | 1.170 TL |
| 2 | 1,106 | 0,959-1,038 | 2.116 TL (1.192) | 1,119 | 1.879 TL (1.061) |
| 3 | 1,118 | 0,950-1,048 | 2.713 TL (985) | 1,122 | 2.251 TL (811) |
| 4 | 1,118 | 0,941-1,060 | 2.981 TL (838) | 1,115 | 2.194 TL (645) |
| 5 | 1,113 | 0,931-1,072 | 2.780 TL (718) | 1,109 | 1.330 TL (499) |
Kaynak/yutak her N ve bot oranında 0,9-1,15. Kazanç N=4'e kadar artar (N=1 grubundan 3-4 kat), sonra azalır: kapasite ortak olduğu için marjinal tesisin verimi düşer, ortak havuz herkesin N=5 olduğu uç durumda doyar (bot %20'de N=5 N=4'ün altında).

## Pump-and-dump
`pumpProfit` (havuz + yenilenme) ve rastgele al/sat/bekle dizileri + tasfiye (fast-check) net kâr <= 0. Havuz yol bağımsız olduğu için tek veya çok tick'li fiyat şişirme kâr bırakmaz.

## Backend'in yapması gerekenler
1. `products` satırına `pool_units`, `pool_value` (bigint, CHECK >= 1). `price` = `poolPrice(pool)` ile türetilmiş görüntü olarak kalır. `pending_demand`/`pending_supply`, `nextPrice`/`npcFlow` kalkar. Seed: `initialPool(id)`.
2. `trade.ts`: ürün satırı `FOR UPDATE`, `executeAgainstPool(side, pool, qty)`, defter `r.gross`/`r.tax`, satırı `r.newPool` ve `r.newPrice` ile güncelle. `qty > poolMaxOrder(pool)` için hata kodu (ORDER_TOO_LARGE); kayıtlı `unitPrice` = `r.unitPrice`.
3. `ticker.ts`: her tick (veya `ticks = tick - ürün.tick` ile toplu) `replenish(pool, id, ticks)` ve `price` yaz.
4. Bakım: tesis başına `upkeep(type, level, ownedCount)` çağrılmalı (`ownedCount` = şirketteki toplam tesis sayısı); `ownedCount` verilmezse çarpan uygulanmaz.
5. `RECIPES` değerleri ve süreler değişti; arayüz/katalog bunları `RECIPES`'ten okumalı.

## AÇIK KONULAR
- Ortak kaynak: bot oranı arttıkça meşru getiri düşer (%30 botta 1.093 TL/gün); bot oranı izlenmeli.
- N=5 ve çok kalabalık havuzda marjinal tesis negatif olabilir (azalan verim, bilinçli); kapasite için `poolDepth` ölçeklenebilir (derinlik x2 kaynak/yutak'ı ~+0,02 artırır).
- Sim'de bot hep aynı türde ve tek stratejiyle; çok türlü zincir kuran bot denenmedi.
- Ödenek: çoklu misafir hesap riski sürüyor (hesap açma ve hız sınırı şart).
- Düşük fiyat çözünürlüğü artık sorun değil (havuz hesabı tam sayı oranla), ama `price` görüntüsü kuruşa yuvarlanır.
