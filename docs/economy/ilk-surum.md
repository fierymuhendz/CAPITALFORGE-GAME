# İlk sürüm ekonomi parametreleri ve simülasyonu

## Parametreler (`packages/economy/src/params.ts`)
| Parametre | Değer | Not |
|---|---|---|
| startingBalance | 1.000.000 (10.000 TL) | tek kaynak: system:mint |
| spreadBps | 150 | alışta +, satışta − (yukarı yuvarlı) |
| transactionTaxBps | 100 | yutak: system:tax |
| maxPriceStepBps | 300 | tick başına en fazla %3 |
| liquidity | 1000 | adım = (d−s)·300/(d+s+L) bp |
| minPrice / maxPrice | 1 / 10^12 | |

Round-trip kârsızlık: en kötü fiyat artışı +%3, gidiş-dönüş maliyeti spread 2×%1,5 + vergi 2×%1 ≈ %5. Özellik testi tek oyuncunun tüm talebi oluşturduğu durumu ve ek talepli durumu kapsar.

## Yöntem
`pnpm sim` (env: SIM_PLAYERS, SIM_TICKS, SIM_SEED, SIM_MAX_QTY). 3 ürün, 1 tick = 1 gün. Tipler: rastgele (3/7), trend takipçisi (2/7), arbitrajcı (1/7, al ve sonraki tick sat), biriktirici (1/7). Defter denetimi: mint = oyuncu nakdi + market net + vergi (tüm koşularda dengeli).

## Sonuçlar
| Koşu | Para (nakit) başlangıç → son | Envanter dahil servet | Fiyat endeksi (son, min/max) | Gini (servet) | İflas | Vergi yutağı |
|---|---|---|---|---|---|---|
| 300 oyuncu, 365 gün, seed 42 | 3,00M → 0,42M TL | 1,75M TL | 1,095 (1,009 / 1,165) | 0,224 | %14,3 | 0,53M TL |
| 500 oyuncu, 730 gün, seed 7 | 5,00M → 0,19M TL | 1,64M TL | 1,078 (1,012 / 1,208) | 0,374 | %14,2 | 1,39M TL |

Ortalama servet (300 oyuncu, başlangıç 10.000 TL): rastgele 5.672, trend 7.867, biriktirici 8.106, arbitrajcı 54 TL. İflas = nakitsiz ve envanteri boş oyuncu; tamamı arbitrajcılar. Arbitraj istismarı kârlı değil.

## Bulgular
- Fiyat endeksi stabil (±%20 bandı), enflasyon kontrol altında. Ürün fiyatları başlangıca göre yatay/hafif yükseliş.
- Para kaynağı yalnızca başlangıç hibesi. Yutak sürekli (vergi + spread). Oyuncu para arzı monoton azalır: toplam servet 3M → 1,75M (365 gün) ve 5M → 1,64M (730 gün). Spread market'te kalır (market bakiyesi negatif olabilir, yani sistem dışı havuz), yani gerçek deflasyon.
- Gini zamanla artıyor (0,22 → 0,37): sürekli sürtünme aktif tüccarı yer.

## AÇIK KONULAR (parametre önerileri)
- Üretim/gelir kaynağı yok: sürtünme (~%2,5 işlem başına) yutuyor, kaynak yok. Üretim, maaş veya günlük ödenek eklenmeden uzun vadede ekonomi ölür. Öneri: kaynak ≈ yutağın %80-100'ü olacak şekilde üretim formülü (sonraki ekonomi görevi).
- Spread 150 + vergi 100 aktif tüccar için ağır. Round-trip kârsızlık için gereken en az: spread ≥ ~maxStep/2 − vergi. Öneri: spread 100, vergi 50 ile test edilebilir (maxStep 300 sabitken kârsızlık tamam: 3% < 2×1%+2×0,5%=3%, sınırda; testle doğrula) ya da maxStep 200.
- İflas kurtarma yok: nakitsiz+envantersiz oyuncu kalıcı kilitli. Öneri: asgari ödenek veya satılabilir başlangıç envanteri.
- Sim 1 tick = 1 gün; gerçek tick 1 sn, ödüllü hız sınırı 5 emir/sn ile tick başına talep daha küçük, `liquidity` 1000 ürün başına oyuncu sayısına göre yeniden ayarlanmalı.
