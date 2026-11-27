# v4 ekonomi genişlemesi

Durum: uygulandı. Katalog `packages/shared/src/catalog/v4-*.ts`, pazar istatistiği `apps/server/src/market/stats.ts`, araştırma etkileri `apps/server/src/production/eval.ts`, simülasyon `packages/economy/sim/{market,chain}.ts`, çıktı `docs/economy/denge.md`.

## Önce / sonra

| | Önce (main, 7539812) | Sonra |
|---|---|---|
| Ticari ürün | 10 | 203 |
| İşlevsel bina türü | 6 | 45 |
| Çalışır reçete | 9 | 262 |
| Araştırma | 7 (dal yok, önkoşul yok) | 64 (14 dal, önkoşul grafiği) |
| İş kolu | 5 sektör | 13 iş kolu |
| Yatak türü | 2 (demir, kömür) | 7 (+ bakır, kireçtaşı, kil, kum, tuz) |
| Arsa | 80 (16/şehir) | 180 (+100 sahipsiz halka arsası, `<şehir>-oXY`) |
| Sistem profilleri | v3 alıcı/satıcılar | + şehir başına perakende, sanayi ve toptancı ofisi |
| Alıcısı olmayan mal | yok (10 mal) | 0 (yalnızca `seed` reçetede tüketilir) |
| Araştırma etkisi | verim, verimlilik, sürüş | + bina verimi/verimliliği, enerji, girdi tasarrufu, süre, kapasite, kalite, reçete kilidi |

Önceki bulgular: peynir yalnızca kendi sütüyle kârlıydı (M=1,32); oyuncu girdileri (tohum, yem, cevher) yalnızca sistemden geliyordu; pazar ekranında en iyi teklif ile gerçekleşen fiyat ayrı değildi; oyuncular arası pay gösterilmiyordu.

Gerçek satış verisi: canlı dünyada 80 arsadan 3'ü sahipli (2 oyuncu şirketi, 1 doğrulama şirketi). Dengeyi ölçecek oyuncu satış hacmi yok; denge simülasyonla gösterildi.

## Üç tedarik zinciri

1. **Arpa + mısır → karma yem → çiğ süt → peynir.** Arpa/mısır: Yeşilova ve Kavşak sistem toptancısı ya da oyuncu tarlası (`grow_barley`, `grow_corn`). Yem fabrikası `mix_compound_feed`, ahır `milk_cows_compound`, gıda tesisi peynir. Tüketim: perakende ofisleri (peynir), sanayi ofisi ara mal alımı. Oyuncu neden alır: karma yem ahırda yem bitkisinden daha çok süt verir.
2. **Pamuk → iplik → kumaş → iş kıyafeti.** Pamuk: Yeşilova toptancısı ya da lif çiftliği. Çırçır ve iplik fabrikası, dokuma, konfeksiyon. Tüketim: iş kıyafeti sanayi ofislerinde nihai mal. Neden alır: konfeksiyoncu kumaşı dokumacıdan alarak kendi pamuk hattını kurmaz.
3. **Demir cevheri + kömür → çelik → makine parçası → bakım kiti.** Cevher/kömür: Demirdağ, Akyayla, Kavşak yatakları. Çelikhane, makine atölyesi, bakım deposu. Tüketim: bakım kiti sanayi ofisinde; makine parçası mekanize reçetelerde (ağır makine araştırması) girdi. Neden alır: mekanize kazı ve ileri reçeteler makine parçası ister.

Ek: kereste → palet → sevkiyat ambalajı (orman, kereste fabrikası, ahşap atölyesi, ambalaj).

## Pazar simülasyonu (7 gün, sabit tohum)

| Senaryo | Odak ürün | Fiyat endeksi ort. önce→sonra | Satış süresi sa | Dolan emir | p2p payı | En kârlı / en zayıf iş kolu (₺/hat-gün) |
|---|---|---|---|---|---|---|
| 1 oyuncu / kıtlık | karma yem | %60→%61 | 8,9→12,6 | 0,97→1,00 | %0 | maden-metal 26.516 / yem 3.384 |
| 1 / fazla üretim | çelik | %80→%79 | 7,9→6,3 | 1,00→0,99 | %0 | maden-metal 40.116 / süt-gıda 4.919 |
| 4 / kıtlık | karma yem | %63→%64 | 6,6→12,1 | 0,97→1,00 | %29 | maden-metal 27.920 / yem 4.105 |
| 4 / fazla | çelik | %79→%77 | 7,0→6,2 | 1,00→0,99 | %34 | maden-metal 41.510 / süt-gıda 4.107 |
| 16 / kıtlık | karma yem | %57→%57 | 6,9→24,7 | 0,96→0,99 | %30 | maden-metal 15.736 / süt-gıda 1.117 |
| 16 / fazla | çelik | %71→%77 | 7,4→6,6 | 0,98→0,98 | %32 | maden-metal 21.504 / yem 402 |

Darboğaz ve düzeltme: değerli nihai mallarda (sucuk, dana eti, konteyner, havlu) sistem talebi günde 1 partinin altındaydı (85 nihai maldan 21'i). `finalMinBatchesPerCity = 0,6` ile 0'a indi; havlu satış süresi 48,7 → 28,1 sa. Zincirde zararlı 12 tarif miktar düzeltmesiyle kârlı (istisna `recycle_pulp`, belgeli).

Denetimler: para korunumu her senaryoda; sistemden al-sisteme sat en iyi tur −37 kuruş/kg; tek küçük işlem desteği ≥ %90 bırakır.

## Güvenlik düzeltmeleri

- Sistem payı yalnızca bağımsız işlemleri sayar (ters kayıt, aynı grup, fiyat anomalisi ve taban fiyatın yarısı altı dışlanır), çift başına katkı nominal hacmin üçte biri.
- `/market/stats` 30/dk, `/market/compare` 20/dk, 5.000 satır tavanı; `0004_v4_market_indexes` indeksleri.
- Araştırma ve seviye verim bonusu ayrı ayrı en çok +%60.
- Yönetici düzenlediği için revizyonu atlanan eski bina satırları yüklemede eksik alanlarla (yatak listesi dahil) tamamlanır.

## Açık konular

- Maden-metal hattı diğer iş kollarından 3–10 kat kârlı (v3 cevher/kömür sistem talebi). v3 5-sektör denetimi değişmesin diye dokunulmadı.
- Bazı türetilmiş ara mal fiyatları yüksek (karton, deri, iç yağı); birkaç alternatif tarif miktar bükülerek dengelendi. Fiyat türetmesi ileride yeniden kurulmalı.
- Gerçek mobil cihazda 3D ölçümü yok (yazılım rasterleştiricide 140 çizim çağrısı).
