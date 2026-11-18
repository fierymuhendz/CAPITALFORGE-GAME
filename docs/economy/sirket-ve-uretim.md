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
