# v3: ekonomi kararları denetimi ve düzeltmeler

Kapsam: beş sektörün (tarım, hayvancılık, madencilik, imalat, taşımacılık) ilk gelirden geç yatırıma kadar anlamlı karar sunması.
Oyuncu geri bildirimi: "çok az anlamlı seçim". Canlı dünya sıfırlanmaz; stok, nakit, işler korunur.
Sayılar `packages/economy/sim/model.ts` modelinden (`pnpm sim`, çıktı `docs/economy/denge.md`). Model sunucu simülasyonu değildir; N = aynı pazarı paylaşan oyuncu sayısı (varsayılan 2). Eski değerler (önce) aynı modelin eski katalogla çalışmasıdır.

## 1. Bulgular

| # | Hipotez | Sayılar | Karar |
|---|---|---|---|
| H1 | Kalite primi siliniyor | Tahıl, Körfezkent: kalite 2 alış 446 kuruş/kg, cap 432 → kalite 2, 3, 4, 5 hepsi 432 (prim %0). Yeşilova: kalite 3 +%9, kalite 4 ve 5 +%13 (cap'e takılır). Cap kalite çarpanından SONRA uygulanıyordu. Cap'in koruduğu şey kalite 2 alış < kalite 2 satış'tır; cap kalite 2 tabanına uygulanıp sonra kalite çarpanı gelirse prim tam çıkar (Körfezkent +%9/+%17/+%25). Sistem yalnızca kalite 2 sattığı için al-sat döngüsü kalite ile kârlı olmaz; kalite yalnızca üretimle gelir. Birim testi (özellik): her ürün, şehir, kalite, sapma ve doluluk için alış × (kalite 2 çarpanı / kalite çarpanı) ≤ cap < en düşük sistem satışı. Un, paketli süt, peynirde sistem satıcısı olmadığı için cap yoktu, prim zaten tamdı; yalnızca ham maddeler (yem, tahıl, süt, cevher, kömür, çelik) etkilenmişti. | DOĞRULANDI, düzeltme güvenli. Yeni sorun: eski çarpanlar (1,15/1,30/1,50) cap kalkınca ve zincirde kalite taşındığı için fazla güçlü (imalatta kalite 5 günlük +₺58–117k, bina seviyesinden büyük). Çarpanlar 1,09/1,17/1,25'e indirildi. |
| H2 | Madencilik kârı domine ediyor | Eski katalog, N = 2, günlük kâr (seviye 1): demir ₺3,3k, kömür ₺6,1k; un ₺8,2k; peynir ₺17k; **çelik ₺56k**. 21 günlük kabul testindeki 31,7M kuruş tek madencinin tüm havuzu almasıdır (N = 1); imalat tarafı gıda fabrikasıydı ve sistem fiyatıyla girdi alıyordu. | REDDEDİLDİ (mevcut katalogda). Madencilik en düşük kârlıydı (cevher 130 kuruş/kg havuzu ₺26k/gün), baskın olan çelikhaneydi (ham madde fiyatı düşük, çelik fiyatı yüksek, marj %45+). Her ikisi de düzeltildi: cevher ve kömür taban fiyatı ↑, çelik talebi ↓. Gıda imalatı marjı sistemden girdiyle %10, oyuncudan girdiyle %30 (H3). |
| H3 | Sistem girdiyi her yerde ucuz satar, oyuncu tedariki anlamsız | Sistem toptancısının günlük satış kg'ı sınırlı (Körfezkent tahıl 4 t) ve doldukça %20'ye kadar pahalanır; un fabrikası günde ~3 parti için 6 t tahıl ister. Oyuncudan alış, satıcı alternatifi (sistem alışı) ile alıcı alternatifi (sistem satışı) arasında olduğundan iki taraf da kazanır. Un fabrikası, seviye 1: yalnızca sistem girdisi ₺13,7k/gün, oyuncu tedarikli ₺17,1k/gün. Süt zinciri ve çelik zinciri aynı yapıda. Navlun: 12 t dolu kamyonla 180 km = ₺4.992 (42 kuruş/kg); 3 t kısmi yükte kg başına 166 kuruş. Kamyonet (3 t) sistem işlerini alamıyordu (iş 4 t, `acceptFreightJob` kapasite denetimi). Talep: süt ürünü ve un havuzları büyüktü ama koop bütçesi (₺300k) kalite 5 birim fiyatına bölündüğü için talebin ~%46'sını karşılıyordu. | KISMEN DOĞRULANDI. Gerçek sorun bütçe tavanı ve kısmi yük navlunuydu; kalite 5'e göre bölünen bütçe fiilî talebi kısıyordu. Tedarikçi kararı artık parametreyle çevrilir (bölüm 5). Koop bütçeleri tavan olmaktan çıkarıldı. |
| H4 | Navlunda kısa ve uzun aynı | Eski tarife (45.000 + km × 3.200) × kamyon dolusu; sistem işi hep 4 t. Kamyon saat başı kâr rotadan bağımsız ₺345–514; 4 t iş 12 t iş kadar öder (yük önemsiz); yükleme-boşaltma süresi yok; kamyonet hiç iş alamaz; 24 t tır yükü 3 kamyon dolusu fiyatlanırdı (tır orantısız karlı). Tek kamyon günlük ₺3,8–4,7k. | DOĞRULANDI. Yeni tarife (bölüm 3). Tempo tavanında saat başı kâr tam kamyonda ₺5,6–6,1k, 4 t işte ₺1,7k (eskisi ₺1,7–2,4k, yük farkı yok). Tur kararı dönüş yüküne bağlı (flip örnekleri). |
| H5 | Çiftçi spot mu sözleşme mi | Sistem sözleşmesi = doygunluksuz alış × 1,05 (cap'li). Spot doygunluk %80'de 0,76× düşer ama doygunluk yoksa spot ≥ sözleşme −%5: sözleşme neredeyse her zaman prim ve kilit sağlıyordu, tek bedel stok kilidiydi. Kalite fark etmediği için yüksek kalite stok için sözleşme kötü, ama bunu hesaplayan bir araç yoktu. | DOĞRULANDI (karar tek yönlü). Sözleşme fiyatına doygunluk primi eklendi (bölüm 3), `contractVsSpot` beklenen değer formülü yazıldı; flip örnekleri aşağıda. |
| H6 | Yükseltme, kalite, araştırma | Eski katalog (N = 2) günlük kâr seviye 1/2/3: tahıl ₺22,3k/21,8k/20,9k; süt ₺21,2k/20,5k/19,3k; kömür ₺6,1k/5,3k/4,0k; çelik ₺56k/55k/54k. Seviye 2 ve 3 YALNIZCA bakım ekliyordu (seviye 1 zaten 22–52 parti/gün kapasiteli, pazar 2–11 parti/gün emiyordu; kapasite 4–20 kat fazlaydı). Tempo tavanı (60 dk) bunu daha da büyütür: kapasite her sektörde talebin çok üstündedir. Bu yüzden değer kapasiteden değil, birim maliyeti ve kaliteyi düşüren seviye bonuslarından gelmelidir. Madde sektörlerinde araştırma verimi (+%8) ve kalite faydalıydı ama kalite cap'te siliniyordu. | DOĞRULANDI: yükseltmenin ekonomik etkisi SIFIRdı. Seviye bonusları eklendi (bölüm 3); seviye 2 geri dönüşü 8–12 gün, tesis kalitesi 9–13 gün, verim araştırması 9–14 gün; sektöre göre en kısa farklı (bölüm 4). |

### Ek bulgular
- Çelikhane eski haliyle (günlük ₺56k) tüm sektörlerin 3–17 katıydı; ilk iş için bile en iyi yol. Çelik talebi ×0,8, cevher ve kömür fiyatı ↑ ile ₺12–23k bandına çekildi.
- Sistem bütçeleri: koop bütçesi `maxUnit = kalite 5 fiyatı` ile bölündüğü için fiilî talep nominalin ~%37–46'sına iniyordu (Körfezkent koop ₺300k bütçe, kalite 5 nominal değeri ₺818k). Yeni bütçeler kalite 5 nominal değerinin %110'u.
- Taşımacılık sektörü ilk iş dışında büyümüyordu: ikinci kamyonun işi yoktu (günde 20 iş, hepsi 4 t) ve günlük kâr ₺4k.

## 2. Yapılan değişiklikler (özet)

Hemen canlıya etki edenler (kod sabiti veya saf formül; yeni ayar anahtarları varsayılanla tamamlanır):
- `packages/economy/src/pricing.ts`: `systemBidForQuality` (cap kalite 2 tabanında), `systemContractPrice` (doygunluk primli, %95 sert sınır).
- `packages/economy/src/freight.ts`: `systemCarrierQuote` v3 (imza aynı; `FREIGHT_TARIFF`, `loadFactorBp`), `deadlinePremiumBp`, `systemCarrierQuoteWithDeadline`, `systemFreightJobSpec`, `roundTripValue`, `estimateOwnTrip` `handlingMinutes` seçeneği (varsayılan 0).
- `packages/economy/src/decisions.ts`: `contractVsSpot`, `chooseSupplier`, `paybackDays`, `batchesPerDay`.
- `packages/shared/src/catalog/products.ts` `QUALITY_PRICE_BP`: `[0, 8000, 10000, 11500, 13000, 15000]` → `[0, 8500, 10000, 10900, 11700, 12500]`.
- `packages/shared/src/catalog/demand.ts` `SYSTEM_PROFILES` talep (günlük alım kg) ve bütçeler, `SYSTEM_FREIGHT_JOBS_PER_CITY_PER_DAY` 4 → 9.
- `packages/economy/src/production.ts`: `planProduction` bağlamına isteğe bağlı `levelYieldBp`, `levelEfficiencyBp`, `levelInputSavingBp`; `requiredInputs` üçüncü parametre (girdi tasarrufu, `ceil`, en çok %30). `freight.ts`: `estimateOwnTrip` `paceScaleBp`.
- `packages/shared/src/catalog/types.ts` + `buildings.ts`: seviye alanları `yieldBp`, `efficiencyBp`, `inputSavingBp`, `qualityBonus` (isteğe bağlı).
- `packages/shared/src/catalog/settings.ts`: yeni `freight.handlingMinutes = 40` (yeni anahtar; sunucu kullanana kadar etkisiz).

Canlı veritabanına ULAŞMAYANLAR (katalog satırı): bölüm 6 "KATALOG REVİZYONU".

### Sistem talebi (SYSTEM_PROFILES, günlük alım kg)
| Şirket | Ürün | Eski | Yeni |
|---|---|---|---|
| Körfezkent Toptan | çiğ süt / tahıl | 6000 / 6000 | 9000 / 7200 |
| Yeşilova Toptan | yem / tahıl | 12000 / 12000 | 18000 / 14400 |
| Akyayla Toptan | çiğ süt / yem | 10000 / 8000 | 15000 / 12000 |
| Demirdağ Toptan | cevher / kömür | 20000 / 15000 | 60000 / 22500 |
| Kavşak Toptan | tahıl / yem / çiğ süt | 6000 / 6000 / 4000 | 7200 / 9000 / 6000 |
| Ulusal İnşaat (Körfezkent / Kavşak) | çelik | 15000 / 8000 | 12000 / 6400 |
| Kavşak Termik / Demirdağ Santrali | kömür | 20000 / 10000 | 30000 / 15000 |
| Koop: un, paketli süt, peynir | | değişmedi (peynir 1500/600/300/400 → 1800/720/360/480) | |

Günlük bütçe tavanları: toplam ₺1,71M → ₺2,75M. Hepsi kalite 5 nominal değerinin ≥ %110'u (birim testi). Beklenen gerçek harcama (5 sektörden 2'şer oyuncu, seviye 2 + taşıma): yaklaşık ₺0,9M/gün; tavan hedef değildir. Sistem yalnızca oyuncu satışına karşılık para basar.

### Tarife ve kapasite
- Sistem taşıma işi sayısı şehir başına günde 4 → 9 (45 iş/gün; tempo tavanıyla sefer süreleri kısaldığı için kamyon günde çok iş yapar); karışım: 2,5 t/24 sa, 6 t/24 sa, 12 t/24 sa, 12 t/12 sa (+%15), 9 t/6 sa (+%30), 24 t/48 sa (−%5, tır).
- Tarife: tam kamyon dolusu eski formülün 12 t'taki biçimini korur, `markupBp 16000`; ilk 150 km tam, sonrası %85; km ücretinin %45'i yükten bağımsız (kısmi yük); ek kamyon dolusu %75; kalkış ücreti iş başına bir kez.
- Bina seviyeleri (tek `lv()` satırı): eşzamanlı parti 2/6/12 → 1/4/9. Seviye 2 bonusları (çıktı / enerji-işçilik / girdi tasarrufu bp, kalite): tarla 1800/1000/2500; ahır 1000/500/1500; maden 1500/1500/0 + kalite +1; gıda fabrikası 300/700/1000; çelikhane 300/600/800. Seviye 3 yaklaşık iki kat. Seviye 1→2 yükseltme maliyeti yarıya (tarla ₺20k + 1 t çelik, ahır ₺45k + 2 t, maden ₺50k + 2,5 t, gıda ₺60k + 3 t, çelikhane ₺40k + 2 t). Tesis kalite yükseltmesi pahalandı (tarla ₺50k, ahır ₺70k, maden ₺60k, imalat ₺100k), `quality_control` araştırması baseCost ₺50k → ₺100k: kalite artık seviye bonuslarıyla yarışan, ama onu ezmeyen bir yatırım.

## 3. Mekanik tasarım

### Kalite (H1)
`fiyat = qualityAdjusted(min(taban alış, cap), q)`. Körfezkent tahıl: kalite 3/4/5 = 470/505/540 (eskiden hepsi 432). Çarpanlar 1,09/1,17/1,25 (eski 1,15/1,30/1,50); q1 0,80 → 0,85.

### Sözleşme (H5)
`systemContractPrice(bid, minAsk, reputationBp, saturationBp)`: prim = %3 + %12 × doygunluk + (itibar − %90)/2 (en çok %5), en çok en düşük sistem satışının %95'i. Doygun pazarda spot düşerken sözleşme sabit kalır; boş pazarda prim küçüktür ve spot rahatça yarışır. Bedel: %10 eksik teslim cezası, teminat faizi (günlük %0,4), stok kilidi, kalite fark etmeyen tek fiyat.

### Taşımacılık (H4)
Karar kuralı: saat başı kâr = (ücret − yakıt − sürücü) / (yol + 2 × yükleme-boşaltma 40 dk). Tempo tavanında (en uzun sefer 60 dk) dolu kamyon ₺5,6–7,5k/sa, 4 t ₺1,7k/sa, 6 t ₺2,8k/sa; kamyonet yalnızca 2,5 t işleri alır (₺0,9k/sa). Uzun-dolu mu kısa mı sorusu dönüş yüküne bağlı (flip). Acil iş: araç o anda boştaysa (+%30) saat başı kâr en yüksek.

## 4. Yatırım geri dönüşü (seviye 1, kalite 1, araştırma 0, N = 2; maliyet / günlük kazanç = gün)
Tam tablo `docs/economy/denge.md` bölüm 5. En kısa ilk yatırım: tarım bina seviye 2 (12 gün; tesis kalitesi 13), hayvancılık bina seviye 2 (8), madencilik bina seviye 2 (10), un fabrikası tesis kalitesi (10; seviye 2 12), çelikhane tesis kalitesi (9; seviye 2 10). Seviye 3 yalnızca pazarı tek başına dolduran oyuncuya (N = 1) belirgin yarar.

## 5. Karar çevirme örnekleri (flip)
Hepsi `pnpm sim` çıktısında (`docs/economy/denge.md` bölüm 6–8) ve `packages/economy/src/v3.test.ts` içinde birim testidir.

### Çiftçi: spot mu sözleşme mi (tahıl, Yeşilova, 3 taksit × 2000 kg)
- Küme A: pazar doygun (rakipler günlük talebin %80'ini doldurdu), kalite 2, sistem sözleşmesi 439 kuruş/kg, spot 290 kuruş/kg, teslim edememe %5: sözleşme ₺24.860, spot ₺17.226 → SÖZLEŞME.
- Küme B: pazar boş (doluluk %10), referans %20 yukarı kaymış, kalite 4 stok, sözleşme 407 kuruş/kg, spot 505 kuruş/kg: sözleşme ₺23.048, spot ₺29.997 → SPOT.

### İmalatçı: yakın pahalı mı, uzak ucuz mu (un, Körfezkent; Körfezkent toptan 630 kuruş/kg 0 km, Yeşilova çiftçisi 480 kuruş/kg 180 km)
- Küme A: 3.000 kg (kısmi yük): uzak 646 kuruş/kg teslim (navlun ₺4.992) → YAKIN kazanır (630).
- Küme B: 12.000 kg (dolu kamyon): uzak 521 kuruş/kg → UZAK kazanır.

### Taşımacı: uzun dolu sefer mi, kısa iş mi (kamyon, Kavşak çıkışlı; tur = gidiş + dönüş)
- Küme A (dönüş yükü yalnızca Yeşilova'da): uzun (Demirdağ 150 km, dönüş boş + 20 dk bekleme) ₺-228/sa; kısa (Yeşilova 90 km, dönüş 12 t) ₺5.649/sa → KISA.
- Küme B (dönüş yükü yalnızca Demirdağ'da: çelik/kömür): uzun (dönüş 12 t) ₺6.130/sa; kısa (dönüş boş) ₺-135/sa → UZUN. (Süreler tempo tavanı ölçeğiyle; yol 60 dk'ya sıkıştırılmış.)
- Süre primi: araç o an boştaysa acil (6 sa) uzun sefer tur kârı ₺2.074; 24 sa ₺-365 (dönüşsüz).

## 6. KATALOG REVİZYONU (mevcut katalog satırları; tohumlama güncellemez)
Backend tek seferlik revizyon: yalnızca yönetici düzenlemesi görmemiş satırlar (sürüm = tohum sürümü) güncellenir. Biçim `{kind, id, path, old, new}`; `old: null` = yeni isteğe bağlı alan (satırda yoksa eklenir).
Tarif süreleri DEĞİŞMEDİ (tempo tavanı 60 dk). Önceki taslaktaki 9 süre revizyonu iptal.

```json
[
  {"kind":"product","id":"iron_ore","path":"basePricePerKg","old":180,"new":260},
  {"kind":"product","id":"coal","path":"basePricePerKg","old":220,"new":340},
  {"kind":"product","id":"flour","path":"basePricePerKg","old":1050,"new":1300},
  {"kind":"product","id":"packaged_milk","path":"basePricePerKg","old":1400,"new":1550},
  {"kind":"building_type","id":"field","path":"levels[0].maxBatches","old":2,"new":1},
  {"kind":"building_type","id":"field","path":"levels[1].maxBatches","old":3,"new":2},
  {"kind":"building_type","id":"field","path":"levels[2].maxBatches","old":4,"new":3},
  {"kind":"building_type","id":"barn","path":"levels[0].maxBatches","old":2,"new":1},
  {"kind":"building_type","id":"barn","path":"levels[1].maxBatches","old":3,"new":2},
  {"kind":"building_type","id":"barn","path":"levels[2].maxBatches","old":4,"new":3},
  {"kind":"building_type","id":"mine","path":"levels[0].maxBatches","old":2,"new":1},
  {"kind":"building_type","id":"mine","path":"levels[1].maxBatches","old":3,"new":2},
  {"kind":"building_type","id":"mine","path":"levels[2].maxBatches","old":4,"new":3},
  {"kind":"building_type","id":"food_plant","path":"levels[0].maxBatches","old":2,"new":1},
  {"kind":"building_type","id":"food_plant","path":"levels[1].maxBatches","old":3,"new":2},
  {"kind":"building_type","id":"food_plant","path":"levels[2].maxBatches","old":4,"new":3},
  {"kind":"building_type","id":"steel_mill","path":"levels[0].maxBatches","old":2,"new":1},
  {"kind":"building_type","id":"steel_mill","path":"levels[1].maxBatches","old":3,"new":2},
  {"kind":"building_type","id":"steel_mill","path":"levels[2].maxBatches","old":4,"new":3},
  {"kind":"building_type","id":"field","path":"levels[0].upgradeCost","old":7000000,"new":2000000},
  {"kind":"building_type","id":"field","path":"levels[0].upgradeSteelKg","old":3000,"new":1000},
  {"kind":"building_type","id":"field","path":"qualityUpgradeCosts[0]","old":3500000,"new":5000000},
  {"kind":"building_type","id":"field","path":"qualityUpgradeCosts[1]","old":10000000,"new":14000000},
  {"kind":"building_type","id":"field","path":"levels[1].yieldBp","old":null,"new":1800},
  {"kind":"building_type","id":"field","path":"levels[1].efficiencyBp","old":null,"new":1000},
  {"kind":"building_type","id":"field","path":"levels[1].inputSavingBp","old":null,"new":2500},
  {"kind":"building_type","id":"field","path":"levels[2].yieldBp","old":null,"new":3500},
  {"kind":"building_type","id":"field","path":"levels[2].efficiencyBp","old":null,"new":1000},
  {"kind":"building_type","id":"field","path":"levels[2].inputSavingBp","old":null,"new":1000},
  {"kind":"building_type","id":"field","path":"levels[2].qualityBonus","old":null,"new":1},
  {"kind":"building_type","id":"barn","path":"levels[0].upgradeCost","old":9000000,"new":4500000},
  {"kind":"building_type","id":"barn","path":"levels[0].upgradeSteelKg","old":4000,"new":2000},
  {"kind":"building_type","id":"barn","path":"qualityUpgradeCosts[0]","old":4000000,"new":7000000},
  {"kind":"building_type","id":"barn","path":"qualityUpgradeCosts[1]","old":12000000,"new":18000000},
  {"kind":"building_type","id":"barn","path":"levels[1].yieldBp","old":null,"new":1000},
  {"kind":"building_type","id":"barn","path":"levels[1].efficiencyBp","old":null,"new":500},
  {"kind":"building_type","id":"barn","path":"levels[1].inputSavingBp","old":null,"new":1500},
  {"kind":"building_type","id":"barn","path":"levels[2].yieldBp","old":null,"new":2000},
  {"kind":"building_type","id":"barn","path":"levels[2].efficiencyBp","old":null,"new":1000},
  {"kind":"building_type","id":"barn","path":"levels[2].inputSavingBp","old":null,"new":2500},
  {"kind":"building_type","id":"mine","path":"levels[0].upgradeCost","old":10000000,"new":5000000},
  {"kind":"building_type","id":"mine","path":"levels[0].upgradeSteelKg","old":5000,"new":2500},
  {"kind":"building_type","id":"mine","path":"qualityUpgradeCosts[0]","old":4000000,"new":6000000},
  {"kind":"building_type","id":"mine","path":"qualityUpgradeCosts[1]","old":12000000,"new":16000000},
  {"kind":"building_type","id":"mine","path":"levels[1].yieldBp","old":null,"new":1500},
  {"kind":"building_type","id":"mine","path":"levels[1].efficiencyBp","old":null,"new":1500},
  {"kind":"building_type","id":"mine","path":"levels[1].qualityBonus","old":null,"new":1},
  {"kind":"building_type","id":"mine","path":"levels[2].yieldBp","old":null,"new":3000},
  {"kind":"building_type","id":"mine","path":"levels[2].efficiencyBp","old":null,"new":2500},
  {"kind":"building_type","id":"mine","path":"levels[2].qualityBonus","old":null,"new":1},
  {"kind":"building_type","id":"food_plant","path":"levels[0].upgradeCost","old":12000000,"new":6000000},
  {"kind":"building_type","id":"food_plant","path":"levels[0].upgradeSteelKg","old":6000,"new":3000},
  {"kind":"building_type","id":"food_plant","path":"qualityUpgradeCosts[0]","old":5000000,"new":10000000},
  {"kind":"building_type","id":"food_plant","path":"qualityUpgradeCosts[1]","old":14000000,"new":24000000},
  {"kind":"building_type","id":"food_plant","path":"levels[1].yieldBp","old":null,"new":300},
  {"kind":"building_type","id":"food_plant","path":"levels[1].efficiencyBp","old":null,"new":700},
  {"kind":"building_type","id":"food_plant","path":"levels[1].inputSavingBp","old":null,"new":1000},
  {"kind":"building_type","id":"food_plant","path":"levels[2].yieldBp","old":null,"new":600},
  {"kind":"building_type","id":"food_plant","path":"levels[2].efficiencyBp","old":null,"new":1400},
  {"kind":"building_type","id":"food_plant","path":"levels[2].inputSavingBp","old":null,"new":1800},
  {"kind":"building_type","id":"steel_mill","path":"levels[0].upgradeCost","old":13000000,"new":4000000},
  {"kind":"building_type","id":"steel_mill","path":"levels[0].upgradeSteelKg","old":6000,"new":2000},
  {"kind":"building_type","id":"steel_mill","path":"qualityUpgradeCosts[0]","old":5000000,"new":10000000},
  {"kind":"building_type","id":"steel_mill","path":"qualityUpgradeCosts[1]","old":14000000,"new":24000000},
  {"kind":"building_type","id":"steel_mill","path":"levels[1].yieldBp","old":null,"new":300},
  {"kind":"building_type","id":"steel_mill","path":"levels[1].efficiencyBp","old":null,"new":600},
  {"kind":"building_type","id":"steel_mill","path":"levels[1].inputSavingBp","old":null,"new":800},
  {"kind":"building_type","id":"steel_mill","path":"levels[2].yieldBp","old":null,"new":600},
  {"kind":"building_type","id":"steel_mill","path":"levels[2].efficiencyBp","old":null,"new":1200},
  {"kind":"building_type","id":"steel_mill","path":"levels[2].inputSavingBp","old":null,"new":1600},
  {"kind":"research","id":"quality_control","path":"baseCost","old":5000000,"new":10000000}
]
```
Alanlar: `levels[i].yieldBp` (çıktı +bp), `efficiencyBp` (enerji ve işçilik −bp), `inputSavingBp` (girdi kg −bp, en çok 3000), `qualityBonus` (tesis kalite seviyesine eklenir). Seviye 1 bonussuz (alanlar yok). `QUALITY_PRICE_BP`, `SYSTEM_PROFILES`, `SYSTEM_FREIGHT_JOBS_PER_CITY_PER_DAY` (6 yerine 9) kod sabiti olduğundan sürümle canlıya girer.
Etki: tempo tavanıyla seviye 1 kapasitesi zaten talebin üstünde (pazar sınırlı), bu yüzden kapasite artışı (`maxBatches` 2/3/4 → 1/2/3) tek başına değer üretmez; seviyenin değeri bonuslardan gelir. Çalışan işler kendi anlık görüntüleriyle biter; `batches > maxBatches` olan iş tamamlanmalı.

## 7. SUNUCU İSTEKLERİ (backend, `apps/**`)
1. Bina seviyesi bonusları (yeni): `apps/server/src/production/` içinde `planProduction` çağrısının bağlamı kurulan yerde (`start.ts` ve `quote.ts`), `lv = catalog.buildingType(facility.typeId).levels[facility.level - 1]` için ekleyin: `levelYieldBp: lv.yieldBp ?? 0`, `levelEfficiencyBp: lv.efficiencyBp ?? 0`, `levelInputSavingBp: lv.inputSavingBp ?? 0`, `facilityQualityLevel: facility.qualityLevel + (lv.qualityBonus ?? 0)`. Girdi düşümü ve rezervi `plan.inputs` (artık tasarruflu, `ceil`) üzerinden yapılmalı; `requiredInputs(recipe, batches)` doğrudan kullanılıyorsa `plan.inputs`'a geçin. Tip: `BuildingTypeDef.levels[]` yeni isteğe bağlı alanlar (`packages/shared/src/catalog/types.ts`, eklendi). Arayüz teklifinde (quote) bonusları göstermek için aynı alanları DTO'ya geçirin.
2. `apps/server/src/market/spot.ts` `effectivePrice` (sistem alım emri): `return systemBidForQuality(o.pricePerKg, quality, bidCap, QUALITY_PRICE_BP)` (cap kalite 2 tabanına; ikinci cap kalkar). `security.int.test.ts:552-555` beklentileri değişir.
3. `apps/server/src/system/system.ts`:
   - `syncProfile`: `maxUnit = systemBidForQuality(bid, 5, bidCap, QUALITY_PRICE_BP)` (sondaki `if (bidCap !== null && maxUnit > bidCap)` silinir).
   - `adoptOrphans`: `unitBid = systemBidForQuality(systemBid(ref, sys.bidBp, d.boughtKg, B, bidCap), o.quality, bidCap, QUALITY_PRICE_BP)`; ikinci cap satırı silinir.
   - `recurringContracts`: `price = systemContractPrice(systemBid(ref, sys.bidBp, 0, B, cap), minAsk, reputationBp(pl.onTimeDeliveries, pl.lateOrMissed), saturationBp)`; `minAsk = min over şehirler systemAsk(refCity, sys.askBp, 0, 1)`, `saturationBp = min(10000, floor(10000 × max(d.boughtKg bugün, dün) / B))`; `applyBp(..., 10000 + sys.reputationPremiumBp)` ve `price > cap` kısıtı kalkar. Sözleşme teslimleri `system_daily.bought_kg` sayacına yazılmamalı (doğrulayın).
   - `freightCycle` iş üretimi: `const spec = systemFreightJobSpec(c, k, Math.floor(now.getTime() / 86_400_000), cities)`; `kg = spec.kg`, `dest = spec.destCityId`, `deadlineHours = spec.deadlineHours`, `pay = systemCarrierQuoteWithDeadline(roadDistanceKm(c, dest), kg, base, perKm, spec.deadlineHours, truck.capacityKg)`; `allowed = Math.min(SYSTEM_FREIGHT_JOBS_PER_CITY_PER_DAY, 1 + Math.floor((hoursToday * SYSTEM_FREIGHT_JOBS_PER_CITY_PER_DAY) / 24))` (günlük 9).
4. `apps/server/src/logistics/shipping.ts` `startShipment`: `handlingMinutes` zaten geçiriliyor; tempo ölçeği `paceTrip(catalog, trip.minutes)` ile (yükleme dahil) uygulanıyor, sim aynı kuralı kullanır (`estimateOwnTrip(..., { paceScaleBp })` seçeneği eklendi; isterseniz `paceTrip` yerine kullanın). Maliyet (yakıt, sürücü) ölçeklenmez.
5. Revizyon görevi (bölüm 6) ve `catalog_items` sürüm denetimi.
6. Entegrasyon testleri: iş sayısı beklentileri 4 → 9 sistem işi/şehir/gün; üretim tesis kalite/seviye testlerinde bonuslu çıktı/girdi miktarı beklentileri.
7. İsteğe bağlı arayüz: `contractVsSpot`, `chooseSupplier`, `roundTripValue` tahminleri.

## 8. Doğrulama
- `pnpm test`: 40/40. `pnpm sim`: çıkış 0 (tempo tavanı 60 dk modellenir: üretim ≤ 60 dk, en uzun sefer 60 dk, yol ölçeği `travelScaleBp`).
- 21 gün işletme kârı (N = 2): tarım ₺768k, hayvancılık ₺1.173k, madencilik ₺796k–1.040k, imalat un ₺1.166k / çelik ₺991k, taşımacılık ₺798k. En yüksek/en düşük 1,53×.
- En kısa geri dönüşlü ilk yatırım: tarım bina seviye 2 (12 gün), hayvancılık bina seviye 2 (8), madencilik bina seviye 2 (10), un tesis kalitesi (10), çelik tesis kalitesi (9). Seviye 2 geri dönüşü 8–12 gün, her sektörde ≤ 14.
- Seviye 2 etkisi: tarım girdi (tohum) %25 tasarruf + çıktı %18 + verim; hayvancılık yem %15 + çıktı %10; madencilik çıktı %15, enerji/işçilik %15, kalite +1; gıda %3 çıktı, %7 verim, %10 girdi; çelik %3, %6, %8.
- Entegrasyon testleri çalıştırılmadı.
