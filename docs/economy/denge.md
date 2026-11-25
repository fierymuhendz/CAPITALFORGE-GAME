# Denge simülasyonu

Başlangıç parası ₺150.000. Fiyatlar referans (sistem alış = ref × %85).

## İlk iş (seviye 1, tek parti, en iyi uygun arsa)

| Sektör | Şehir | Tarif | Süre | Maliyet | Çıktı | En iyi alıcı | Gelir (navlun sonrası) | Kâr |
|---|---|---|---|---|---|---|---|---|
| crop | Yeşilova | Yem bitkisi ekimi | 63 dk | ₺3.024 | 2662 kg | Yeşilova Toptan (0 km) | ₺5.084 | ₺2.060 |
| crop | Yeşilova | Tahıl ekimi | 126 dk | ₺4.706 | 2218 kg | Yeşilova Toptan (0 km) | ₺8.473 | ₺3.767 |
| crop | Kavşak | Yem bitkisi ekimi | 60 dk | ₺3.430 | 2332 kg | Kavşak Toptan (0 km) | ₺4.944 | ₺1.514 |
| crop | Kavşak | Tahıl ekimi | 120 dk | ₺5.370 | 1944 kg | Kavşak Toptan (0 km) | ₺8.262 | ₺2.892 |
| livestock | Akyayla | Süt sağımı | 66 dk | ₺4.906 | 1077 kg | Akyayla Toptan (0 km) | ₺7.001 | ₺2.095 |
| livestock | Yeşilova | Süt sağımı | 63 dk | ₺4.235 | 1116 kg | Kavşak Toptan (90 km) | ₺5.496 | ₺1.261 |
| mining | Demirdağ | Demir cevheri çıkarma | 69 dk | ₺3.300 | 4830 kg | Demirdağ Toptan (0 km) | ₺6.279 | ₺2.979 |
| mining | Demirdağ | Kömür çıkarma | 69 dk | ₺3.100 | 3450 kg | Demirdağ Toptan (0 km) | ₺5.451 | ₺2.351 |
| mining | Kavşak | Kömür çıkarma | 60 dk | ₺2.425 | 2700 kg | Kavşak Termik Santrali (0 km) | ₺4.833 | ₺2.408 |
| manufacturing | Körfezkent | Un öğütme | 54 dk | ₺14.205 | 1650 kg | Körfezkent Tüketici Kooperatifi (0 km) | ₺15.890 | ₺1.685 |
| manufacturing | Körfezkent | Süt paketleme | 54 dk | ₺11.720 | 1045 kg | Körfezkent Tüketici Kooperatifi (0 km) | ₺13.679 | ₺1.959 |
| manufacturing | Körfezkent | Peynir yapımı | 108 dk | ₺23.700 | 220 kg | Körfezkent Tüketici Kooperatifi (0 km) | ₺26.880 | ₺3.180 |
| manufacturing | Demirdağ | Çelik dökümü | 207 dk | ₺9.375 | 1000 kg | Ulusal İnşaat Kavşak (150 km) | ₺11.187 | ₺1.812 |

## Navlun: düşük fiyat + uzak tedarikçi

10 t tahıl Kavşak'a: Yeşilova'dan ₺5,00/kg + navlun ₺2.610 = ₺52.610 (84 dk); Demirdağ'dan ₺4,70/kg + navlun ₺4.248 = ₺51.248 (139 dk).

## Sistem arbitrajı denetimi

- Yem bitkisi: en yüksek sistem alış 216 kuruş/kg < en düşük sistem satış 270 kuruş/kg → zarar (doğru)
- Tahıl: en yüksek sistem alış 432 kuruş/kg < en düşük sistem satış 540 kuruş/kg → zarar (doğru)
- Çiğ süt: en yüksek sistem alış 734 kuruş/kg < en düşük sistem satış 918 kuruş/kg → zarar (doğru)
- Demir cevheri: en yüksek sistem alış 130 kuruş/kg < en düşük sistem satış 183 kuruş/kg → zarar (doğru)
- Kömür: en yüksek sistem alış 179 kuruş/kg < en düşük sistem satış 224 kuruş/kg → zarar (doğru)
- Çelik: en yüksek sistem alış 1683 kuruş/kg < en düşük sistem satış 2203 kuruş/kg → zarar (doğru)

## Bina yatırım geri dönüşü (seviye 2, tam kapasite)

- Tarla: yükseltme ₺70.000 + 3 t çelik (₺59.400), parti kapasitesi 2→3, hat 1→2, günlük bakım ₺400→₺900
- Ahır: yükseltme ₺90.000 + 4 t çelik (₺79.200), parti kapasitesi 2→3, hat 1→2, günlük bakım ₺600→₺1.300
- Maden ocağı: yükseltme ₺100.000 + 5 t çelik (₺99.000), parti kapasitesi 2→3, hat 1→2, günlük bakım ₺700→₺1.500
- Gıda fabrikası: yükseltme ₺120.000 + 6 t çelik (₺118.800), parti kapasitesi 2→3, hat 1→2, günlük bakım ₺800→₺1.700
- Çelikhane: yükseltme ₺130.000 + 6 t çelik (₺118.800), parti kapasitesi 2→3, hat 1→2, günlük bakım ₺900→₺1.900

Piyasa komisyonu %1; ₺100 / ₺10.000.

## Sonuç

Tüm denetimler geçti: her sektörün ilk işi başlangıç parasıyla yapılabilir ve sistem alıcısına satışta bile kârlıdır (girdiler sistemden satın alınsa dahi), tek iş günlük bakımı karşılar, her çıktının sistem alıcısı var, sistem arbitrajı yok.
