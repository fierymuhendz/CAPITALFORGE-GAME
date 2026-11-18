# Şirket ve üretim: parametreler ve simülasyon

Plan: `docs/plans/sirket-ve-uretim.md`. Önceki sim: `docs/economy/ilk-surum.md`.
Parametreler: `packages/economy/src/params.ts`. Çalıştırma: `pnpm sim` (env: `SIM_PLAYERS` 300, `SIM_DAYS` 30, `SIM_SEED` 42, `SIM_ATTENTION` 120).

## Değişen / yeni parametreler (kuruş)
| Parametre | Eski | Yeni | Not |
|---|---|---|---|
| startingBalance | 1.000.000 | 10.000.000 | Ürün birim fiyatı >= 500 kuruş olmak zorunda (aşağıda), 10 batch'lik iş 450-1000 TL; eski hibe bir iş bile taşımıyordu |
| spreadBps / transactionTaxBps | 150 / 100 | 100 / 50 | Round-trip testi geçiyor (maxStep 300 ile marj dar, analitik test var) |
| maxPriceStepBps | 300 | 300 | Değişmedi |
| liquidity | 1000 | 100 | 1000'de 500 kuruşluk fiyat hareket edemiyordu (ölü bölge) |
| companyFoundingFee | - | 500.000 | |
| facilityBasePrice | - | farm 5.0M, mine 2.5M, power_plant 8.5M, mill 2.0M, steelworks 1.75M | ~12 gün geri ödeme hedefi (günde 12 iş) |
| facilityGrowthBps | - | 2000 (+%20 / tesis) | 20. tesis ~38x taban |
| upkeepBase (saat) | - | farm 2000, mine 1000, power_plant 3400, mill 800, steelworks 700 | Pasif farm sahibi günde ~%1,3 erir |
| reliefThreshold / Amount / Cooldown | - | 1.5M / 400k / 86400 | Tutar < eşik < en ucuz tesis |
| refPrice = initialPrice | - | wheat 500, iron 600, energy 500, flour 900, steel 1500 | Zincir marjı tarif başına %20-30 |
| npcBase (tick) | - | wheat 50, iron 40, energy 50, flour 40, steel 40 | |
| npcSlopeBps | - | 30000 | %1 sapma, base'in %3'ü kadar net akış |

Zincir (ref fiyat, sürtünme öncesi): farm 1 enerji 500 -> 10 buğday 5000; mine 1000 -> 5x600=3000; mill 5500 -> 8x900=7200; steelworks 4500 -> 4x1500=6000. Santral girdisiz, iş başına (10 batch) 100.000 kuruş.

## Yöntem
300 oyuncu, 30 gün, 1 tick = 1 sn. Oyuncu kararı dakikada bir (60 tick), fiyat HER tick güncellenir; her işlem adım içinde rastgele bir tick'e düşer, NPC akışı eklenir. Tipler (300 oyuncu): aktif üretici 120 (farm 44, mine 16, santral 16, değirmen 28, çelikhane 16; ortalama 2 saatte bir döner: sat, iş başlat, genişle; tesis sayısı 20'ye kadar), pasif farm sahibi 30, tüccar 45, kumarbaz 15 (%5, tüm bakiyeyi bir ürüne yatırıp sonraki dönüşte satar, ödenek testi), nakit tutucu 90. Üretici fiyat < ref %90 ise satmaz. Defter denetimi: mint = nakit + market net + vergi + ücretler (dengeli).
Servet = nakit + envanter (sistem lehine). "Tesis dahil" = servet + tesis alış bedeli. Kaynak = satış geliri + ödenek; yutak = alım harcaması + ücret/bakım (vergi ve spread fiyatın içinde).

## Sonuç (seed 42, 300 oyuncu, 30 gün)
| Hedef | Ölçüm | Durum |
|---|---|---|
| Aktif üretici medyan serveti artar | 70.000 -> 107.107 TL (kurulum sonrası), tesis dahil 319.296 TL | Tuttu |
| Pasif tesis sahibi günde %0,5-2 erir | %1,28/gün | Tuttu |
| Yalnız nakit tutan sabit | 100.000 -> 100.000 TL | Tuttu |
| Kaynak/yutak 0,9-1,15 | 1,042 (nakit arzı +%24,5 / 30 gün) | Tuttu |
| Fiyat endeksi ±%25 | min 0,961 / maks 1,033 | Tuttu |
| Gini < 0,45 | 0,231 (nakit+envanter), 0,387 (tesis dahil) | Tuttu |
| Ödenek alan < %10 | %5 (yalnız kumarbazlar) | Tuttu |

Duyarlılık (aynı parametreler):
| Koşu | Kaynak/yutak | Nakit arzı | Endeks | Üretici medyan | Gini (nakit+env / tesis dahil) |
|---|---|---|---|---|---|
| seed 7, 300 | 1,041 | +%24,5 | 0,959-1,026 | 70k -> 104k | 0,229 / 0,393 |
| seed 5, 500 | 1,045 | +%26,1 | 0,959-1,037 | 45k -> 113k | 0,237 / 0,388 |
| dikkat 240 dk (yarı aktif) | 1,032 | +%9,8 | 0,963-1,030 | 70k -> 78k | 0,211 / 0,198 |
| dikkat 60 dk (çok aktif), önceki ayarla | 1,090 | +%124 | 0,949-1,046 | 70k -> 253k | 0,475 / 0,664 (HEDEF TUTMADI) |

## Bulgular
- Gelir üretici aktifliğiyle doğrusal artıyor. Saatte bir dönen oyuncu nüfusunda para arzı ayda %124 büyüyor ve Gini hedefi tutmuyor. Ayarlanabilir sinyal yalnız bakım ve tesis fiyat büyümesi, ikisi de sınırlı.
- Fiyat tam sayı kuruş ve `nextPrice` sıfıra doğru kestiği için düşük fiyatlarda ölü bölge var: fiyat 500 iken adım >= 1 kuruş olması için imbalans >= 20 bp gerekir. NPC tek başına ref'e ~%5'e kadar yaklaşır, test %10 tolerans kullanıyor.
- NPC akışı tam sayı ve tick başına; en küçük birim 1 birim/tick (86.400 birim/gün). Bu 300 oyuncuya göre büyük, yani NPC "alıcı garantisi" olarak çalışıyor ama üretimi fiyatla sınırlamıyor. Üretilen mal ref'in %90'ı üstünde hep satılıyor; gelir sınırı fiyat değil, aktiflik ve tesis sayısı.
- Santral başına gelir diğer türlerin ~3 katı (iş başına 100.000 kuruş girdisiz). Fiyat 8,5M ile dengelendi, yine de en kârlı tür.

## AÇIK KONULAR
- GÜVENLİK/EKONOMİ (yüksek): çok tick'li pump-and-dump kârlı. Oyuncu n tick boyunca her tick q birim alıp fiyatı yükseltir (işlem tick başındaki eski fiyattan gerçekleşir), sonra tamamını satar. NPC akışı dahil: energy, q=1000/tick, 20 tick: +%24,8 kâr (sermaye 13M kuruş); q=200, 20 tick: +%14,8; wheat q=1000, 20 tick: +%20,6. Tek tick'lik al-sat kârsızlık testi bunu yakalamıyor. Kendi etkisini ödeyen yürütme fiyatı denendi, yetmedi (energy q=1000, 20 tick: +%18). Öneri: oyuncu başına tick/dakika hacim üst sınırı (örn. L'nin %X'i) veya emir büyüklüğüyle artan spread (konveks etki); backend + guvenlik-reviewer kararı.
- startingBalance 10x oldu (10M kuruş). Backend `PARAMS.startingBalance` kullandığı için kod uyumlu; ama arayüz metinleri/dokümanlarda "10.000 TL" geçiyorsa güncellenmeli.
- Tohum fiyatları: 0001 migration `wheat 10000, iron 25000, energy 5000`; yeni referans `wheat 500, iron 600, energy 500, flour 900, steel 1500`. 0002 seed bu fiyatları `PARAMS.initialPrice` ile güncellemeli, aksi halde NPC birkaç tick'te çeker ama eski fiyatla ilk emirler yanlış değerlenir. Mevcut `trade.int.test.ts` sabit 10000 fiyatlı tohum kullanıyor, etkilenmez.
- Aktiflik duyarlılığı: ortalama 1 saatte bir dönen oyuncu nüfusunda Gini/enflasyon bozuluyor. Öneri: bakım seviyeye ve tesis sayısına göre artsın (şirket başı tesis sayısıyla çarpan) veya iş başlatmaya tesis başına cooldown; ya da `facilityGrowthBps` 2500-3000.
- Ölü bölge: `nextPrice` sıfıra kestiği için fiyat < ~1000 kuruş olan ürünlerde fiyat hareketi kaba. Yeni ürün eklenirken fiyat >= 500 tutulmalı veya fiyat çözünürlüğü artırılmalı.
- Askıya alınan tesis: sim'de hiç oluşmadı, ama nakitsiz + envantersiz tesis sahibi ödenek alamıyor (plan gereği "tesisi yok" şartı). Öneri: bakım borcu nedeniyle `suspended` olan tesis sahibi için ödenek şartı `hasFacility` yerine `hasActiveFacility` olsun (backend kararı).
- Ödenek: kumarbazlar (%5) bakiyeyi sürtünmeyle eritip 30 günde ~15'er kez ödenek aldı (toplam 880.000 TL, kişi başı ~0,6 başlangıç hibesi). Tek hesap için sınırlı, ama çoklu misafir hesap + eşiğe düşme maliyeti hibeye yakın; hız sınırı ve hesap açma sınırı şart (guvenlik-reviewer).
