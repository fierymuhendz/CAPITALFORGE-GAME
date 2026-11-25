# v3 Oynanabilirlik ve yerleşim (canlı dünya korunarak)

Kaynak: ilk sürümün oyun testi geri bildirimi (az anlamlı seçim, metin kalabalığı, sıkışık masaüstü, ekrandan taşan sayfalar).
Kısıt: canlı dünya korunur (hesap, şirket, stok, bakiye, işler, sözleşme şartları, defter). Yalnızca uyumlu migration. Test verisi ve saat ilerletme üretime girmez.

## Oyun testi bulguları (yerel, 81db5db, izole test hesapları)

| # | Yer | Bulgu |
|---|---|---|
| B1 | Kabuk, masaüstü | Yan panel 480 px sabit (1440 ve 1920'de aynı); şehir ekranın %70'ini alırken pazar/depo/finans tabloları yatay kaydırmaya düşüyor; pazar tablosunda "En iyi alış" ve "Sistem talebi" sütunları kesik. |
| B2 | Kabuk, masaüstü | Panel sekmeleri tek satırda; 10 sekmeden 4'ü görünür, kalanlar sağda gizli (kaydırma çubuğu yok). |
| B3 | Kabuk | `.play { overflow: hidden }` belge taşmasını maskeliyor; panel içindeki kesik alt öğeler ölçümde görünmüyor. |
| B4 | Telefon | Paneller yarım yükseklikte alt sayfa; üst yarıda işe yaramayan şehir; pazar satırları 6 satırlık kartlara dönüşüyor (bir ekrana 2 ürün sığıyor). |
| B5 | Pazar | Teklif karşılaştırma elle fiyat yazılan bir hesap makinesi; gerçek ilanlar için teslim maliyeti ve varış süresi yan yana görülmüyor. Uzaktaki ucuz ilan ile yakındaki pahalı ilan aynı görünüyor. |
| B6 | Pazar | Alımdan sonra teslimat ayrı ekranda (Lojistik → İş ilanı), navlun ve süre alımdan önce görünmüyor. |
| B7 | Tesis | İş seçimi açılır liste + 10 satırlık teklif tablosu; kâr tahmini yok, iki tarif arasında hangisinin daha iyi olduğu görülmüyor. Tesis listesinde boştaki tesiste "iş başlat" yok. |
| B8 | Sözleşme | Teklifi kabul etmeden önce "bugün spot satsam ne olur" karşılaştırması yok; ceza/teminat sonucu görünmüyor. |
| B9 | Lojistik | Taşıma panosunda iş başına net ve aracın bağlı kalacağı süre yok; uzun dolu iş ile kısa iş karşılaştırılamıyor. |
| B10 | Araştırma | İmalatçıya tarım/hayvancılık araştırmaları ilk sırada gösteriliyor. |
| B11 | Finans | Genel bakış 15 satırlık bakiye listesi; tahmin ile gerçekleşen arasında bağ yok. |
| B12 | Metin | Her panelde başlık + açıklama + düğmeyi tarif eden not tekrarı ("Bir satıra dokun…", "Tahmindir…"). |
| B13 | Şehir | Kendi binalarım ile satılık arsalar aynı ağırlıkta; kamyonun yükü/varışı yalnızca seçilince ve yalnızca sahibine görünüyor. |

Ekonomi bulguları ve değişiklikleri: `docs/plans/v3-ekonomi-kararlari.md`.

## Kararlar

### Yerleşim (kaynağında)
- Masaüstü: panel genişliği panele göre — veri panelleri (pazar, depo, sözleşme, lojistik, finans) `clamp(560px, 56vw, 1200px)`, diğerleri `clamp(400px, 32vw, 560px)`; "Genişlet" ile panel tüm genişliği alır. Panel gezinmesi dikey simge+etiket rayı (taşma yok).
- Tablolar görünüm genişliğine değil kap genişliğine göre karta döner (container query). Kart: iki sütunlu etiket/değer ızgarası, eylem düğmesi en altta tam genişlik.
- Telefon: panel başlık ile sekme çubuğu arasını tam kaplar; birincil eylem alt sabit çubukta, güvenli alan ve klavye (`interactive-widget=resizes-content`, `visualViewport`) dikkate alınır.
- Kasıtlı yatay kaydırma yalnızca bileşen içinde (şehir çipleri, geniş defter tablosu). Sayfa yatayda taşmaz; global kırpma, font küçültme veya yakınlaştırma kapatma yok.

### Ekranlar
- Pazar: ürün + teslim şehri + miktar → sunucudan teklif listesi (miktar, teslim birim maliyeti, varış). Satırdan "Al ve teslim ettir" tek adım. Sat sekmesi: alıcılar için net kg başı, kâr, tahsilat süresi. Fiyat panosu ikincil.
- Tesis: tarifler kart; seçili tarif girdi, çıktı, maliyet, süre, tahmini kâr ve Başlat'ı birlikte gösterir. Maliyet dökümü bir dokunuşla.
- Sözleşme: kabul ekranında sözleşme ↔ bugün spot satış karşılaştırması, teminat/emanet/ceza.
- Lojistik: pano satırında ücret, km, aracın bağlı kalacağı süre, net ve saat başı net.
- Finans: "Tahmin ↔ Gerçekleşen" listesi (üretim, alım+teslim, satış, taşıma işi).
- Şehir: binaya dokununca iş ekranı; kamyona dokununca yük ve varış; sektöre göre tanınır bina ve araçlar.

## API sözleşmesi (packages/shared/src/trade.ts, api.ts)
- `GET /market/offers` → `OffersDto` (OffersQuery).
- `POST /market/listings/:id/buy` + `deliverToCityId?` → `BuyResultDto` (alım + sistem taşımacısına açık taşıma işi, tek işlem).
- `GET /contracts/:id/compare` → `ContractCompareDto`.
- `GET /finance/outcomes` → `OutcomeDto[]`; kayıt tablosu `cf.deal_outcomes` (yeni migration, geri alınabilir).
- `FreightJobDto` + `estMinutesForMe`, `netPerHourForMe`, `bestVehicleIdForMe`.
- `ProductionQuoteDto.estimate`.
- Katalog revizyonu: yönetici düzenlemediği (version = 1) katalog satırlarını bir kez günceller, `meta` içinde revizyon anahtarı.
