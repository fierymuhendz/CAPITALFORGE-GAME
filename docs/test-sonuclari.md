# Kabul testi sonuçları (v2, sunucu düzeyi)

Çalıştırma: gerçek PostgreSQL (`capitalforge_test_qa`), Redis'siz harness (`apps/server/src/test/harness.ts`), zaman `h.advance(ms)` ile ilerletilir.
Her senaryo sonunda `checkInvariants(h.deps.db)` boş döner (defter toplamı 0, dengeli işlemler, önbellek bakiyesi = satır toplamı, nakit ≥ 0, stok hesabı = depo).
Para ve stok doğrulamaları tam sayıdır (kuruş, kg); tek istisna verim araştırması için tam tamsayı aralığıdır (aşağıda).

## Özet

| Takım | Komut | Sonuç |
|---|---|---|
| Birim | `pnpm test` | 18/18 geçti (2 dosya) |
| Entegrasyon | `pnpm test:int` | 84/84 geçti |
| Tür denetimi | `pnpm typecheck` | temiz |
| Uçtan uca (arayüz) | `e2e/ui` (Playwright, yerel tam kurulum) | aşağıdaki Arayüz bölümü |

Entegrasyon dosyaları: trade 7/7, security 20/20, production 15/15, finance 8/8, facilities 4/4, admin 13/13, found 2/2, acceptance 15/15.

## Bulgu ve düzeltme (denge)

İlk koşuda tarım 21 günde −19.045 kuruş zarar etti. Neden: oyuncu işlemi yokken sistem doygunluğu referans fiyatı her saat biraz daha aşağı itiyordu (Körfezkent tahılı 525 → ~315 kuruş/kg). Düzeltme (`packages/economy/src/pricing.ts` `nextDriftBp`): işlem yoksa referans tabana (10000 bp) döner, doygunluk en fazla 1000 bp aşağı iter. Aynı turda sistem taşıma tarifesi yeniden ayarlandı (kalkış ₺450, km başına ₺32). Düzeltmeden sonra 15/15 kabul testi geçti; tablo aşağıda.

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
| 17 | Çok haftalı zaman ilerletme (21 gün) | `acceptance.int.test.ts` bölüm 2 (6 test); `trade.int.test.ts` "birkaç gün sonunda günlük bütçe ve miktar sınırları aşılmaz" (3 gün) | 6/6 geçti |
| 18 | Arayüz (telefon/masaüstü, TR/EN) | `e2e/ui/ui-e2e.mjs` (Playwright) | 7 akış 4 yapılandırmada çalıştı; 5 arayüz hatası açık (aşağıda, en önemlisi telefonda alt sayfa düğmelerinin alt çubuğun altında kalması) |

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
| Tarım | 61.846.416 | 50.471.950 | 11.374.466 | 56 | geçti |
| Hayvancılık | 74.135.600 | 58.365.528 | 15.770.072 | 55 | geçti |
| Madencilik | 80.738.220 | 48.994.905 | 31.743.315 | 126 | geçti |
| İmalat | 69.498.000 | 60.962.980 | 8.535.020 | 22 | geçti |
| Taşımacılık | 95.366.000 | 81.879.935 | 13.486.065 | 126 sistem işi üstlenildi | geçti |

Sistem şirketleri günlük bütçelerinin en çok %49'unu kullandı, nakitleri hiç eksiye düşmedi. Net değer değişimi her sektörde kâra eşit. İmalat ve hayvancılık, sistemden pahalı girdi almak yerine oyunculardan almaya teşvik edilir: sistem fiyatıyla kâr marjı düşük olduğunda kâr-bilinçli kural üretimi atladı (imalat 104, hayvancılık 50 tur).

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

**Yeniden koşu (düzeltmelerden sonra, taze veritabanı, telefon TR ve masaüstü EN, 7 akış):** 67 adım geçti, 2 adım başarısız oldu. İkisi de aynı nedendi: denetim kaydındaki yeni eylem kodları (`admin.claim`, `admin.totp_enable`, `admin.totp_verify`) çevrilmeden ham görünüyordu; TR/EN çevirileri eklendi. B1 (telefonda alt sayfa düğmeleri), B2 (arsa ayrıntısı görünürlüğü), B3 (nakliye yükü), B4 (araştırma kilidi) ve B5 (dar panel tabloları) düzeltildi; bu koşuda ilgili adımlar geçti.

Ortam: web `http://localhost:3100` (üretim derlemesi, `/api` vekil), sunucu `:2600` (`ALLOW_TIME_TRAVEL=1`, `DISABLE_RATE_LIMIT=1`). Telefon: Playwright `iPhone 13` (390×664 görünür alan, `deviceScaleFactor` 1), masaüstü 1440×900. Dil: kayıt sayfasındaki TR/EN düğmesi ve hesap paneli. Her çalıştırma yeni hesaplar açar; hiçbir üretim kodu değiştirilmedi.

Çalıştırma: `node e2e/ui/ui-e2e.mjs [phone-tr phone-en desktop-tr desktop-en] [--flows=1,2,...]` (yardımcılar `e2e/ui/lib.mjs`; ek denetimler `e2e/ui/wizard-visibility.mjs`, `e2e/ui/research-busy.mjs`). Ham sonuç `e2e/ui/out/*.json`, ekran görüntüleri `docs/screenshots/e2e-*.png`.

Yönetici: kurulum kodu tek kullanımlık olduğundan bir kez sahiplenildi (`e2e/ui/.admin-state.json`, git dışı); TOTP kodu RFC 6238 ile node `crypto` ile üretilir, sunucu saati (zaman yolculuğu) esas alınır. Zaman ilerletme `POST /api/admin/time/advance` ile.

### Senaryo → sonuç

Hücre: geçti / hata (hata = aşağıdaki bulgu numarası). TR ve EN, telefon (T) ve masaüstü (M) ayrı çalıştırıldı.

| # | Senaryo | T-TR | T-EN | M-TR | M-EN |
|---|---|---|---|---|---|
| 1 | Kayıt (dil düğmesi), sihirbaz: ad, şehir, sektör, uygun arsa; arsa fiyatı + konum + kaynak/müşteri uzaklığı; `/play` şehir görünümü (canvas) | geçti, B2 | geçti, B2 | geçti, B2 | geçti, B2 |
| 2 | Çekirdek döngü: tesis kartı, teklif (girdi, çıktı, süre, birim maliyet), tek elle başlat (alt yarı, 54 px), zaman ilerlet, iş biter, un envanterde, sisteme satış, finansta gelir ve satış satırı (tam tutar eşleşmesi) | geçti, B1 | geçti, B1 | geçti | geçti |
| 3 | Nakliye: kurulum, başlangıç kamyonu, boş durum metinleri, panodan iş kabul, araç + yük + varış (sevkiyat, `world/map`), şehir görünümü | geçti (B3) | geçti (B3) | geçti (B3) | geçti (B3) |
| 4 | Pazar: ilan ver, ikinci hesapla satın al, satıcı satış satırında tahsilat, COGS, ücret (%1), net kâr; net = tahsilat − COGS − nakliye − ücret (tam sayı) | geçti* , B1 | geçti, B1 | geçti | geçti |
| 5 | Sözleşme: yinelenen teklif, kabul öncesi koşullar (ürün, kalite, miktar, birim fiyat, şehir, nakliye ödeyen, ilk vade, aralık, tolerans, eksik/gecikme cezası, iptal), kabul, aktif + takvim | geçti*, B1 | geçti, B1 | geçti | geçti |
| 6 | Yönetim: oyuncu `/admin`'de yönetim sekmesi görmez, `GET /admin/overview` ve `POST /admin/time/advance` 403; yönetici 2FA ekranından sonra genel bakış ve 8 sekme yüklenir | geçti | geçti | geçti | geçti |
| 7 | Her panelde görünür düğmeler tıklanır (ölü düğme yok), ham çeviri anahtarı yok, konsol/sayfa hatası yok, telefon alt gezinme + Daha fazla, masaüstü kenar sekmeleri, dil değiştirme | geçti (B4) | geçti (B4) | geçti (B4) | geçti (B4) |

\* T-TR akış 3–5 ilk (yarım kalan) turda geçti; sonuç dosyası sonradan değiştiği için yalnızca akış 1, 2, 6, 7 ve ek akış 3, 6 turları kayıtlıdır (`results-phone-tr-a.json`, `-b.json`). Akış 4 ve 5'in T-TR ekran görüntüleri yok; T-EN ile aynı davranış gözlendi.

Sayılar (adım): M-EN 38/38, M-TR 38/38, T-EN 38/42 (4 adım B1 nedeniyle "tıklanamıyor" olarak işaretli, akış sonra DOM tıklamasıyla sürdürüldü), T-TR (a) 24/27 + (b) 12/12. T-TR (a)'daki 3 kayıt test düzeneği sorunuydu, düzeltilip yeniden koşuldu: yönetici hesabının dili `en` idi (T-TR 2FA ekranı İngilizce göründü), ve hesap panelindeki dil düğmeleri taramada tıklanınca sonraki adımlar İngilizce kaldı. İkisi de betikte giderildi; T-TR akış 6 `-b` turunda, akış 7 alt çubuk adımı T-EN turunda geçti.

Konsol/ağ: tüm koşularda sayfa hatası 0, ham çeviri anahtarı (TR ve EN, 10 panel + yönetim sekmeleri + sihirbaz + alt çubuk) 0, beklenmeyen 4xx/5xx 0. Tek 4xx/5xx kaynağı B4 (422 `RESEARCH_BUSY`, beklenen doğrulama).

Para doğrulaması (tam sayı, kuruş): satış satırı tahsilat/COGS/ücret/net, `/api/finance/sales` ile eşleşti; örnek M-EN akış 4: tahsilat 383.625, COGS 282.375, ücret 3.836, net 97.414 (383.625 − 282.375 − 0 − 3.836 = 97.414). Genel bakış geliri `pnl.revenue` ile eşleşti.

Boş durumlar (taze nakliye hesabı): envanter, sözleşmelerim, satışlar, sevkiyatlar yönlendirme metni gösterdi (dört yapılandırmada).

### Hatalar

**B1 (yüksek, yalnızca telefon, TR ve EN): paneldeki alt sayfaların gönder düğmeleri alt gezinme çubuğunun altında kalıyor.**
Adımlar: telefonda kayıtlı, stoklu hesap > alt çubuktan Piyasa > Un > "Sat" (sistem alım emri) > "Miktar" gir. Gönder düğmesi (Sat / Satın al / İlan oluştur / Sözleşme "Kabul et") `.tabbar` tarafından örtülü; tıklama alt çubuğa gidiyor (`elementFromPoint` = `.tabbar`, düğme y=593–647, görünür alan 664, alt çubuk 600'den başlıyor). Aynı durum ilan oluşturma, satın alma ve sözleşme kabul sayfalarında. Kullanıcı kaydırınca da düğme sayfa sonunda alt çubuğun arkasında kalıyor; ana akışlar (satış, alım, ilan, sözleşme kabulü) telefonda tamamlanamıyor.
Ekran görüntüleri: `docs/screenshots/e2e-phone-en-f2-blocked-Sat-g-nder.png`, `e2e-phone-en-f4-blocked--lan-olu-tur-g-nder.png`, `e2e-phone-en-f4-blocked-Sat-n-al-g-nder.png`, `e2e-phone-en-f5-blocked-S-zle-me-kabul.png`, `e2e-phone-tr-f2-blocked-Sat-g-nder.png`, `e2e-phone-tr-f5-terms.png`.
Şüpheli: `apps/web/src/ui/ui.css:211` (`.overlay.panel-overlay { z-index: 30 }` yeni yığın bağlamı açıyor; içindeki `Sheet` kaplaması, `ui.css:145` z-index 60, bu bağlamda kalıp `.tabbar` `ui.css:205` z-index 40'ın altında çiziliyor). Düzeltme yönü: iç içe `Sheet`'i portal ile `body`'ye çıkarmak (`apps/web/src/ui/Sheet.tsx`) veya `.panel-overlay` z-index değerini 40 üstüne almak.

**B2 (orta, tüm boyutlar): kuruluş sihirbazında arsa seçilince fiyat, konum ve kaynağa/müşteriye uzaklık kartı ekranın dışında kalıyor.**
Adımlar: `/register` > kayıt > ad > şehir > sektör > "Arsa seç" adımı > uygun (✓) bir hücreye dokun. Hücrede yalnızca konum, fiyat ve hektar var; uzaklıklar (en yakın hammadde, en yakın alıcı) ve seçim yönlendirmesi ızgaranın altındaki karttadır ve kaydırmadan görünen oranı 0 (telefon) ve 0,01 (masaüstü, 1440×900). Liste görünümündeki kartlarda kaynak/müşteri uzaklığı hiç yok (yalnız merkeze km). Kart içeriği doğru ve eksiksiz, sorun yerleşim.
Ekran görüntüleri: `docs/screenshots/e2e-desktop-en-f1-wizard-plot.png`, `e2e-phone-tr-f1-wizard-plot.png`, `e2e-phone-tr-wizard-detail-after-select.png`, `e2e-desktop-en-wizard-detail-after-select.png`. Ölçüm: `e2e/ui/out/wizard-visibility.json`.
Şüpheli: `apps/web/src/features/found/FoundWizard.tsx` arsa adımı (`PlotGrid` ardından `PlotDetail`, satır ~128–137) ve `PlotCard` (satır 190, yalnız `distCenter`). Öneri: seçili arsa detayını ızgaranın üstüne/sabit alta almak veya liste kartlarına uzaklık eklemek.

**B3 (düşük): nakliye panosunda sistem işlerinin kartı yük içeriği ve ağırlığı göstermiyor.**
Adımlar: nakliye hesabı > Lojistik > Nakliye panosu. Kartta "Yük" satırı boş ve `Yeşilova Toptan [Sistem] →` sonrası alıcı adı boş. Sunucu yükü taraf olmayana gizliyor (`apps/server/src/logistics/jobs.ts:171`, yorumlu bilinçli) ama `totalKg` döndürüyor; arayüz kullanmıyor.
Ekran görüntüsü: `docs/screenshots/e2e-phone-en-f3-board.png`. Şüpheli: `apps/web/src/features/logistics/LogisticsPanel.tsx:132-133` (`j.cargo.map` boş dizide boş çıktı; `j.totalKg` gösterilmeli, alıcı boşsa "→" gizlenmeli). Kabul sonrası sevkiyat yükü ("Tahıl ★2 4 t") ve hedef doğru görünüyor.

**B4 (düşük): araştırma sürerken diğer "Başlat" düğmeleri açık kalıyor.**
Adımlar: Araştırma paneli > herhangi bir "Başlat" > diğer 6 düğme açık > birine bas: 422 `RESEARCH_BUSY` hata bildirimi. Beklenen doğrulama olarak yakalanıyor ama düğme pasif ve gerekçeli olmalı.
Ekran görüntüleri: `docs/screenshots/e2e-desktop-en-research-busy.png`, `e2e-desktop-en-research-busy-error.png`. Şüpheli: `apps/web/src/features/more/ResearchPanel.tsx:37` (`disabled={locked}`; `d.items.some((x) => x.inProgress)` eklenmeli).

**B5 (düşük, masaüstü): 480 px yan panelde tablolar taşıyor; birincil eylem sütunu kırpılıyor.**
Adımlar: masaüstü > Piyasa > Un > alım emirleri tablosu: "Sat" düğmesi sağ kenarda yarım ("Sel"), yalnızca yatay kaydırmayla tam görünür. Sekme çubuğunda son sekmeler de kırpık (kaydırma çubuğu gizli, `ui.css:196-197`). Yönetim genel bakış tablosunda son sütun ("Sistem payı") kırpık.
Ekran görüntüleri: `docs/screenshots/e2e-desktop-en-f2-market-flour.png`, `e2e-desktop-en-f6-admin-overview.png`. Şüpheli: `apps/web/src/ui/ui.css:126-130` (`.tbl-wrap`), `apps/web/src/ui/Table.tsx` (`cards-sm` yalnızca küçük ekranda), `ui.css:195` (`.side` 380–480 px).

### Gözlemler (hata değil)

- Kuruluş arsaları sınırlı: şehir başına 8 uygun arsa. Test sırasında Körfezkent, Kavşak ve Akyayla doldu; arsası kalmamış şehirde sihirbaz şehir adımında uyarmıyor, 4. adımda tüm hücreler ✕ görünüyor ve "uygun arsa yok" boş durumu ızgaranın altında kalıyor (`docs/screenshots/e2e-phone-tr-f1-fail-sihirbaz-ad-ehir-sekt-r-.png`). Şehir kartında boş uygun arsa sayısı gösterilebilir.
- Sözleşme koşullar ekranı kabulden önce ilk vade, aralık, tolerans, taksit sayısı ve ceza/iptal koşullarını gösteriyor; her taksitin tarih listesi ("Takvim") kabulden sonra görünüyor.
- Nakliye sektöründe arsa ayrıntısında kaynağa/müşteriye uzaklık yok (nakliye için anlamsız olabilir).
- Telefonda "Üretimi başlat" düğmesi y=533/664 (alt yarıda, 54 px yüksek); teklif (girdi/çıktı/süre/birim maliyet) düğmenin altında kaydırmayla görünüyor, düğme formun üstünü örtüyor (`docs/screenshots/e2e-phone-tr-f2-quote.png`).
- Sistem alım talebi tükenebilir (Demirdağ una 1.768 kg); koşu sırasında satış miktarı 500 kg ile sınırlandı.

### Doğrulama çıktısı

- `pnpm test`: 2 dosya, 18/18 geçti.
- `pnpm test:int`: bu bölümün kapsamı dışında (sunucu düzeyi, ayrı veritabanı); özet tablosundaki 84/84 başka koşudan.
- `pnpm e2e`: kökte böyle bir komut yok (`package.json`); arayüz testi `node e2e/ui/ui-e2e.mjs` ile çalışır. İsterseniz `"e2e": "node e2e/ui/ui-e2e.mjs"` eklenebilir (üretim dosyası olduğu için eklemedim).
- `node e2e/ui/ui-e2e.mjs desktop-en`: `== desktop-en: 38 geçti, 0 kaldı; konsol hatası 5, sayfa hatası 0, API 4xx/5xx 5` (5'i B4, 422). `desktop-tr`: aynı. `phone-en`: 38 geçti, 4 kaldı (B1). `phone-tr --flows=1,3,6` (Yeşilova): 12 geçti, 0 kaldı.

## Notlar

- Test veritabanı: `capitalforge_test_qa`. Bu oturumda ortam değişkeni bazı kabuk çağrılarında tanımsız kaldığı için birkaç vitest çalıştırması (en az ilk 21 günlük çalıştırma) varsayılan `capitalforge_test` veritabanına gitti; harness bu veritabanının `cf` şemasını sildi ve yeniden kurdu. İçerik yalnızca test verisiydi ama istenen kuralın dışında kaldı. Sonraki tüm çalıştırmalar (tam `pnpm test:int` dahil) `TEST_DATABASE_URL` ile `capitalforge_test_qa` üzerinde yapıldı.
- Sonuç özeti her çalıştırmada `ACCEPTANCE_RESULTS` satırı olarak yazdırılır; tabloların sayıları bu satırdan alınmıştır.
- Bölüm 2 yaklaşık 2 dakika, tüm `pnpm test:int` yaklaşık 4 dakika sürer.

Tam ekran görüntüsü seti (192 adet) depoya alınmadı; depoda her akıştan temsilî görüntüler var (`docs/screenshots/e2e-*`).

# v3 kabul testi sonuçları (sunucu düzeyi)

Dosya: `apps/server/src/test/v3-acceptance.int.test.ts` (12 test). Gerçek PostgreSQL (`capitalforge_test_v3acc`), zaman `h.advance`, her senaryo sonunda `checkInvariants` boş. Para kuruş, kütle kg; tüm karşılaştırmalar tam sayı. Üretim koduna dokunulmadı.

| Takım | Komut | Sonuç |
|---|---|---|
| Birim | `pnpm test` | 38/38 (4 dosya) |
| Entegrasyon | `pnpm test:int` | 107/107 (11 dosya; v3-acceptance 12) |
| Tür denetimi | `pnpm typecheck` | temiz |
| Uçtan uca | `pnpm e2e` | kökte komut yok (`ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`), koşulamadı |

## Senaryo → sonuç

| # | Senaryo | Sonuç |
|---|---|---|
| 1 | Yakın-pahalı ↔ uzak-ucuz sıralaması dört etkenle döner; iki anlaşma gerçekten alınır, taşınır, işlenir, satılır; stok, defter, SaleDto, outcomes mutabık | geçti |
| 2 | Altı yol (tarım, hayvancılık, madencilik, imalat gıda, imalat çelik, taşımacılık): ilk iş → ilk gelir → yatırım; süre tavanı 60 dk | geçti (8 test) |
| 3 | İki şirket arası 4 taksitli sözleşme: kabul öncesi compare, kendi aracı + sistem işi + oyuncu taşımacı, hepsi yerleşir | geçti |
| 4 | Çevrimdışı 60 saat, 0 HTTP isteği; iş, sevkiyat, taksit tam bir kez | geçti |
| 5 | ESKİ şema/katalogda kurulan dünya → migration + revizyon; şirket ve sözleşme aynen, yönetici düzenlemesi ezilmez | geçti |

## 1) İki anlaşma (ürün: tahıl, teslim: Körfezkent, fiyat penceresi: uzak 300, yakın 358 kuruş/kg)

Sıralama (teslim birim maliyeti = mal + navlun):

| Durum | Yakın (Kavşak, 120 km, 358) | Uzak (Demirdağ, 250 km, 300) | Sıra |
|---|---|---|---|
| 4.000 kg | 1.432.000 + 434.099 = 1.866.099 (467/kg) | 1.200.000 + 806.986 = 2.006.986 (502/kg) | yakın > uzak |
| 12.000 kg (tam kamyon) | 4.296.000 + 659.400 (413/kg) | 3.600.000 + 1.248.200 (405/kg) | uzak > yakın |
| 13.000 kg (2 kamyon, SPLIT_LOADS) | 4.654.000 + 1.009.019 (436/kg) | 3.900.000 + 1.889.746 (446/kg) | yakın > uzak |
| 12.000 kg, km ücreti ×4 (12.800) | 4.296.000 + 2.502.600 (567/kg) | 3.600.000 + 4.857.800 (705/kg) | yakın > uzak |
| 12.000 kg, teslim Kavşak | navlun 0 (358/kg) | 3.600.000 + 813.000 (368/kg) | yakın > uzak |
| 4.000 kg, 300'lük ilan 180 km'de (Yeşilova) | 467/kg | Yeşilova 454/kg; Demirdağ 502/kg | Yeşilova > yakın > uzak |

Gerçek yürütme (A: yakın 4.000 kg, B: uzak 12.000 kg; her biri kendi miktarında kazanan teklif):

| Kalem | A | B |
|---|---|---|
| Mal | 1.432.000 | 3.600.000 |
| Navlun | 434.099 | 1.248.200 |
| Girdi maliyeti (varışta depo maliyeti) | 1.866.099 | 4.848.200 |
| Üretim işletme gideri (enerji+su+işçilik) | 321.000 | 963.000 |
| Un çıktısı | 3.300 kg | 9.900 kg |
| Un maliyeti (COGS) | 2.187.099 | 5.811.200 |
| Gelir (1.200/kg alım emri) | 3.960.000 | 11.880.000 |
| Satış komisyonu | 39.600 | 118.800 |
| Gerçekleşen net kâr (SaleDto) | 1.733.301 | 5.950.000 |
| Nakit değişimi (ek bakım yok) | +1.733.301 | +5.950.000 |

Mutabakat: varış deposu maliyeti = mal + navlun (tam); üretim girdi çıkışı toplamı = bu tutar; un lotu maliyeti = iş maliyetleri toplamı = COGS; her defter işlemi toplamı 0; anlaşma işlemlerinin nakit toplamı = SaleDto net kâr; purchase outcome beklenen = gerçekleşen (goods, freight, cost); production beklenen maliyet = gerçekleşen. Üretim tahmin kârı en iyi alıcıya (1.395/kg) göre hesaplanır, satış 1.200'lük emre yapıldı: tahmin toplamı A 2.370.367, B 7.861.198; fark alıcı seçiminden gelir.

## 2) Kazanç yolları (taze şirket; sayılar testten)

| Yol | İlk iş | Net gelir | Seçenekler (bedel, geri dönüş) | Seçilen |
|---|---|---|---|---|
| Tarım | grow_grain 2.318 kg (grow_fodder 253.860 yerine tahmin 451.622) | 451.622 | araştırma agronomy 2.500.000/36 parti; kalite kontrol 5.000.000/64; tesis kalitesi 3.500.000/45; seviye 7.000.000 kapalı (LEVEL_TOO_LOW) | agronomy: 2.318 → 2.503 kg |
| Hayvancılık | milk_cows 1.192 kg | 340.052 | herd_health 3.000.000/49; kalite 5.000.000/73; tesis kalitesi 4.000.000/58; seviye kapalı | herd_health: 1.192 → 1.287 |
| Madencilik | mine_coal 3.622 kg (mine_iron: DEPOSIT_MISMATCH) | 568.517 | drilling 3.000.000/43; kalite 5.000.000/64; tesis kalitesi 4.000.000/51; seviye kapalı | drilling: 3.622 → 3.912 |
| İmalat gıda | mill_flour 1.650 kg | 738.266 | lean_process 3.500.000/237; kalite kontrol 5.000.000/29; tesis kalitesi 5.000.000/29; seviye kapalı | kalite kontrol: kalite 2 → 3 |
| İmalat çelik | smelt_steel 1.100 kg | 479.049 | lean_process 3.500.000/99; kalite kontrol 5.000.000/32; tesis kalitesi 5.000.000/32 | kalite kontrol: 2 → 3 |
| Taşımacılık | Kavşak→Yeşilova 12 t, ücret 581.670, 20 dk | 314.854 (yakıt 225.000, sürücü 36.000, komisyon 5.816) | kamyonet 6.000.000/20 sefer; kamyon 18.000.000 kapalı (INSUFFICIENT_FUNDS); eco_driving 2.000.000/112; route_planning 2.500.000/133 | kamyonet: filo 1 → 2 |

Geri dönüş birimi parti/sefer = bedel / parti başına tahmini ek net kâr (yukarı yuvarlı). Her yatırımda nakit düşüşü bedele tam eşit, etki sonradan teklifte ölçüldü.

Süre tavanı (settings.pace.maxMinutes = 60): en uzun üretim 60 dk (13 iş), en uzun sevkiyat 43 dk, inşaat 60 dk (katalog 240), seviye yükseltme 60 dk (katalog 360), kalite iyileştirme 60 dk; araştırma nextMinutes ≤ 60; /world tarif, bina, araştırma süreleri ≤ 60.

## 3) Sözleşme (Yeşilova → Körfezkent, 180 km, 4 × 3.000 kg × 600 kuruş/kg)

Kabul öncesi compare (satıcı): taksit başı mal 1.800.000, navlun 572.904, net 1.227.096 (409/kg); toplam net 4.908.384; teminat 720.000, emanet 7.200.000, kaçan taksit cezası 180.000; bugün spot 298/kg (302 fiyat, 12.000 kg, net 3.587.760). Alıcı tarafında spotNow = en ucuz ilan + navlun (mal + navlun) doğrulandı.

Teslimler: 1 kendi kamyonet, 2 sistem taşımacısı işi, 3 oyuncu taşımacı işi, 4 sistem işi; hepsi vadeden önce (30/105/45/105 dk). Hepsi `fulfilled`, her taksit için tam 1 `installment_settle`, emanetler 0, sözleşme `completed`.

| | Beklenen (kabulde) | Gerçekleşen |
|---|---|---|
| Gelir | 7.200.000 | 7.200.000 |
| Navlun | 2.291.616 | 1.976.962 (kendi araç 258.250; diğer üç 572.904) |
| Maliyet | 1.800.000 | 1.800.000 |
| Kâr | 3.108.384 | 3.423.038 |

Alıcı: mal 7.200.000, stok 12.000 kg maliyet 7.200.000.

## 4) Çevrimdışı (60 saat, HTTP isteği 0, idempotency anahtarı değişimi 0)

4 üretim (tekrar modu) = 4 `production_settle`, çıktı 6.600 kg = un stoku, wip 0, XP +40; araştırma lean_process seviye 1 (1 işlem); kendi sevkiyatı 1.000 kg; alım+teslim 6.000 kg maliyet 2.591.112 (navlun 791.112); sözleşme 3 teslim + 1 kaçan (ceza 22.500), 4 `installment_settle`; teslim olan 17 sevkiyatın varış işlemi ≤ 1 (iş bağlıysa tam 1); eşzamanlı 3 ek tur sayıları değiştirmez; bildirimler: 4 `production_done`, 4 `installment_closed`.

## 5) Canlı güncelleme

Eski durum: fiyatlar iron_ore 180, coal 220, flour 1050, packaged_milk 1400; maxBatches [2,3,4]; revizyon işareti silindi; `0003` geri alındı (3 tahmin kaydı gitti). Yönetici API ile flour 1111, coal 250, mill_flour 77 dk, komisyon 150 bp; steel_mill satırı DB'de yönetici benzetimi (yönetici API'si yok). Yeniden başlatma (`keepDb`): 38 tablonun satır sayısı ve içerik özeti birebir aynı, nakit (X 17.954.000; S 16.380.000), stok, tesis, çalışan iş (2 parti, 3.300 kg), oturum çerezi aynı. Revizyon: iron_ore 260, packaged_milk 1550, field/barn/mine/food_plant maxBatches [1,2,3]; atlanan (edited): flour, coal, steel_mill. İkinci yayın ve iki ek migration: değişiklik yok. Sonrasında çalışan iş tek settle, sözleşme 3/3 `fulfilled`, araştırma seviye 1; eski iş 2 parti biter, yeni 2 parti iş BATCHES_EXCEED_CAPACITY.

## Notlar

- Başka bir koşu aynı `capitalforge_test` şemasını sildiği için çakışma oldu (500 / "cf.companies yok"); testler izole `capitalforge_test_v3acc` ile koşuldu.
- İlk koşudaki `perKg −490 ≠ −489` ve `−87.500` nakit farkı gerçek hata değil, test hatasıydı: compare `floorDiv` kullanır (negatifte aşağı), bakım/iade nakdi test ölçümüne karışmıştı. İzole koşuda iki doğrulama da doğru değerle geçiyor.

## Şirket Muhasebesi ve ilk satış akışı (2026-11-27)

| Takım | Komut | Sonuç |
|---|---|---|
| Tür denetimi | `pnpm typecheck` | temiz |
| Birim | `pnpm test` | 41/41 |
| Entegrasyon | `pnpm test:int` | 124/124 (14 dosya), yeni `finance/accounting.int.test.ts` 4/4 |
| Web derlemesi | `pnpm --filter @capitalforge/web build` | başarılı |
| Uçtan uca | `node e2e/ui/accounting-flow.mjs phone-tr desktop-tr phone-en desktop-en` | 4 yapılandırmada 9/9 adım |

Kabul: örnek satış 1.000 − 600 − 50 − 10 = 340 net kâr; ardından 500 kredi kasayı +500 artırır, gelir/gider/net değişmez, kredi finansman nakit akışında. İki şirket yalıtımı (özet, işlem listesi, satış izi 404, alıcıya maliyet/kâr/defter işlemi gizli, `?companyId=` etkisiz, `private, no-store`), dönem sınırı (dün 23:59:59.999 / bugün 00:00 İstanbul, 8 gün önce 7 günde yok 30 günde var), ters kayıt kendi gününe düşer ve ikinci kez yazılmaz, aynı idempotency anahtarıyla satış ve kredi bir kez sayılır, her dönemde açılış + net nakit = kapanış = şimdiki kasa.
