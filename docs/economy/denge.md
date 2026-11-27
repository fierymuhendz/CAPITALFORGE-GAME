# Denge simülasyonu (v3)

Başlangıç parası ₺150.000. Model: `packages/economy/sim/model.ts` (sistem doygunluk eğrileri, N rakip oyuncu, navlun, kalite, yatırım). Para kuruş/bigint; tablo ₺ gösterir.
Varsayılanlar: N = 2 oyuncu aynı pazarı paylaşır, sistem alış fiyatı kalite ölçekli üst sınırla, girdiler oyunculardan (alış ile satış arası orta fiyat + navlun) ya da sistemden en ucuzuna.

## 1. İlk iş (tempo tavanı 60 dk, seviye 1, tek parti, girdiler sistemden satın alınsa bile, N = 1)

Kapsam: girdisi hediye edilen ya da sistem toptancısında satılan (ya da girdisiz), araştırma kilidi olmayan ve çıktısını sistem alıcılarının günlük talebi tek partide karşılayabilen tarifler. Kapsam dışı tarifler (girdisi oyuncudan gelen, araştırma kilitli, çıktısı yalnızca oyunculara satılan ara mallar) bölüm 10'daki zincir kârlılığında denenir.

| Sektör | Şehir | Tarif | Süre | Maliyet | Çıktı | Gelir (navlun, komisyon sonrası) | Kâr |
|---|---|---|---|---|---|---|---|
| crop | Yeşilova | Yem bitkisi ekimi | 60 dk | ₺3.024 | 2400 kg | ₺6.277 | ₺3.253 |
| crop | Yeşilova | Tahıl ekimi | 60 dk | ₺4.710 | 2000 kg | ₺10.354 | ₺5.644 |
| crop | Yeşilova | Patates ekimi | 60 dk | ₺8.075 | 4000 kg | ₺12.355 | ₺4.281 |
| crop | Yeşilova | Soğan ekimi | 60 dk | ₺3.097 | 3000 kg | ₺11.030 | ₺7.933 |
| crop | Kavşak | Yem bitkisi ekimi | 60 dk | ₺3.430 | 2400 kg | ₺5.107 | ₺1.677 |
| crop | Kavşak | Tahıl ekimi | 60 dk | ₺5.378 | 2000 kg | ₺8.606 | ₺3.228 |
| crop | Kavşak | Patates ekimi | 60 dk | ₺9.071 | 4000 kg | ₺10.532 | ₺1.461 |
| crop | Kavşak | Soğan ekimi | 60 dk | ₺3.710 | 3000 kg | ₺9.286 | ₺5.576 |
| livestock | Akyayla | Süt sağımı | 60 dk | ₺4.961 | 1000 kg | ₺8.920 | ₺3.959 |
| livestock | Yeşilova | Süt sağımı | 60 dk | ₺4.281 | 1000 kg | ₺7.625 | ₺3.344 |
| mining | Demirdağ | Demir cevheri çıkarma | 60 dk | ₺3.300 | 4000 kg | ₺8.809 | ₺5.509 |
| mining | Demirdağ | Kömür çıkarma | 60 dk | ₺3.100 | 3000 kg | ₺8.214 | ₺5.114 |
| mining | Kavşak | Kömür çıkarma | 60 dk | ₺2.425 | 3000 kg | ₺7.371 | ₺4.946 |
| manufacturing | Körfezkent | Un öğütme | 60 dk | ₺14.748 | 1500 kg | ₺19.134 | ₺4.387 |
| manufacturing | Körfezkent | Süt paketleme | 60 dk | ₺11.918 | 950 kg | ₺14.801 | ₺2.883 |
| manufacturing | Körfezkent | Peynir yapımı | 60 dk | ₺24.628 | 200 kg | ₺26.609 | ₺1.982 |
| manufacturing | Körfezkent | Bulgur kaynatma | 60 dk | ₺8.263 | 850 kg | ₺9.578 | ₺1.315 |
| manufacturing | Demirdağ | Çelik dökümü | 60 dk | ₺12.370 | 1000 kg | ₺15.900 | ₺3.530 |

Kapsam dışı (31 tarif): sistem günlük talebi tek partiden küçük (oyunculara satılan ara mal): grow_barley, grow_corn, grow_soybean, grow_sunflower, grow_sugar_beet, save_seed, bale_straw, collect_manure, mine_copper, sift_bran, make_corn_starch; araştırma kilitli: grow_grain_fert, grow_corn_fert, grow_barley_fert, grow_potato_fert, milk_cows_machine, mine_iron_mech, mine_coal_mech, mine_copper_mech, smelt_steel_coke; girdisi sistemde satılmıyor (oyuncudan gelir): milk_cows_compound, milk_cows_silage, make_pasta, pack_milk_carton, make_chips, roast_hazelnut, make_yeast, make_pickles, make_ready_meal, mill_flour_sacked, convert_steel.

Bağış girdileri (tohum 400 kg, yem 3000 kg, tahıl 2000 kg, cevher 2000 + kömür 1000 kg) her sektörde en az bir tam partiyi karşılar. Maden arsası seçimi `depositFits` ile binanın kabul ettiği yatağa bakar.


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
| Körfezkent Perakende Zinciri | ₺1.785.000 | ₺1.379.596 | ₺1.724.321 |
| Körfezkent Sanayi Alım Ofisi | ₺755.000 | ₺583.445 | ₺729.204 |
| Körfezkent Hammadde Deposu | ₺20.000 | ₺0 | ₺0 |
| Yeşilova Sanayi Alım Ofisi | ₺43.000 | ₺32.885 | ₺41.088 |
| Yeşilova Hammadde Deposu | ₺20.000 | ₺0 | ₺0 |
| Akyayla Sanayi Alım Ofisi | ₺73.000 | ₺56.187 | ₺70.227 |
| Akyayla Hammadde Deposu | ₺20.000 | ₺0 | ₺0 |
| Demirdağ Perakende Zinciri | ₺269.000 | ₺207.793 | ₺259.639 |
| Demirdağ Sanayi Alım Ofisi | ₺729.000 | ₺562.969 | ₺703.565 |
| Demirdağ Hammadde Deposu | ₺20.000 | ₺0 | ₺0 |
| Kavşak Perakende Zinciri | ₺1.517.000 | ₺1.171.803 | ₺1.464.682 |
| Kavşak Sanayi Alım Ofisi | ₺730.000 | ₺564.405 | ₺705.472 |
| Kavşak Hammadde Deposu | ₺20.000 | ₺0 | ₺0 |

Toplam günlük bütçe tavanı ₺8.751.000; nominal alım değeri ₺6.540.487. Beklenen gerçek harcama (5 sektörden 2'şer oyuncu, seviye 2, + taşıma işleri): yaklaşık ₺962.337 (tavanın %10'i). Sistem parayı yalnızca oyuncu üretimine karşılık basar; bütçe tavandır, hedef değil.

## 10. Zincir kârlılığı (her tarif, her şehir; en kötü şehir)

Her tarifin bir partisi: girdiler referans fiyatla (oyuncudan) alınır; çıktı (a) sisteme bid fiyatından (nihai mal %85, sanayi ofisinin ara mal teklifi %75, üst sınır dahil) ya da (b) oyuncuya referans fiyattan, %1 komisyonla satılır. Maliyet = girdi + enerji + su + işçilik + günlük bakımın 1/12'si. Navlun yok (pazar simülasyonu ayrıca hesaplar).

| Düzeltilen tarif | Eski (girdi → çıktı kg) | Yeni | Oyuncuya satış marjı eski → yeni | Sisteme satış kârı eski → yeni (₺/parti) | En kötü şehir |
|---|---|---|---|---|---|
| milk_cows_silage | silage 900 + hay 300 → 1150 | silage 550 + hay 200 → 1150 | %-19.7 → %21.3 | ₺-3.450 → ₺220 | Akyayla |
| mix_compound_feed_cotton | barley 600 + cottonseed 400 + bran 200 → 1150 | barley 700 + cottonseed 50 + bran 80 → 1150 | %-50.6 → %47.1 | ₺-13.948 → ₺767 | Körfezkent |
| mix_compound_feed_beet | barley 700 + molasses 150 + beet_pulp 350 → 1150 | barley 480 + molasses 100 + beet_pulp 300 → 1150 | %2.5 → %34.2 | ₺-2.468 → ₺52 | Körfezkent |
| pack_milk_carton | raw_milk 1000 + milk_carton 40 → 1000 | raw_milk 1000 + milk_carton 15 → 1000 | %-5.8 → %28.1 | ₺-3.252 → ₺1.063 | Kavşak |
| make_yogurt_sheep | sheep_milk 800 → 950 | sheep_milk 540 → 950 | %-12.3 → %25.9 | ₺-4.240 → ₺804 | Körfezkent |
| make_cheese_sheep | sheep_milk 1200 + salt 20 → 220 | sheep_milk 1000 + salt 20 → 230 | %3.4 → %27.9 | ₺-3.034 → ₺1.845 | Akyayla |
| make_pickles_cannery | pepper 700 + salt 50 + glass_jar 100 → 850 | pepper 650 + salt 50 + glass_jar 90 → 900 | %11.9 → %26.3 | ₺-467 → ₺665 | Demirdağ |
| build_pallet_beam | timber_beam 220 + fasteners 3 → 200 | timber_beam 210 + fasteners 3 → 210 | %33.2 → %44.8 | ₺-3 → ₺369 | Demirdağ |
| build_crate_ply | plywood 140 + fasteners 2 → 150 | plywood 90 + fasteners 2 → 160 | %-7.5 → %40.8 | ₺-1.588 → ₺202 | Demirdağ |
| convert_steel | pig_iron 1100 + limestone 100 → 1000 | pig_iron 480 + limestone 100 → 1000 | %-31.9 → %35.8 | ₺-10.485 → ₺1.915 | Demirdağ |
| machine_parts_cast | castings 350 + lubricant 5 → 300 | castings 200 + lubricant 4 → 300 | %-13.6 → %38.4 | ₺-6.562 → ₺446 | Körfezkent |
| cut_gears_cast | castings 260 + lubricant 3 → 220 | castings 140 + lubricant 2 → 220 | %-12.8 → %45.1 | ₺-4.889 → ₺748 | Körfezkent |
| blend_biodiesel_tallow | tallow 800 + methanol 100 + caustic_soda 10 → 820 | tallow 450 + methanol 80 + caustic_soda 10 → 820 | %-28.7 → %20.7 | ₺-38.352 → ₺1.511 | Körfezkent |
| cook_glue_hide | hide 100 → 150 | hide 12 → 150 | %-70.7 → %36.3 | ₺-11.940 → ₺72 | Demirdağ |
| refine_lubricant_tallow | tallow 300 + caustic_soda 10 → 220 | tallow 200 + caustic_soda 10 → 220 | %-3.5 → %41.5 | ₺-9.513 → ₺1.437 | Körfezkent |
| fire_brick_charcoal | clay 2000 + charcoal 120 → 1800 | clay 2000 + charcoal 120 → 1950 | %10.6 → %19.8 | ₺-582 → ₺176 | Körfezkent |

262 tarifin 261'i oyuncuya referans fiyattan satışta, 260/261'i sistem teklifiyle kârlı. Oyuncuya satış marjı en düşük %-72.9, ortanca %50.7. Bilinçli istisna: recycle_pulp (kütle korunumu: çıktı ≤ girdi; karton fiyatı hamurun ~2,9 katı, kâr yapınca karton-kraft-hamur döngüsü kütle üretirdi).

## 11. Pazar simülasyonu (ajan tabanlı, 7 gün, saatlik adım, sabit tohum)

Model: `packages/economy/sim/market.ts`. Sistem şirketleri (sınırlı günlük arz, bütçeli talep, oyuncular arası 24 sa hacme göre `systemShareFactorBp` ile küçülme, saatlik referans kayması) ve N oyuncu; 18 üretim hattı (arpa, mısır, karma yem, süt, paketli süt, tahıl, un, demir, kömür, çelik, inşaat demiri, patates, yem bitkili süt, pamuk çırçırı, iplik, havlu, fındık hasadı, fındık kavurma), tek kopya (1 ve 4 oyuncu) ya da iki kopya (16 oyuncu). Hatlar oyunculara sırayla dağıtılır; tek oyuncuda hepsi aynı kişidedir ve aralarındaki alışveriş "iç aktarım" sayılır (sistem payını azaltmaz, sunucudaki bağlantı grubu kuralı). Alıcı ve satıcı emirleri yaşlandıkça birbirine yaklaşır (alış %85'ten saatte %3 yükselir; satış sistemin net alışına +%20'den 8 saatte iner), eşleşmede fiyat ortadadır, alıcı navlunu (kendi kamyonu), satıcı %1 komisyonu öder; satıcı sistemin net alışına ulaşınca ya da alıcı sistem satışının teslim maliyetine ulaşınca sistemle işlem yapılır. Saat 0-24 ısınma; A = saat 24-72 normal, B = saat 72-120 olay, C = 120-168 toparlanma.

Olaylar. Kıtlık: arpa ve mısır hatları B boyunca kapalı, bu hatların satılmamış stoğu yok olur, sistem depolarının arpa/mısır arzı %70 kesilir. Fazla üretim: demir, kömür, çelik ve inşaat demiri hatlarının kapasitesi B boyunca 3 katına çıkar.

### 11.1 Senaryo ölçüleri (katalog değerleriyle)

Fiyat endeksi = gerçekleşen satış fiyatı / aynı şehirde taban referans (kayma 10000, %100 = referans); ort = pencere ağırlıklı ortalama, son = pencerenin son satışı. Satış süresi = çıktının üretimden satışa kg ağırlıklı saati. Dolan emir oranı = doldurulan kg / verilen emir kg (alış + satış). p2p payı = oyuncular arası kg / tüm işlem kg. Sistemin bastığı para = sistemin oyunculara ödediği − oyunculardan aldığı, ₺/gün.

| Senaryo | Odak ürün | Fiyat ort (A → B → C) | Fiyat son (B) | Satış süresi sa (A → B → C) | Dolan emir A → B | p2p payı | En kârlı iş kolu ₺/hat-gün | En zayıf iş kolu | Sistem net para ₺/gün |
|---|---|---|---|---|---|---|---|---|---|
| tek oyuncu (1) / kıtlık | Karma yem | %59.9 → %61 → %61.4 | %50.5 | 8.9 → 12.6 → 5.7 | 0.97 → 1.00 | %0 | maden-metal ₺26.516 | yem ₺3.384 | ₺382.489 |
| tek oyuncu (1) / fazla üretim | Çelik | %79.7 → %79 → %73.2 | %55.4 | 7.9 → 6.3 → 8.9 | 1.00 → 0.99 | %0 | maden-metal ₺40.116 | süt-gıda ₺4.919 | ₺467.767 |
| az oyuncu (4) / kıtlık | Karma yem | %63.1 → %64.1 → %61.6 | %50.2 | 6.6 → 12.1 → 6.4 | 0.97 → 1.00 | %29 | maden-metal ₺27.920 | yem ₺4.105 | ₺378.424 |
| az oyuncu (4) / fazla üretim | Çelik | %79.1 → %77.4 → %72.4 | %55.8 | 7.0 → 6.2 → 8.4 | 1.00 → 0.99 | %34 | maden-metal ₺41.510 | süt-gıda ₺4.107 | ₺486.777 |
| yoğun (16) / kıtlık | Karma yem | %57.3 → %57 → %55.7 | %51.6 | 6.9 → 24.7 → 15.4 | 0.96 → 0.99 | %30 | maden-metal ₺15.736 | süt-gıda ₺1.117 | ₺538.093 |
| yoğun (16) / fazla üretim | Çelik | %70.8 → %76.8 → %69 | %56.4 | 7.4 → 6.6 → 16.5 | 0.98 → 0.98 | %32 | maden-metal ₺21.504 | yem ₺402 | ₺568.067 |

### 11.2 Olay etkisi (zincir ürünleri)

Üretim kg/gün (A / B / C), fiyat endeksi ort (A / B / C), satış süresi sa (A / B / C).

| Senaryo | Ürün | Üretim kg/gün | Fiyat ort | Satış süresi sa |
|---|---|---|---|---|
| tek oyuncu (1) / kıtlık | Arpa | 4400 / 0 / 6600 | %61.4 / — / %78.4 | 20.3 / — / 5.7 |
| tek oyuncu (1) / kıtlık | Mısır | 3900 / 0 / 7800 | %61.5 / — / %70.3 | 22.3 / — / 10.1 |
| tek oyuncu (1) / kıtlık | Karma yem | 5175 / 2875 / 6325 | %59.9 / %61 / %61.4 | 8.9 / 12.6 / 5.7 |
| tek oyuncu (1) / kıtlık | Çiğ süt | 16050 / 13450 / 16050 | %73.2 / %72.7 / %75.3 | 7.4 / 6.9 / 7.5 |
| tek oyuncu (1) / fazla üretim | Demir cevheri | 34500 / 117300 / 34500 | %80.5 / %75.4 / %72.2 | 7.7 / 7.4 / 8.0 |
| tek oyuncu (1) / fazla üretim | Çelik | 8500 / 23500 / 8000 | %79.7 / %79 / %73.2 | 7.9 / 6.3 / 8.9 |
| tek oyuncu (1) / fazla üretim | İnşaat demiri | 970 / 3880 / 0 | %71.4 / %70.8 / %70.9 | 24.5 / 50.8 / 59.2 |
| tek oyuncu (1) / fazla üretim | Kömür | 27600 / 89700 / 25875 | %78.6 / %73.6 / %75.7 | 7.9 / 7.7 / 7.7 |
| az oyuncu (4) / kıtlık | Arpa | 5500 / 0 / 6600 | %67.7 / — / %80.1 | 17.3 / — / 7.2 |
| az oyuncu (4) / kıtlık | Mısır | 5200 / 0 / 7800 | %67.6 / — / %75.2 | 19.9 / — / 12.8 |
| az oyuncu (4) / kıtlık | Karma yem | 5175 / 2875 / 7475 | %63.1 / %64.1 / %61.6 | 6.6 / 12.1 / 6.4 |
| az oyuncu (4) / kıtlık | Çiğ süt | 17350 / 13950 / 16850 | %73.1 / %72.7 / %73.7 | 7.1 / 6.7 / 7.1 |
| az oyuncu (4) / fazla üretim | Demir cevheri | 39100 / 108100 / 39100 | %82.4 / %81.1 / %73.9 | 7.5 / 6.9 / 8.9 |
| az oyuncu (4) / fazla üretim | Çelik | 9000 / 26000 / 9000 | %79.1 / %77.4 / %72.4 | 7.0 / 6.2 / 8.4 |
| az oyuncu (4) / fazla üretim | İnşaat demiri | 970 / 3880 / 0 | %71.2 / %70.8 / %70.9 | 27.9 / 51.3 / 59.2 |
| az oyuncu (4) / fazla üretim | Kömür | 27600 / 84525 / 25875 | %80.3 / %77.3 / %75.8 | 7.7 / 7.4 / 7.9 |
| yoğun (16) / kıtlık | Arpa | 6600 / 0 / 9900 | %65.4 / — / %71.6 | 13.0 / — / 12.2 |
| yoğun (16) / kıtlık | Mısır | 7800 / 0 / 10400 | %66.6 / — / %69.8 | 9.5 / — / 15.2 |
| yoğun (16) / kıtlık | Karma yem | 6325 / 3450 / 6900 | %57.3 / %57 / %55.7 | 6.9 / 24.7 / 15.4 |
| yoğun (16) / kıtlık | Çiğ süt | 19500 / 15750 / 17700 | %69.6 / %72.8 / %71.2 | 7.4 / 5.8 / 6.9 |
| yoğun (16) / fazla üretim | Demir cevheri | 78200 / 144900 / 41400 | %49.9 / %46.4 / %55 | 7.2 / 9.0 / 18.9 |
| yoğun (16) / fazla üretim | Çelik | 17500 / 35000 / 10500 | %70.8 / %76.8 / %69 | 7.4 / 6.6 / 16.5 |
| yoğun (16) / fazla üretim | İnşaat demiri | 970 / 6790 / 0 | %71.2 / %70.9 / %70.8 | 27.2 / 69.2 / 108.1 |
| yoğun (16) / fazla üretim | Kömür | 56925 / 108675 / 46575 | %48.7 / %46.6 / %55.5 | 7.3 / 8.6 / 14.7 |

### 11.3 İş kolu kârlılığı (₺/hat-gün, 7 gün; kâr = gelir − girdi − enerji/su/işçilik − bakım − navlun − komisyon + kapanış stoğu maliyetle)

| Senaryo | tarla ürünleri | yem | hayvancılık | süt-gıda | tekstil | maden-metal |
|---|---|---|---|---|---|---|
| tek oyuncu (1) / kıtlık | ₺10.621 | ₺3.384 | ₺4.869 | ₺4.103 | ₺8.557 | ₺26.516 |
| tek oyuncu (1) / fazla üretim | ₺10.513 | ₺5.582 | ₺6.060 | ₺4.919 | ₺8.279 | ₺40.116 |
| az oyuncu (4) / kıtlık | ₺10.235 | ₺4.105 | ₺4.532 | ₺4.480 | ₺8.065 | ₺27.920 |
| az oyuncu (4) / fazla üretim | ₺11.065 | ₺6.469 | ₺4.895 | ₺4.107 | ₺8.284 | ₺41.510 |
| yoğun (16) / kıtlık | ₺7.878 | ₺1.470 | ₺2.659 | ₺1.117 | ₺4.812 | ₺15.736 |
| yoğun (16) / fazla üretim | ₺8.699 | ₺402 | ₺2.680 | ₺2.055 | ₺4.855 | ₺21.504 |

### 11.4 Darboğaz ve düzeltme: önce / sonra

Bulgu: nihai mal talebi ₺ bütçesine göre belirlendiğinden değerli ve ağır mallarda bütçe tek bir partiyi bile almıyor (85 nihai maldan 21'inde sistem talebi, oyuncu sayısından bağımsız olarak günde 1 partinin altında; ör. sucuk 0,14, dana eti 0,24, konteyner 0,34, havlu 0,71 parti/gün); ilk parti sistem alıcısına sığmıyor, satış süresi uzuyor, hat stok sınırında boşta kalıyor. Düzeltme: `V4_DEMAND_BUDGET.finalMinBatchesPerCity` 0 → 0.6 (şehir başına en az bu kadar parti; iki şehirde ≥ 1,2 parti/gün). Sistem günlük bütçe tavanı ₺7.153.000 → ₺8.751.000; sistem payı küçüldükçe (oyuncu hacmi arttıkça) bu destek de küçülür.

| Ölçü | Önce (0) | Sonra (0.6) |
|---|---|---|
| Sistem talebi < 1 parti/gün olan nihai mal | 21 / 85 | 0 / 85 |
| tek oyuncu (1) / kıtlık: Havlu satış süresi sa / üretim kg/gün / haftalık kâr | 48.7 / 560 / ₺4.894 | 28.1 / 560 / ₺18.409 |
| tek oyuncu (1) / fazla üretim: Havlu satış süresi sa / üretim kg/gün / haftalık kâr | 48.9 / 560 / ₺4.814 | 28.3 / 560 / ₺18.744 |
| az oyuncu (4) / kıtlık: Havlu satış süresi sa / üretim kg/gün / haftalık kâr | 48.9 / 560 / ₺4.851 | 28.3 / 560 / ₺19.751 |
| az oyuncu (4) / fazla üretim: Havlu satış süresi sa / üretim kg/gün / haftalık kâr | 48.9 / 560 / ₺4.810 | 28.3 / 560 / ₺18.503 |
| yoğun (16) / kıtlık: Havlu satış süresi sa / üretim kg/gün / haftalık kâr | 30.4 / 560 / ₺-955 | 23.5 / 560 / ₺3.523 |
| yoğun (16) / fazla üretim: Havlu satış süresi sa / üretim kg/gün / haftalık kâr | 38.4 / 560 / ₺-727 | 29.9 / 560 / ₺5.327 |
| tek oyuncu (1) / kıtlık: Kavrulmuş fındık satış süresi sa / üretim kg/gün / haftalık kâr | 47.0 / 743 / ₺4.344 | 38.6 / 990 / ₺6.088 |
| tek oyuncu (1) / fazla üretim: Kavrulmuş fındık satış süresi sa / üretim kg/gün / haftalık kâr | 46.1 / 743 / ₺4.266 | 39.0 / 990 / ₺4.215 |
| az oyuncu (4) / kıtlık: Kavrulmuş fındık satış süresi sa / üretim kg/gün / haftalık kâr | 47.1 / 743 / ₺7.080 | 38.8 / 990 / ₺6.866 |
| az oyuncu (4) / fazla üretim: Kavrulmuş fındık satış süresi sa / üretim kg/gün / haftalık kâr | 46.7 / 990 / ₺5.414 | 38.2 / 1238 / ₺6.121 |
| yoğun (16) / kıtlık: Kavrulmuş fındık satış süresi sa / üretim kg/gün / haftalık kâr | 54.2 / 990 / ₺2.135 | 51.5 / 1485 / ₺-391 |
| yoğun (16) / fazla üretim: Kavrulmuş fındık satış süresi sa / üretim kg/gün / haftalık kâr | 47.8 / 990 / ₺1.306 | 45.8 / 1485 / ₺924 |
| tek oyuncu (1) / kıtlık: tüm ürünlerde satış süresi sa / dolan emir oranı / sistem net ₺/gün | 8.8 / 0.93 / ₺357.608 | 8.7 / 0.93 / ₺382.489 |
| tek oyuncu (1) / fazla üretim: tüm ürünlerde satış süresi sa / dolan emir oranı / sistem net ₺/gün | 9.4 / 0.95 / ₺441.455 | 9.3 / 0.95 / ₺467.767 |
| az oyuncu (4) / kıtlık: tüm ürünlerde satış süresi sa / dolan emir oranı / sistem net ₺/gün | 8.2 / 0.93 / ₺350.776 | 8.1 / 0.93 / ₺378.424 |
| az oyuncu (4) / fazla üretim: tüm ürünlerde satış süresi sa / dolan emir oranı / sistem net ₺/gün | 9.0 / 0.95 / ₺459.115 | 9.0 / 0.96 / ₺486.777 |
| yoğun (16) / kıtlık: tüm ürünlerde satış süresi sa / dolan emir oranı / sistem net ₺/gün | 8.3 / 0.92 / ₺510.853 | 8.4 / 0.92 / ₺538.093 |
| yoğun (16) / fazla üretim: tüm ürünlerde satış süresi sa / dolan emir oranı / sistem net ₺/gün | 11.2 / 0.94 / ₺539.204 | 11.2 / 0.94 / ₺568.067 |

### 11.5 Denetimler

- Tek küçük işlem sistem desteğini kapatmaz: her (sistem şirketi, ürün, alış/satış) için günlük hacmin %10'u (en çok 250 kg) kadar bir oyuncu işleminden sonra destek ≥ %90 ve en az 1 kg: 357/357. Destek, oyuncu payının %80'i kadar küçülür, taban %20. Karşılaştırma: 1000 kg'lık bir oyuncu işlemi 318/357 çifti %90'ın altına, en kötü %22'e indirir (yine hiçbiri kapanmaz: kapanan 0); küçük günlük hacimli ara mallarda bir parti bile sistem desteğini azaltır, tasarım gereği.
- Sistemden al, sisteme sat (sıfır doygunluk, kalite 2, dolu kamyon navlunu, %1 komisyon, her satış-alış şehri çifti, 77 çift): en iyi tur -37 kuruş/kg (manure: supply_akyayla → industry_akyayla) → zararlı (doğru).
- Para korunumu (her senaryoda): oyuncu nakit değişimi = sistemden alınan − sisteme ödenen − komisyon − navlun − enerji/su/işçilik − bakım. Sistem harcaması 7 günde en çok ₺61.257.000 (günlük tavan ₺8.751.000); senaryolarda gerçekleşen ₺5.235.931 üst sınır.

## Sonuç

Tüm denetimler geçti: ilk iş kapsamındaki her tarif kârlı ve bağışla/sistem girdisiyle karşılanır, beş sektör de 21 günde kâr eder (en yüksek / en düşük ≤ 2,2×), her tarif zincirde kârlıdır (istisna belgelidir), pazar simülasyonunda (1, 4, 16 oyuncu; kıtlık ve fazla üretim) her iş kolu kâr eder ve para korunur, sistem arbitrajı yok, tek küçük işlem sistem desteğini kapatmaz, spot/sözleşme, tedarikçi ve taşımacı kararları parametreyle çevrilir.
