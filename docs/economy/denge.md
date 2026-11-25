# Denge simülasyonu (v3)

Başlangıç parası ₺150.000. Model: `packages/economy/sim/model.ts` (sistem doygunluk eğrileri, N rakip oyuncu, navlun, kalite, yatırım). Para kuruş/bigint; tablo ₺ gösterir.
Varsayılanlar: N = 2 oyuncu aynı pazarı paylaşır, sistem alış fiyatı kalite ölçekli üst sınırla, girdiler oyunculardan (alış ile satış arası orta fiyat + navlun) ya da sistemden en ucuzuna.

## 1. İlk iş (tempo tavanı 60 dk, seviye 1, tek parti, girdiler sistemden satın alınsa bile, N = 1)

| Sektör | Şehir | Tarif | Süre | Maliyet | Çıktı | Gelir (navlun, komisyon sonrası) | Kâr |
|---|---|---|---|---|---|---|---|
| crop | Yeşilova | Yem bitkisi ekimi | 60 dk | ₺3.024 | 2400 kg | ₺6.277 | ₺3.253 |
| crop | Yeşilova | Tahıl ekimi | 60 dk | ₺4.710 | 2000 kg | ₺10.354 | ₺5.644 |
| crop | Kavşak | Yem bitkisi ekimi | 60 dk | ₺3.430 | 2400 kg | ₺5.307 | ₺1.877 |
| crop | Kavşak | Tahıl ekimi | 60 dk | ₺5.378 | 2000 kg | ₺8.953 | ₺3.575 |
| livestock | Akyayla | Süt sağımı | 60 dk | ₺4.961 | 1000 kg | ₺8.064 | ₺3.103 |
| livestock | Yeşilova | Süt sağımı | 60 dk | ₺4.281 | 1000 kg | ₺7.625 | ₺3.344 |
| mining | Demirdağ | Demir cevheri çıkarma | 60 dk | ₺3.300 | 4000 kg | ₺8.809 | ₺5.509 |
| mining | Demirdağ | Kömür çıkarma | 60 dk | ₺3.100 | 3000 kg | ₺8.214 | ₺5.114 |
| mining | Kavşak | Kömür çıkarma | 60 dk | ₺2.425 | 3000 kg | ₺7.371 | ₺4.946 |
| manufacturing | Körfezkent | Un öğütme | 60 dk | ₺14.748 | 1500 kg | ₺19.134 | ₺4.387 |
| manufacturing | Körfezkent | Süt paketleme | 60 dk | ₺11.918 | 950 kg | ₺14.801 | ₺2.883 |
| manufacturing | Körfezkent | Peynir yapımı | 60 dk | ₺24.628 | 200 kg | ₺26.609 | ₺1.982 |
| manufacturing | Demirdağ | Çelik dökümü | 60 dk | ₺12.370 | 1000 kg | ₺15.900 | ₺3.530 |

Bağış girdileri (tohum 400 kg, yem 3000 kg, tahıl 2000 kg, cevher 2000 + kömür 1000 kg) her sektörde en az bir tam partiyi karşılar.

## 2. Sektör kârı (günlük işletme kârı ve 21 gün, N = 2, kalite ölçekli üst sınır, yatırımlar açgözlü)

21 günlük yörünge: her gün nakit yeterse geri dönüşü en kısa yatırım (bina seviyesi, tesis kalitesi, araştırma) alınır. Kâr = gelir − girdi − enerji/su/işçilik − bina bakımı.

| Sektör | Günlük kâr L1 | L2 | L3 | 21 gün işletme kârı | Yatırım harcaması | Alınan yatırımlar |
|---|---|---|---|---|---|---|
| Tarım: tahıl (Yeşilova) | ₺27.654 | ₺31.016 | ₺36.286 | ₺768.028 | ₺113.970 | g1:L2, g2:Q2, g3:RY1 |
| Hayvancılık: süt (Akyayla) | ₺31.830 | ₺42.410 | ₺47.278 | ₺1.173.041 | ₺282.920 | g1:L2, g2:Q2, g3:RY1, g5:RQ1 |
| Madencilik: kömür (Demirdağ) | ₺29.745 | ₺40.227 | ₺43.189 | ₺1.039.819 | ₺286.350 | g1:L2, g2:Q2, g3:RY1, g5:RQ1 |
| Madencilik: demir (Demirdağ) | ₺25.180 | ₺32.185 | ₺35.018 | ₺796.143 | ₺186.350 | g1:L2, g2:RY1, g3:Q2 |
| İmalat: un (Körfezkent) | ₺29.805 | ₺40.294 | ₺47.619 | ₺1.165.850 | ₺317.330 | g1:Q2, g3:RQ1, g6:L2 |
| İmalat: paketli süt (Körfezkent) | ₺27.055 | ₺38.758 | ₺45.299 | ₺1.165.980 | ₺317.330 | g1:Q2, g4:L2, g6:RQ1 |
| İmalat: peynir (Körfezkent) | ₺18.569 | ₺27.821 | ₺35.484 | ₺819.808 | ₺317.330 | g1:Q2, g5:L2, g8:RQ1 |
| İmalat: çelik (Demirdağ) | ₺23.718 | ₺31.536 | ₺39.325 | ₺990.643 | ₺277.080 | g1:Q2, g3:L2, g6:RQ1 |
| Taşımacılık: kamyon, sistem işleri (N = 2) | ₺38.420 (1 kamyon) | ₺38.120 (2 kamyon) | ₺37.820 (3 kamyon) | ₺797.515 | ₺360.000 | g3:kamyon, g8:kamyon |

Beş sektörün temsilcileri (tarım, hayvancılık, madencilik, imalat-un, imalat-çelik, taşımacılık) arasında en yüksek / en düşük 21 gün işletme kârı = ₺1.173.041 (livestock) / ₺768.028 (crop) = 1.53×. Hedef ≤ 2,2×.

Rakip sayısına duyarlılık (21 gün işletme kârı, ₺): bina seviyesi 3 yalnızca pazarı tek başına dolduran oyuncuya yarar.

| Sektör | N = 1 | N = 2 | N = 3 |
|---|---|---|---|
| Tarım: tahıl (Yeşilova) | ₺1.838.006 | ₺768.028 | ₺489.806 |
| Hayvancılık: süt (Akyayla) | ₺2.652.466 | ₺1.173.041 | ₺703.130 |
| Madencilik: kömür (Demirdağ) | ₺2.128.856 | ₺1.039.819 | ₺621.553 |
| İmalat: un (Körfezkent) | ₺2.724.220 | ₺1.165.850 | ₺695.195 |
| İmalat: çelik (Demirdağ) | ₺2.429.239 | ₺990.643 | ₺593.113 |
| Taşımacılık (kamyon) | ₺1.532.261 | ₺797.515 | ₺530.482 |

## 3. H1: kalite primi (sistem alış fiyatı kuruş/kg, tahıl, doygunluk 0)

| Şehir | Kalite | Eski (cap kaliteden sonra) | Yeni (cap kalite 2 tabanında) | Eski prim vs kalite 2 | Yeni prim |
|---|---|---|---|---|---|
| Körfezkent | 2 | 432 | 432 | %0 | %0 |
| Körfezkent | 3 | 432 | 470 | %0 | %9 |
| Körfezkent | 4 | 432 | 505 | %0 | %17 |
| Körfezkent | 5 | 432 | 540 | %0 | %25 |
| Yeşilova | 2 | 382 | 382 | %0 | %0 |
| Yeşilova | 3 | 416 | 416 | %9 | %9 |
| Yeşilova | 4 | 432 | 446 | %13 | %17 |
| Yeşilova | 5 | 432 | 477 | %13 | %25 |
| Kavşak | 2 | 425 | 425 | %0 | %0 |
| Kavşak | 3 | 432 | 463 | %2 | %9 |
| Kavşak | 4 | 432 | 497 | %2 | %17 |
| Kavşak | 5 | 432 | 531 | %2 | %25 |

Sistem satışı yalnızca kalite 2'dir; kalite ancak üretimle elde edilir. Aşağıdaki denetim her ürün, şehir ve kalite için normalleştirilmiş alışın (alış × kalite 2 çarpanı / kalite çarpanı) en düşük sistem satış fiyatının altında kaldığını doğrular.

## 4. Sistem arbitraj denetimi (kalite ölçekli üst sınırla)

- Yem bitkisi: en yüksek normalleştirilmiş sistem alış 216 < en düşük sistem satış 270 kuruş/kg → zarar (doğru)
- Tahıl: en yüksek normalleştirilmiş sistem alış 432 < en düşük sistem satış 540 kuruş/kg → zarar (doğru)
- Çiğ süt: en yüksek normalleştirilmiş sistem alış 734 < en düşük sistem satış 918 kuruş/kg → zarar (doğru)
- Demir cevheri: en yüksek normalleştirilmiş sistem alış 187 < en düşük sistem satış 265 kuruş/kg → zarar (doğru)
- Kömür: en yüksek normalleştirilmiş sistem alış 276 < en düşük sistem satış 346 kuruş/kg → zarar (doğru)
- Çelik: en yüksek normalleştirilmiş sistem alış 1683 < en düşük sistem satış 2203 kuruş/kg → zarar (doğru)

## 5. H6: yatırım geri dönüşü (başlangıç durumu: seviye 1, kalite 1, araştırma 0; N = 2)

| Sektör | Yatırım | Maliyet | Günlük kazanç | Geri dönüş (gün) |
|---|---|---|---|---|
| Tarım: tahıl (Yeşilova) | Tarla seviye 2 (en kısa) | ₺38.970 | ₺3.362 | 12 |
| Tarım: tahıl (Yeşilova) | tesis kalitesi 2 | ₺50.000 | ₺4.147 | 13 |
| Tarım: tahıl (Yeşilova) | kalite kontrol 1 | ₺100.000 | ₺4.147 | 25 |
| Tarım: tahıl (Yeşilova) | agronomy 1 | ₺25.000 | ₺1.845 | 14 |
| Hayvancılık: süt (Akyayla) | Ahır seviye 2 (en kısa) | ₺82.920 | ₺10.581 | 8 |
| Hayvancılık: süt (Akyayla) | tesis kalitesi 2 | ₺70.000 | ₺7.490 | 10 |
| Hayvancılık: süt (Akyayla) | kalite kontrol 1 | ₺100.000 | ₺7.490 | 14 |
| Hayvancılık: süt (Akyayla) | herd_health 1 | ₺30.000 | ₺3.428 | 9 |
| Madencilik: kömür (Demirdağ) | Maden ocağı seviye 2 (en kısa) | ₺96.350 | ₺10.482 | 10 |
| Madencilik: kömür (Demirdağ) | tesis kalitesi 2 | ₺60.000 | ₺5.312 | 12 |
| Madencilik: kömür (Demirdağ) | kalite kontrol 1 | ₺100.000 | ₺5.312 | 19 |
| Madencilik: kömür (Demirdağ) | drilling 1 | ₺30.000 | ₺2.988 | 11 |
| İmalat: un (Körfezkent) | Gıda fabrikası seviye 2 | ₺117.330 | ₺10.489 | 12 |
| İmalat: un (Körfezkent) | tesis kalitesi 2 (en kısa) | ₺100.000 | ₺10.360 | 10 |
| İmalat: un (Körfezkent) | kalite kontrol 1 | ₺100.000 | ₺10.360 | 10 |
| İmalat: çelik (Demirdağ) | Çelikhane seviye 2 | ₺77.080 | ₺7.818 | 10 |
| İmalat: çelik (Demirdağ) | tesis kalitesi 2 (en kısa) | ₺100.000 | ₺11.290 | 9 |
| İmalat: çelik (Demirdağ) | kalite kontrol 1 | ₺100.000 | ₺11.290 | 9 |

Her sektörün en kısa geri dönüşlü ilk yatırımı farklı olabilir: L, Q. Tek bir hep-en-iyi yol yok.

## 6. H4: taşımacılık tarifesi (kamyon 12 t, 15.000 kuruş/sa ücret)

Eski tarife: (taban 45000 + km × 3200) × kamyon dolusu, sistem işleri hep 4 t. Yeni: mesafe sınırı, kısmi yük, hacim indirimi, süre primi, yükleme-boşaltma 40 dk.

| Rota | Yük | Eski ücret | Eski saat başı kâr | Yeni ücret | Yeni saat başı kâr |
|---|---|---|---|---|---|
| Kavşak → Yeşilova (90 km) | 12 t | ₺3.330 | ₺2.400 | ₺5.058 | ₺5.649 |
| Kavşak → Demirdağ (150 km) | 12 t | ₺5.250 | ₺2.074 | ₺8.130 | ₺6.130 |
| Körfezkent → Demirdağ (250 km) | 12 t | ₺8.450 | ₺1.659 | ₺12.482 | ₺5.641 |
| Kavşak → Demirdağ (150 km) | 4 t | ₺5.250 | ₺2.074 | ₺5.314 | ₺1.684 |
| Kavşak → Demirdağ (150 km) | 6 t | ₺5.250 | ₺2.074 | ₺6.018 | ₺2.796 |
| Körfezkent → Yeşilova (180 km) | 9 t | ₺6.210 | ₺1.764 | ₺8.200 | ₺4.213 |

Eski tarifede 4 t'luk iş dolu kamyon kadar öder ve kâr/saat rotaya bakmaksızın yakın; yeni tarifede 4–6 t zararına yakındır, dolu kamyon kazanır (kısmi yük pahalıya gelir). Kamyonet (3 t) sistem işlerini eskiden hiç alamıyordu (iş 4 t); yeni karışımda 2,5 t işler kamyonetlidir. Günlük sistem işi 45 (şehir başına 9); N = 2 taşımacı, kamyon başına günlük kâr ₺38.420 (eski ₺6.428); 21 gün: yeni ₺797.515, eski ₺134.093.

Sistem işi örneği (yeni karışım, gün 0, Kavşak çıkışlı):

| Hedef | Yük | Süre | Ücret | Kamyon maliyeti | Saat başı kâr |
|---|---|---|---|---|---|
| Akyayla | 2.5 t | 24 sa | ₺3.629 | ₺3.155 | ₺949 |
| Demirdağ | 6 t | 24 sa | ₺6.018 | ₺4.248 | ₺2.796 |
| Körfezkent | 12 t | 24 sa | ₺6.594 | ₺3.428 | ₺5.937 |
| Yeşilova | 12 t | 12 sa | ₺5.817 | ₺2.610 | ₺7.400 |
| Akyayla | 9 t | 6 sa | ₺6.900 | ₺3.155 | ₺7.490 |
| Demirdağ | 24 t | 48 sa | ₺13.196 | ₺4.248 | kamyon sığmaz (tır) |
| Körfezkent | 2.5 t | 24 sa | ₺3.918 | ₺3.428 | ₺920 |
| Yeşilova | 6 t | 24 sa | ₺3.791 | ₺2.610 | ₺2.725 |
| Akyayla | 12 t | 24 sa | ₺6.082 | ₺3.155 | ₺5.854 |

### Taşımacı kararı: uzun dolu sefer mi, kısa iş mi (tur = gidiş + dönüş, saat başı kâr)

- Küme A (dönüş yükü yalnızca kısa rotada): uzun (Kavşak→Demirdağ 150 km, 12 t, dönüş boş + 20 dk bekleme) tur kârı ₺-365, 1.6 sa, ₺-228/sa; kısa (Kavşak→Yeşilova 90 km, 12 t, dönüş 12 t) tur kârı ₺4.896, 0.9 sa, ₺5.649/sa → **KISA kazanır**.
- Küme B (dönüş yükü yalnızca uzun rotada: Demirdağ çelik/kömür): uzun (Kavşak→Demirdağ 150 km, 12 t, dönüş 12 t) tur kârı ₺7.765, 1.3 sa, ₺6.130/sa; kısa (Kavşak→Yeşilova 90 km, 12 t, dönüş boş + 20 dk bekleme) tur kârı ₺-162, 1.2 sa, ₺-135/sa → **UZUN kazanır**.
- Süre primi: uzun sefer acil (6 sa) ücreti ₺10.569 (+%30), 12 sa ₺9.350 (+%15), 24 sa ₺8.130, 48 sa ₺7.724 (−%5): aracı o an boşta olan acil işi alırsa tur kârı ₺2.074 (24 sa: ₺-365).

## 7. H5: çiftçi, spot ya da sistem sözleşmesi (tahıl, Yeşilova, 3 taksit × 2000 kg, 24 sa arayla)

- Küme A (pazar doygun: rakipler günlük talebin %80'ini doldurdu, kalite 2): sözleşme 439 kuruş/kg (kalite fark etmez), spot 290 kuruş/kg (doluluk %80, sapma 100%, kalite 2), teslim edememe %5 → sözleşme ₺24.860 vs spot ₺17.226 → **SÖZLEŞME** (fark ₺7.634).
- Küme B (pazar boş, referans %20 yukarı kaymış, kalite 4 stok): sözleşme 407 kuruş/kg (kalite fark etmez), spot 505 kuruş/kg (doluluk %10, sapma 120%, kalite 4), teslim edememe %5 → sözleşme ₺23.048 vs spot ₺29.997 → **SPOT** (fark ₺6.949).

Sistem sözleşme fiyatı = doygunluksuz sistem alışı × (1 + %3 + doygunluğun %12'si + itibar payı), en çok en düşük sistem satışının %95'i. Doygun pazarda sözleşme spotu geçer; boş pazarda spot, kayma ve yüksek kalite sözleşmeyi geçer. Ceza (%10) ve teminat faizi sözleşmenin bedelidir.

## 8. H3: imalatçı, yakın pahalı mı uzak ucuz mu (un fabrikası Körfezkent, tahıl)

- Küme A: 3.000 kg (kısmi yük): Körfezkent toptan (0 km) 630 kuruş/kg (navlun ₺0) | Yeşilova çiftçisi (180 km) 646 kuruş/kg (navlun ₺4.992) → **Körfezkent toptan (0 km)**.
- Küme B: 12.000 kg (dolu kamyon): Körfezkent toptan (0 km) 521 kuruş/kg (navlun ₺4.992) → **Yeşilova çiftçisi (180 km)**.

Un fabrikası seviye 1, günlük kâr: yalnızca sistem girdisi ₺26.390, oyuncu tedarikli ₺29.805. Sistem toptancı günlük satışı sınırlıdır (Körfezkent tahıl 4000 kg) ve doldukça %20'ye kadar pahalanır, bu yüzden oyuncu tedariki gerçek bir seçenektir.

## 9. Sistem bütçesi

| Şirket | Günlük bütçe | Nominal alım değeri (kalite 2) | Kalite 5 üst sınırı |
|---|---|---|---|
| Körfezkent Toptan | ₺135.000 | ₺97.164 | ₺121.410 |
| Yeşilova Toptan | ₺125.000 | ₺89.388 | ₺111.528 |
| Akyayla Toptan | ₺170.000 | ₺123.420 | ₺154.200 |
| Demirdağ Toptan | ₺230.000 | ₺167.325 | ₺208.650 |
| Kavşak Toptan | ₺130.000 | ₺93.000 | ₺116.202 |
| Körfezkent Tüketici Kooperatifi | ₺700.000 | ₺507.984 | ₺634.916 |
| Kavşak Tüketici Kooperatifi | ₺290.000 | ₺208.650 | ₺260.783 |
| Yeşilova Tüketici Kooperatifi | ₺110.000 | ₺79.303 | ₺99.106 |
| Akyayla Tüketici Kooperatifi | ₺50.000 | ₺34.140 | ₺42.660 |
| Demirdağ Tüketici Kooperatifi | ₺220.000 | ₺159.680 | ₺199.566 |
| Ulusal İnşaat A.Ş. | ₺280.000 | ₺201.960 | ₺252.360 |
| Ulusal İnşaat Kavşak | ₺140.000 | ₺99.840 | ₺124.800 |
| Kavşak Termik Santrali | ₺115.000 | ₺82.800 | ₺103.500 |
| Demirdağ Santrali | ₺55.000 | ₺36.750 | ₺45.900 |

Toplam günlük bütçe tavanı ₺2.750.000; nominal alım değeri ₺1.981.404. Beklenen gerçek harcama (5 sektörden 2'şer oyuncu, seviye 2, + taşıma işleri): yaklaşık ₺961.496 (tavanın %34'i). Sistem parayı yalnızca oyuncu üretimine karşılık basar; bütçe tavandır, hedef değil.

## Sonuç

Tüm denetimler geçti: ilk iş her sektörde kârlı ve bağışla karşılanır, beş sektör de 21 günde kâr eder (en yüksek / en düşük ≤ 2,2×), sistem arbitrajı yok, spot/sözleşme, tedarikçi ve taşımacı kararları parametreyle çevrilir.
