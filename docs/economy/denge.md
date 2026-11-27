# Denge simülasyonu (v3)

Başlangıç parası ₺150.000. Model: `packages/economy/sim/model.ts` (sistem doygunluk eğrileri, N rakip oyuncu, navlun, kalite, yatırım). Para kuruş/bigint; tablo ₺ gösterir.
Varsayılanlar: N = 2 oyuncu aynı pazarı paylaşır, sistem alış fiyatı kalite ölçekli üst sınırla, girdiler oyunculardan (alış ile satış arası orta fiyat + navlun) ya da sistemden en ucuzuna.

## 1. İlk iş (tempo tavanı 60 dk, seviye 1, tek parti, girdiler sistemden satın alınsa bile, N = 1)

| Sektör | Şehir | Tarif | Süre | Maliyet | Çıktı | Gelir (navlun, komisyon sonrası) | Kâr |
|---|---|---|---|---|---|---|---|
| crop | Yeşilova | Yem bitkisi ekimi | 60 dk | ₺3.024 | 2400 kg | ₺6.277 | ₺3.253 |
| crop | Yeşilova | Tahıl ekimi | 60 dk | ₺4.710 | 2000 kg | ₺10.354 | ₺5.644 |
| crop | Yeşilova | Arpa ekimi | 60 dk | ₺4.670 | 2200 kg | ₺1.758 | ₺-2.912 |
| crop | Yeşilova | Mısır ekimi | 60 dk | ₺4.455 | 2600 kg | ₺1.898 | ₺-2.558 |
| crop | Yeşilova | Soya ekimi | 60 dk | ₺4.745 | 1200 kg | ₺1.893 | ₺-2.852 |
| crop | Yeşilova | Ayçiçeği ekimi | 60 dk | ₺3.539 | 1000 kg | ₺2.313 | ₺-1.227 |
| crop | Yeşilova | Şeker pancarı ekimi | 60 dk | ₺4.008 | 6000 kg | ₺1.973 | ₺-2.036 |
| crop | Yeşilova | Patates ekimi | 60 dk | ₺8.075 | 4000 kg | ₺12.355 | ₺4.281 |
| crop | Yeşilova | Soğan ekimi | 60 dk | ₺3.097 | 3000 kg | ₺11.030 | ₺7.933 |
| crop | Yeşilova | Tohumluk ayırma | 60 dk | ₺6.290 | 800 kg | ₺0 | ₺-6.290 |
| crop | Yeşilova | Saman balyalama | 60 dk | ₺1.412 | 2500 kg | ₺470 | ₺-942 |
| crop | Yeşilova | Gübreli tahıl ekimi | 60 dk | ₺5.968 | 2900 kg | ₺14.868 | ₺8.900 |
| crop | Yeşilova | Gübreli mısır ekimi | 60 dk | ₺5.713 | 3600 kg | ₺1.898 | ₺-3.816 |
| crop | Yeşilova | Gübreli arpa ekimi | 60 dk | ₺5.928 | 3100 kg | ₺1.758 | ₺-4.170 |
| crop | Yeşilova | Gübreli patates ekimi | 60 dk | ₺9.615 | 5600 kg | ₺16.709 | ₺7.094 |
| crop | Kavşak | Yem bitkisi ekimi | 60 dk | ₺3.430 | 2400 kg | ₺5.107 | ₺1.677 |
| crop | Kavşak | Tahıl ekimi | 60 dk | ₺5.378 | 2000 kg | ₺8.606 | ₺3.228 |
| crop | Kavşak | Arpa ekimi | 60 dk | ₺5.303 | 2200 kg | ₺1.653 | ₺-3.651 |
| crop | Kavşak | Mısır ekimi | 60 dk | ₺5.230 | 2600 kg | ₺1.795 | ₺-3.435 |
| crop | Kavşak | Soya ekimi | 60 dk | ₺5.488 | 1200 kg | ₺1.840 | ₺-3.648 |
| crop | Kavşak | Ayçiçeği ekimi | 60 dk | ₺4.070 | 1000 kg | ₺2.260 | ₺-1.810 |
| crop | Kavşak | Şeker pancarı ekimi | 60 dk | ₺4.910 | 6000 kg | ₺1.660 | ₺-3.250 |
| crop | Kavşak | Patates ekimi | 60 dk | ₺9.071 | 4000 kg | ₺10.532 | ₺1.461 |
| crop | Kavşak | Soğan ekimi | 60 dk | ₺3.710 | 3000 kg | ₺9.286 | ₺5.576 |
| crop | Kavşak | Tohumluk ayırma | 60 dk | ₺7.055 | 800 kg | ₺0 | ₺-7.055 |
| crop | Kavşak | Saman balyalama | 60 dk | ₺1.596 | 2500 kg | ₺368 | ₺-1.229 |
| crop | Kavşak | Gübreli tahıl ekimi | 60 dk | ₺6.656 | 2900 kg | ₺12.379 | ₺5.723 |
| crop | Kavşak | Gübreli mısır ekimi | 60 dk | ₺6.508 | 3600 kg | ₺1.795 | ₺-4.713 |
| crop | Kavşak | Gübreli arpa ekimi | 60 dk | ₺6.581 | 3100 kg | ₺1.653 | ₺-4.929 |
| crop | Kavşak | Gübreli patates ekimi | 60 dk | ₺10.631 | 5600 kg | ₺14.371 | ₺3.740 |
| livestock | Akyayla | Süt sağımı | 60 dk | ₺4.961 | 1000 kg | ₺8.920 | ₺3.959 |
| livestock | Akyayla | Karma yemle süt | 60 dk | ₺7.768 | 1300 kg | ₺11.571 | ₺3.803 |
| livestock | Akyayla | Silaj ve kuru otla süt | 60 dk | ₺12.421 | 1150 kg | ₺10.247 | ₺-2.174 |
| livestock | Akyayla | Altlıktan gübre | 60 dk | ₺1.513 | 3000 kg | ₺450 | ₺-1.063 |
| livestock | Akyayla | Makineli sağım | 60 dk | ₺8.601 | 1650 kg | ₺14.654 | ₺6.053 |
| livestock | Yeşilova | Süt sağımı | 60 dk | ₺4.281 | 1000 kg | ₺7.625 | ₺3.344 |
| livestock | Yeşilova | Karma yemle süt | 60 dk | ₺7.529 | 1300 kg | ₺9.899 | ₺2.370 |
| livestock | Yeşilova | Silaj ve kuru otla süt | 60 dk | ₺12.157 | 1150 kg | ₺8.764 | ₺-3.394 |
| livestock | Yeşilova | Altlıktan gübre | 60 dk | ₺1.368 | 3000 kg | ₺330 | ₺-1.038 |
| livestock | Yeşilova | Makineli sağım | 60 dk | ₺8.373 | 1650 kg | ₺12.555 | ₺4.182 |
| mining | Demirdağ | Demir cevheri çıkarma | 60 dk | ₺3.300 | 4000 kg | ₺8.809 | ₺5.509 |
| mining | Demirdağ | Kömür çıkarma | 60 dk | ₺3.100 | 3000 kg | ₺8.214 | ₺5.114 |
| mining | Demirdağ | Bakır cevheri çıkarma | 60 dk | ₺3.475 | 3000 kg | ₺3.403 | ₺-73 |
| mining | Demirdağ | Mekanize demir | 60 dk | ₺4.308 | 6000 kg | ₺13.131 | ₺8.824 |
| mining | Demirdağ | Mekanize kömür | 60 dk | ₺4.083 | 4500 kg | ₺12.302 | ₺8.220 |
| mining | Demirdağ | Mekanize bakır | 60 dk | ₺4.483 | 4500 kg | ₺3.403 | ₺-1.080 |
| mining | Kavşak | Kömür çıkarma | 60 dk | ₺2.425 | 3000 kg | ₺7.371 | ₺4.946 |
| mining | Kavşak | Mekanize kömür | 60 dk | ₺3.572 | 4500 kg | ₺11.057 | ₺7.485 |
| manufacturing | Körfezkent | Un öğütme | 60 dk | ₺14.748 | 1500 kg | ₺19.134 | ₺4.387 |
| manufacturing | Körfezkent | Süt paketleme | 60 dk | ₺11.918 | 950 kg | ₺14.801 | ₺2.883 |
| manufacturing | Körfezkent | Peynir yapımı | 60 dk | ₺24.628 | 200 kg | ₺26.609 | ₺1.982 |
| manufacturing | Körfezkent | Kepekli öğütme | 60 dk | ₺7.483 | 950 kg | ₺0 | ₺-7.483 |
| manufacturing | Körfezkent | Bulgur kaynatma | 60 dk | ₺8.263 | 850 kg | ₺9.578 | ₺1.315 |
| manufacturing | Körfezkent | Makarna üretimi | 60 dk | ₺21.861 | 1000 kg | ₺23.812 | ₺1.951 |
| manufacturing | Körfezkent | Nişasta çekimi | 60 dk | ₺11.430 | 900 kg | ₺0 | ₺-11.430 |
| manufacturing | Körfezkent | Kutulu süt dolumu | 60 dk | ₺19.928 | 1000 kg | ₺15.565 | ₺-4.363 |
| manufacturing | Körfezkent | Cips üretimi | 60 dk | ₺21.124 | 600 kg | ₺19.740 | ₺-1.384 |
| manufacturing | Körfezkent | Fındık kavurma | 60 dk | ₺35.555 | 450 kg | ₺0 | ₺-35.555 |
| manufacturing | Körfezkent | Maya üretimi | 60 dk | ₺15.265 | 300 kg | ₺0 | ₺-15.265 |
| manufacturing | Körfezkent | Turşu kurma | 60 dk | ₺8.373 | 900 kg | ₺10.275 | ₺1.902 |
| manufacturing | Körfezkent | Hazır yemek hattı | 60 dk | ₺89.774 | 600 kg | ₺0 | ₺-89.774 |
| manufacturing | Körfezkent | Çuvallı un | 60 dk | ₺17.284 | 1600 kg | ₺20.383 | ₺3.099 |
| manufacturing | Demirdağ | Çelik dökümü | 60 dk | ₺12.370 | 1000 kg | ₺15.900 | ₺3.530 |
| manufacturing | Demirdağ | Konvertör çeliği | 60 dk | ₺28.339 | 1000 kg | ₺15.900 | ₺-12.439 |
| manufacturing | Demirdağ | Koklu çelik dökümü | 60 dk | ₺16.389 | 1150 kg | ₺18.246 | ₺1.857 |

Bağış girdileri (tohum 400 kg, yem 3000 kg, tahıl 2000 kg, cevher 2000 + kömür 1000 kg) her sektörde en az bir tam partiyi karşılar.

## 2. Sektör kârı (günlük işletme kârı ve 21 gün, N = 2, kalite ölçekli üst sınır, yatırımlar açgözlü)

21 günlük yörünge: her gün nakit yeterse geri dönüşü en kısa yatırım (bina seviyesi, tesis kalitesi, araştırma) alınır. Kâr = gelir − girdi − enerji/su/işçilik − bina bakımı.

| Sektör | Günlük kâr L1 | L2 | L3 | 21 gün işletme kârı | Yatırım harcaması | Alınan yatırımlar |
|---|---|---|---|---|---|---|
| Tarım: tahıl (Yeşilova) | ₺27.654 | ₺31.016 | ₺36.286 | ₺768.028 | ₺113.970 | g1:L2, g2:Q2, g3:RY1 |
| Hayvancılık: süt (Akyayla) | ₺36.886 | ₺46.351 | ₺50.274 | ₺1.260.957 | ₺282.920 | g1:L2, g2:Q2, g3:RY1, g4:RQ1 |
| Madencilik: kömür (Demirdağ) | ₺29.745 | ₺40.227 | ₺43.189 | ₺1.039.819 | ₺286.350 | g1:L2, g2:Q2, g3:RY1, g5:RQ1 |
| Madencilik: demir (Demirdağ) | ₺25.180 | ₺32.185 | ₺35.018 | ₺796.143 | ₺186.350 | g1:L2, g2:RY1, g3:Q2 |
| İmalat: un (Körfezkent) | ₺29.805 | ₺40.294 | ₺47.619 | ₺1.165.850 | ₺317.330 | g1:Q2, g3:RQ1, g6:L2 |
| İmalat: paketli süt (Körfezkent) | ₺27.055 | ₺38.758 | ₺45.299 | ₺1.169.471 | ₺317.330 | g1:Q2, g3:RQ1, g6:L2 |
| İmalat: peynir (Körfezkent) | ₺18.569 | ₺27.821 | ₺35.484 | ₺819.808 | ₺317.330 | g1:Q2, g5:L2, g8:RQ1 |
| İmalat: çelik (Demirdağ) | ₺23.718 | ₺31.536 | ₺39.325 | ₺1.000.004 | ₺277.080 | g1:Q2, g3:L2, g5:RQ1 |
| Taşımacılık: kamyon, sistem işleri (N = 2) | ₺38.420 (1 kamyon) | ₺38.120 (2 kamyon) | ₺37.820 (3 kamyon) | ₺797.515 | ₺360.000 | g3:kamyon, g8:kamyon |

Beş sektörün temsilcileri (tarım, hayvancılık, madencilik, imalat-un, imalat-çelik, taşımacılık) arasında en yüksek / en düşük 21 gün işletme kârı = ₺1.260.957 (livestock) / ₺768.028 (crop) = 1.64×. Hedef ≤ 2,2×.

Rakip sayısına duyarlılık (21 gün işletme kârı, ₺): bina seviyesi 3 yalnızca pazarı tek başına dolduran oyuncuya yarar.

| Sektör | N = 1 | N = 2 | N = 3 |
|---|---|---|---|
| Tarım: tahıl (Yeşilova) | ₺1.838.006 | ₺768.028 | ₺489.806 |
| Hayvancılık: süt (Akyayla) | ₺2.793.403 | ₺1.260.957 | ₺744.429 |
| Madencilik: kömür (Demirdağ) | ₺2.128.856 | ₺1.039.819 | ₺621.553 |
| İmalat: un (Körfezkent) | ₺2.724.220 | ₺1.165.850 | ₺695.195 |
| İmalat: çelik (Demirdağ) | ₺2.449.138 | ₺1.000.004 | ₺593.113 |
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
- Arpa: en yüksek normalleştirilmiş sistem alış 382 < en düşük sistem satış 540 kuruş/kg → zarar (doğru)
- Mısır: en yüksek normalleştirilmiş sistem alış 408 < en düşük sistem satış 576 kuruş/kg → zarar (doğru)
- Soya fasulyesi: en yüksek normalleştirilmiş sistem alış 765 < en düşük sistem satış 1080 kuruş/kg → zarar (doğru)
- Ayçiçeği tohumu: en yüksek normalleştirilmiş sistem alış 935 < en düşük sistem satış 1320 kuruş/kg → zarar (doğru)
- Şeker pancarı: en yüksek normalleştirilmiş sistem alış 153 < en düşük sistem satış 216 kuruş/kg → zarar (doğru)
- Saman: en yüksek normalleştirilmiş sistem alış 102 < en düşük sistem satış 144 kuruş/kg → zarar (doğru)
- Kütlü pamuk: en yüksek normalleştirilmiş sistem alış 1275 < en düşük sistem satış 1800 kuruş/kg → zarar (doğru)
- Keten sapı: en yüksek normalleştirilmiş sistem alış 1105 < en düşük sistem satış 1560 kuruş/kg → zarar (doğru)
- Kuru ot: en yüksek normalleştirilmiş sistem alış 501 < en düşük sistem satış 708 kuruş/kg → zarar (doğru)
- Ham yapağı: en yüksek normalleştirilmiş sistem alış 4564 < en düşük sistem satış 6444 kuruş/kg → zarar (doğru)
- Ahır gübresi: en yüksek normalleştirilmiş sistem alış 68 < en düşük sistem satış 96 kuruş/kg → zarar (doğru)
- Tomruk: en yüksek normalleştirilmiş sistem alış 382 < en düşük sistem satış 540 kuruş/kg → zarar (doğru)
- Bakır cevheri: en yüksek normalleştirilmiş sistem alış 510 < en düşük sistem satış 720 kuruş/kg → zarar (doğru)
- Kireçtaşı: en yüksek normalleştirilmiş sistem alış 102 < en düşük sistem satış 144 kuruş/kg → zarar (doğru)
- Kil: en yüksek normalleştirilmiş sistem alış 127 < en düşük sistem satış 180 kuruş/kg → zarar (doğru)
- Kuvars kumu: en yüksek normalleştirilmiş sistem alış 119 < en düşük sistem satış 168 kuruş/kg → zarar (doğru)
- Kaya tuzu: en yüksek normalleştirilmiş sistem alış 255 < en düşük sistem satış 360 kuruş/kg → zarar (doğru)
- Organik gübre: en yüksek normalleştirilmiş sistem alış 399 < en düşük sistem satış 564 kuruş/kg → zarar (doğru)

## 5. H6: yatırım geri dönüşü (başlangıç durumu: seviye 1, kalite 1, araştırma 0; N = 2)

| Sektör | Yatırım | Maliyet | Günlük kazanç | Geri dönüş (gün) |
|---|---|---|---|---|
| Tarım: tahıl (Yeşilova) | Tarla seviye 2 (en kısa) | ₺38.970 | ₺3.362 | 12 |
| Tarım: tahıl (Yeşilova) | tesis kalitesi 2 | ₺50.000 | ₺4.147 | 13 |
| Tarım: tahıl (Yeşilova) | kalite kontrol 1 | ₺100.000 | ₺4.147 | 25 |
| Tarım: tahıl (Yeşilova) | agronomy 1 | ₺25.000 | ₺1.845 | 14 |
| Hayvancılık: süt (Akyayla) | Ahır seviye 2 (en kısa) | ₺82.920 | ₺9.466 | 9 |
| Hayvancılık: süt (Akyayla) | tesis kalitesi 2 | ₺70.000 | ₺7.295 | 10 |
| Hayvancılık: süt (Akyayla) | kalite kontrol 1 | ₺100.000 | ₺7.295 | 14 |
| Hayvancılık: süt (Akyayla) | herd_health 1 | ₺30.000 | ₺2.927 | 11 |
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
| Körfezkent Perakende Zinciri | ₺1.181.000 | ₺912.660 | ₺1.140.658 |
| Körfezkent Sanayi Alım Ofisi | ₺626.000 | ₺483.908 | ₺604.789 |
| Körfezkent Hammadde Deposu | ₺20.000 | ₺0 | ₺0 |
| Yeşilova Sanayi Alım Ofisi | ₺43.000 | ₺32.885 | ₺41.088 |
| Yeşilova Hammadde Deposu | ₺20.000 | ₺0 | ₺0 |
| Akyayla Sanayi Alım Ofisi | ₺73.000 | ₺56.187 | ₺70.227 |
| Akyayla Hammadde Deposu | ₺20.000 | ₺0 | ₺0 |
| Demirdağ Perakende Zinciri | ₺256.000 | ₺198.130 | ₺247.560 |
| Demirdağ Sanayi Alım Ofisi | ₺645.000 | ₺498.020 | ₺622.384 |
| Demirdağ Hammadde Deposu | ₺20.000 | ₺0 | ₺0 |
| Kavşak Perakende Zinciri | ₺925.000 | ₺714.531 | ₺893.098 |
| Kavşak Sanayi Alım Ofisi | ₺554.000 | ₺428.273 | ₺535.314 |
| Kavşak Hammadde Deposu | ₺20.000 | ₺0 | ₺0 |

Toplam günlük bütçe tavanı ₺7.153.000; nominal alım değeri ₺5.305.998. Beklenen gerçek harcama (5 sektörden 2'şer oyuncu, seviye 2, + taşıma işleri): yaklaşık ₺962.337 (tavanın %13'i). Sistem parayı yalnızca oyuncu üretimine karşılık basar; bütçe tavandır, hedef değil.

## SORUNLAR

- ilk iş zararda: crop/yesilova/grow_barley (₺-2.912)
- ilk iş zararda: crop/yesilova/grow_corn (₺-2.558)
- ilk iş zararda: crop/yesilova/grow_soybean (₺-2.852)
- ilk iş zararda: crop/yesilova/grow_sunflower (₺-1.227)
- ilk iş zararda: crop/yesilova/grow_sugar_beet (₺-2.036)
- ilk iş zararda: crop/yesilova/save_seed (₺-6.290)
- ilk iş zararda: crop/yesilova/bale_straw (₺-942)
- ilk iş zararda: crop/yesilova/grow_corn_fert (₺-3.816)
- ilk iş zararda: crop/yesilova/grow_barley_fert (₺-4.170)
- ilk iş zararda: crop/kavsak/grow_barley (₺-3.651)
- ilk iş zararda: crop/kavsak/grow_corn (₺-3.435)
- ilk iş zararda: crop/kavsak/grow_soybean (₺-3.648)
- ilk iş zararda: crop/kavsak/grow_sunflower (₺-1.810)
- ilk iş zararda: crop/kavsak/grow_sugar_beet (₺-3.250)
- ilk iş zararda: crop/kavsak/save_seed (₺-7.055)
- ilk iş zararda: crop/kavsak/bale_straw (₺-1.229)
- ilk iş zararda: crop/kavsak/grow_corn_fert (₺-4.713)
- ilk iş zararda: crop/kavsak/grow_barley_fert (₺-4.929)
- ilk iş zararda: livestock/akyayla/milk_cows_silage (₺-2.174)
- ilk iş zararda: livestock/akyayla/collect_manure (₺-1.063)
- ilk iş zararda: livestock/yesilova/milk_cows_silage (₺-3.394)
- ilk iş zararda: livestock/yesilova/collect_manure (₺-1.038)
- ilk iş zararda: mining/demirdag/mine_copper (₺-73)
- ilk iş zararda: mining/demirdag/mine_copper_mech (₺-1.080)
- ilk iş zararda: manufacturing/korfezkent/sift_bran (₺-7.483)
- ilk iş zararda: manufacturing/korfezkent/make_corn_starch (₺-11.430)
- ilk iş zararda: manufacturing/korfezkent/pack_milk_carton (₺-4.363)
- ilk iş zararda: manufacturing/korfezkent/make_chips (₺-1.384)
- ilk iş zararda: manufacturing/korfezkent/roast_hazelnut (₺-35.555)
- ilk iş zararda: manufacturing/korfezkent/make_yeast (₺-15.265)
- ilk iş zararda: manufacturing/korfezkent/make_ready_meal (₺-89.774)
- ilk iş zararda: manufacturing/demirdag/convert_steel (₺-12.439)
