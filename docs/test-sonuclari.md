# Kabul testi sonuçları (v2, sunucu düzeyi)

Çalıştırma: gerçek PostgreSQL (`capitalforge_test_qa`), Redis'siz harness (`apps/server/src/test/harness.ts`), zaman `h.advance(ms)` ile ilerletilir.
Her senaryo sonunda `checkInvariants(h.deps.db)` boş döner (defter toplamı 0, dengeli işlemler, önbellek bakiyesi = satır toplamı, nakit ≥ 0, stok hesabı = depo).
Para ve stok doğrulamaları tam sayıdır (kuruş, kg); tek istisna verim araştırması için tam tamsayı aralığıdır (aşağıda).

## Özet

| Takım | Komut | Sonuç |
|---|---|---|
| Birim | `pnpm test` | 18/18 geçti (2 dosya) |
| Entegrasyon | `pnpm test:int` | 83/84 geçti, 1 başarısız (aşağıdaki bulgu, crop kârı) |
| Tür denetimi | `pnpm typecheck` | temiz |
| Uçtan uca | `pnpm e2e` | çalıştırılamadı: kökte `e2e` betiği yok. `e2e/live-smoke.mjs` yalnızca canlı https adresine karşı çalışır (`BASE_URL`, `SMOKE_PASSWORD`), bu ortamda canlı adres yok |

Entegrasyon dosyaları: trade 7/7, security 20/20, production 15/15, finance 8/8, facilities 4/4, admin 13/13, found 2/2, acceptance 14/15.

## Bulgu (başarısız test)

**Tarım sektörü, yalnızca sistemle ticarette 21 günde pozitif kâr üretmiyor.**

- Test: `apps/server/src/test/acceptance.int.test.ts:570` (`21 günlük kümülatif kâr pozitif: crop`).
- Beklenen: kümülatif kâr > 0. Gerçek: 21 günde −19.045 kuruş (gelir 21.351.664, gider 21.370.709). Önceki çalıştırmada −66.565 kuruş; iki çalıştırmada da sıfıra çok yakın ve negatif.
- Strateji: Körfezkent'te `grow_grain` (2 parti), tohum sistem satış fiyatından alınır, tahıl önce 570 kuruş/kg'dan imalat şirketine sözleşme ile (12 taksit), kalanı sisteme satılır; marj %5'in altına düşerse sözleşme dışı üretim atlanır.
- Neden (üretim kodu hatası değil, denge göstergesi): tohum sistem satışından referansın %120'sine alınır, çıktı referansın %85'ine satılır (`packages/shared/src/catalog/settings.ts:44-45`, `bidBp: 8500`, `askBp: 12000`). Üstüne sistem doygunluğu referansı düşürür: 21 günde Körfezkent tahıl referansı 525 → ~315 kuruş/kg'a indi (`apps/server/src/market/prices.ts:50` → `packages/economy/src/pricing.ts:53` `nextDriftBp`). Tahıl tarifi (`packages/shared/src/catalog/recipes.ts:11`) bu alış-satış aralığını ve düşen referansı kapatacak kadar marj bırakmıyor. İlk işte kâr var çünkü tohum bağıştır (aşağıda ilk yolculuk tablosu).
- Öneri (oyun-tasarimci): tohum/çıktı marjı, `bidBp`/`askBp` aralığı veya doygunluk düşüşü gözden geçirilmeli. Test, tasarım düzeltilene kadar başarısız kalır; üretim koduna dokunulmadı.

Diğer sektörler aynı stratejiyle pozitif: bkz. çok haftalı tablo.

## Kabul senaryoları ve kapsayan dosyalar

| # | Senaryo | Test dosyası / test | Sonuç |
|---|---|---|---|
| 1 | Beş sektör: kuruluş, uygun arsa, bağış tam bir kez (tekrar ve ikinci şirket denemesi yeni bağış vermez), ilk iş, sisteme satış (ilk gelir), makul sonraki yatırım | `acceptance.int.test.ts` bölüm 1 (5 test) | geçti |
| 1a | Kuruluş: her sektör, bağış bir kez | `found.int.test.ts` "her sektör için uygun arsa ile kurulur, bağış bir kez verilir" | geçti |
| 1b | Her sektörün ilk işi, çıktı ve maliyet | `production.int.test.ts` "her sektörün ilk işi" (5 test) | geçti |
| 2 | Üç taraflı sözleşme (üretici, alıcı, taşımacı): çoklu teslim, gecikmeli ve kısmi teslim, emanet mutabakatı | `trade.int.test.ts` "üç taraflı sözleşme" | geçti |
| 3 | Ağırlıklı ortalama maliyet (100@10 + 200@13 → 12), navlun, net kâr 150 | `trade.int.test.ts` "kabul senaryosu: ortalama maliyet, navlun, net kâr"; `production.int.test.ts` "lot maliyeti ağırlıklı ortalamayla düşer" | geçti |
| 4 | Seviye ve nakit gereksinimi ayrı ayrı; dolu arsa | `found.int.test.ts` "seviye ve nakit gereksinimi ayrı ayrı denetlenir"; `facilities.int.test.ts` "seviye ve nakit ayrı ayrı denetlenir; çelik gerekir" | geçti |
| 5 | Yükseltme (seviye, çelik, nakit, süre) | `facilities.int.test.ts` "yükseltme" (2 test) | geçti |
| 6 | Araştırma ve kalite iyileştirmesi | `production.int.test.ts` "kalite, araştırma" (2 test); `acceptance.int.test.ts` bölüm 1 (ilk yatırım olarak araştırma) | geçti |
| 7 | Krediler: kullanım, taksit, erken ödeme, ödenemeyen taksit (arrears) | `finance.int.test.ts` "krediler" (3 test) | geçti |
| 8 | Günlük bakım günde bir kez, yetmezse arrears, çift işlenmez | `finance.int.test.ts` "günlük bakım"; `acceptance.int.test.ts` bölüm 2 | geçti |
| 9 | Eşzamanlılık: iki alıcı aynı ilanı alır, tek başarı | `trade.int.test.ts` "iki alıcı aynı anda son birimleri alır" | geçti |
| 10 | Tekrar (idempotency): aynı istek tek hareket | `trade.int.test.ts` "aynı istek tekrarı tek hareket yazar"; `production.int.test.ts` "aynı idempotencyKey ikinci kez iş açmaz"; `security.int.test.ts` 9a idempotency | geçti |
| 11 | Tam bir kez yerleşme: üç eşzamanlı `runDue` | `production.int.test.ts` "aynı anda iki runDue işi iki kez yerleştirmez"; `acceptance.int.test.ts` bölüm 3 | geçti |
| 12 | Çevrimdışı tamamlanma (oyuncu istek atmaz) | `acceptance.int.test.ts` bölüm 4; `production.int.test.ts` "oturum olmadan zamanlayıcı işi bitirir"; `trade.int.test.ts` "oyuncu çevrimdışıyken varır" | geçti |
| 13 | Yeniden başlatma (yarım üretim + yarım sevkiyat) | `acceptance.int.test.ts` bölüm 3 | geçti |
| 14 | İkinci yayın: migration + tohumlama tekrar, oyuncu verisi ve katalog düzenlemeleri aynen kalır | `acceptance.int.test.ts` bölüm 3 | geçti |
| 15 | Aynı IP ticareti ve uyarılar | `admin.int.test.ts` "aynı IP'li iki hesap...", "diğer uyarılar"; `security.int.test.ts` 3 ve 6 (yıkama ticareti, aynı grup ilanı) | geçti |
| 16 | Yönetici erişimi (403, 401, TOTP zorunlu, denetim kaydı, katalog düzenleme) | `admin.int.test.ts` "erişim", "katalog ve ayar düzenleme"; `security.int.test.ts` 5 | geçti |
| 17 | Çok haftalı zaman ilerletme (21 gün) | `acceptance.int.test.ts` bölüm 2 (6 test); `trade.int.test.ts` "birkaç gün sonunda günlük bütçe ve miktar sınırları aşılmaz" (3 gün) | 5/6 geçti; crop kârı başarısız (bulgu) |
| 18 | Arayüz (telefon/masaüstü, TR/EN) | yok | bekliyor |

## 1) Beş sektörün ilk yolculuğu (`acceptance.int.test.ts` bölüm 1)

Her sektör taze hesapla başlar. Doğrulananlar: nakit = başlangıç sermayesi − arsa bedeli (tam); `starter_grants` ve `starter_grant` defter işlemi tam 1 adet; aynı anahtarla tekrar kuruluş aynı şirketi döndürür ve bağış satırı, özkaynak, stok, sabit kıymet değişmez; yeni anahtar ve yeni adla ikinci şirket `COMPANY_EXISTS` ile reddedilir; ilk iş girdi stokundan başlar, bitince çıktı stokta ve wip 0; sisteme satışta nakit artışı = brüt − komisyon (tam), satış satırı net kâr = brüt − maliyet − komisyon; araştırma bedeli nakitten tam düşer ve etkisi (verim veya enerji) teklifte görünür.

Tutarlar kuruş.

| Sektör | Şehir | İlk iş çıktısı | İlk gelir (brüt) | İlk satış net kâr | Sonraki yatırım | Sonuç |
|---|---|---|---|---|---|---|
| Tarım | Yeşilova | 6.410 kg yem | 1.224.310 | 668.067 | araştırma agronomy, 2.500.000 | geçti |
| Hayvancılık | Akyayla | 2.233 kg çiğ süt | 1.451.450 | 582.936 | araştırma herd_health, 3.000.000 | geçti |
| Madencilik | Demirdağ | 7.245 kg kömür | 1.144.710 | 513.263 | araştırma drilling, 3.000.000 | geçti |
| İmalat (gıda) | Körfezkent | 1.650 kg un | 1.588.950 | 362.561 | araştırma lean_process, 3.500.000 | geçti |
| Taşımacılık | Kavşak | sistem taşıma işi, 150 km | 575.000 (navlun geliri) | 144.500 (yakıt ve sürücü sonrası) | kamyonet, 6.000.000 | geçti |

Taşımacılık: bağışla gelen kamyonla, panodaki açık sistem işi alınır; aynı işin ikinci kez alınması reddedilir; teslimde gelir tam ilan ücretine eşittir; araç hedef şehre taşınır; kamyonet alımı nakitten tam 6.000.000 düşer, filo 2 araç olur.

Not: verim araştırmasında teklif, hesaplanmış tam sayının `floor` ile yuvarlandığı için "önceki × 1,08" tam eşitliği yerine tam aralık denetlenir: `önceki × 1,08 − 1 < sonraki < (önceki + 1) × 1,08`. Yaklaşık karşılaştırma değildir; `production.int.test.ts` içindeki tam eşitlik 4800 kg gibi yuvarlama sorunu olmayan değerlerde geçerlidir.

## 2) 21 günlük çok haftalı simülasyon (`acceptance.int.test.ts` bölüm 2)

Beş şirket (tarım ve imalat Körfezkent, hayvancılık Akyayla, madencilik Demirdağ, taşımacılık Kavşak). Her 4 saatte bir: sözleşme teslimi, çıktıyı sisteme satış, kâr bilinçli tekrar üretim (tahmini gelir > tahmini maliyet × %105, sözleşme tedarikçisi için koşulsuz), taşımacı panodaki en kârlı sistem işini üstlenir. Toplam 21,29 gün, 1 saatlik zamanlayıcı adımları. Tekrarlayan sözleşme: tarım (satıcı) → imalat (alıcı), tahıl, 12 taksit, 1.000 kg, 570 kuruş/kg, 36 saat arayla, Körfezkent.

Sektör başına 21 günlük kümülatif kâr (gelir hesapları − gider hesapları, tüm zamanlar; son tam çalıştırma, kuruş):

| Sektör | Gelir | Gider (maliyet, bakım, komisyon...) | Kâr | Üretim başlatma | Sonuç |
|---|---|---|---|---|---|
| Tarım | 21.351.664 | 21.370.709 | **−19.045** | 16 | **başarısız** |
| Hayvancılık | 8.793.554 | 8.210.931 | 582.623 | 7 | geçti |
| Madencilik | 53.897.915 | 48.726.503 | 5.171.412 | 102 | geçti |
| İmalat | 13.473.900 | 12.915.739 | 558.161 | 5 | geçti |
| Taşımacılık | 104.405.000 | 81.970.325 | 22.434.675 | 126 sistem işi üstlenildi | geçti |

Çalıştırmalar arasında küçük sapma var (tarım −19.045 ile −66.565 arasında, hayvancılık ve imalat 0,4 ile 0,6 milyon arasında); işaretler değişmedi. Net değer değişimi her sektörde kâra eşit (varlık ve bağış hareketleri kârı bozmuyor). Hayvancılık ve imalat marjı ince: kâr-bilinçli kural çoğu turda üretimi atladı (hayvancılık 118, imalat 118, tarım 110 atlama). Taşımacılık kârı diğer sektörlerin 4 ila 40 katı; denge için not.

Diğer denetimler (hepsi geçti):

| Denetim | Sonuç |
|---|---|
| Sistem şirketleri günlük bütçeyi aşmaz | en yüksek kullanım: günlük bütçenin %43,68'i; her (şirket, gün) toplamı ≤ bütçe |
| Sistem günlük alım ve satış kg sınırı | her (şirket, ürün, gün) `bought_kg` ≤ profil alımı, `sold_kg` ≤ profil satışı |
| Sistem sayaçları fiilî işlemlerle uyumlu | sayaç toplamı ≥ sistemin alıcı olduğu işlem toplamı |
| Sistem nakdi hiçbir turda negatif olmaz | her 4 saatte ölçüldü; en düşük sistem nakdi 1.931.057.310 kuruş |
| Tekrarlayan sözleşme | 12/12 taksit yerleşti, 12'si tam teslim (`fulfilled`), sözleşme `completed` |
| Günlük bakım | her şirkette 20 bakım işlemi (ilk gün ücretsiz), tekrar yok, ardışık vadeler tam 24 saat arayla, tutar sabit, arrears 0 |
| İş iki kez yerleşmedi | 130 üretim işi = 130 `production_settle` işlemi, `production_output` hareketi iş başına 1; 126 sevkiyat teslim, `shipment_arrive` tekrarı yok; 12 taksit = 12 `installment_settle`; bir taşıma işine birden fazla sevkiyat yok |
| Taşımacı sistem işlerini üstlendi | 126 sistem işi teslim edildi (en az 5 beklenen) |
| `checkInvariants` | boş |

Sistem bütçesi ve kapasite sınırı oyuncu payı arttıkça küçülür (`shareDampBp`); bu çalıştırmada bütçenin yarısı bile kullanılmadı.

## 3) Kalıcılık ve yeniden başlatma (`acceptance.int.test.ts` bölüm 3)

Harness'a küçük bir seçenek eklendi: `createHarness({ keepDb: true })` şemayı silmeden aynı veritabanına yeni bir uygulama örneği bağlar (migration + tohumlama yine çalışır, saat ofseti veritabanından yüklenir). Üretim koduna dokunulmadı.

Senaryo: tarım şirketi 2 partilik üretim başlatır; taşımacı A kendi aracıyla 1.000 kg tahıl sevk eder; taşımacı B, hayvancılık şirketinin 300.000 kuruşluk taşıma işini üstlenir; yönetici API ile tarif süresini, tahıl taban fiyatını ve bir ayarı düzenler. 20 dakika sonra (üretim ve iki sevkiyat yarıda) uygulama kapatılır.

| Adım | Doğrulanan | Sonuç |
|---|---|---|
| Yeniden başlatma 1 (süre geçmedi) | oyuncu, bakiye, stok, arsa, bağış, katalog ve iş satırlarının özeti birebir aynı; eski oturum çerezi geçerli; katalog düzenlemeleri yeni örnekte okunur; erken `tick` hiçbir işi bitirmez | geçti |
| Yeniden başlatma 2 (sunucu kapalıyken 18 saat geçti) | açılıştaki ilk turda `production.settle` = 1, iki sevkiyat varır; üç eşzamanlı tur ve ek turlar ikinci yerleşme yapmaz | geçti |
| Üretim | `production_settle` işlemi 1, stok = çıktı, wip 0, XP tam 10 (tek sefer), `production_output` hareketi 1 | geçti |
| Sevkiyat A | hedefte tam 1.000 kg, maliyet = 10.000 + navlun (tam), araç hedefte boşta | geçti |
| Taşıma işi B | taşımacıya tam 300.000 gelir (tek sefer), yük sahibinin emaneti 0, yük hedefte 2.000 kg, iş `delivered` | geçti |
| İkinci yayın (`runMigrations` iki kez daha) | tüm oyuncu verisi ve katalog özeti aynı; sistem sermayesi yeniden verilmedi (işlem sayısı = sistem şirketi sayısı); üçüncü açılışta da özet aynı | geçti |
| Yeni örnekte tam akış | yeniden başlatılmış örnekte yeni üretim başlar ve biter | geçti |

## 4) Çevrimdışı tamamlanma (`acceptance.int.test.ts` bölüm 4)

Oyuncular işleri kurup 60 saat boyunca hiç istek atmaz (`idempotency_keys` sayısı değişmez); yalnızca saat ve zamanlayıcı ilerler.

| Sonuç | Değer |
|---|---|
| Tekrar modlu üretim zinciri | 2 iş tamamlandı, wip 0, XP tam 2 × 10, 2 `production_settle` |
| Araştırma | agronomy seviye 1 |
| Kendi sevkiyatı | teslim, hedefte tam 1.000 kg |
| Sahipsiz ilan (yarı fiyatına) | sistem 3.000 kg'ı üstlendi, brüt 396.000; satıcı nakdi = brüt − komisyon + bakım (tam) |
| Günlük bakım | üç şirkette de en az 1 kez alındı |
| Oyuncu dönünce | bildirimler (2 `production_done`, araştırma bitti) ve `/company` nakdi defterle aynı |
| `checkInvariants` | boş |

## Arayüz (telefon/masaüstü, TR/EN)

Durum: **bekliyor.** Arayüz henüz tamamlanmadı. Yapılacaklar: telefon (390×844) ve masaüstü (1440×900) ekran görüntüleri, TR ve EN, boş durumlar ve şehir sahnesi. Canlı doğrulama (`e2e/live-smoke.mjs`) arayüz canlıya çıkınca çalıştırılacak.

## Notlar

- Test veritabanı: `capitalforge_test_qa`. Bu oturumda ortam değişkeni bazı kabuk çağrılarında tanımsız kaldığı için birkaç vitest çalıştırması (en az ilk 21 günlük çalıştırma) varsayılan `capitalforge_test` veritabanına gitti; harness bu veritabanının `cf` şemasını sildi ve yeniden kurdu. İçerik yalnızca test verisiydi ama istenen kuralın dışında kaldı. Sonraki tüm çalıştırmalar (tam `pnpm test:int` dahil) `TEST_DATABASE_URL` ile `capitalforge_test_qa` üzerinde yapıldı.
- Sonuç özeti her çalıştırmada `ACCEPTANCE_RESULTS` satırı olarak yazdırılır; tabloların sayıları bu satırdan alınmıştır.
- Bölüm 2 yaklaşık 2 dakika, tüm `pnpm test:int` yaklaşık 4 dakika sürer.
