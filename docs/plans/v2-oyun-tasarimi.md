# Capital Forge v2: oyun tasarımı ve mimari

Bu belge yeniden inşanın tek kaynağıdır. Sayısal değerler (fiyat, tarif, mesafe) burada değil
`packages/shared/src/catalog/` içindedir; belge mekaniği ve değişmezleri anlatır.

## 1. Oyunun özü

Tek, kalıcı bir dünya. Her oyuncunun bir şirketi vardır. Dünya gerçek zamanla akar: üretim ve
sevkiyat gerçek saatlerle sürer, oyuncu çevrimdışıyken de sunucuda tamamlanır.

Avantaj şuradan gelir:
- Karşılanmayan talebi erken görmek (alım emirleri, sistem talebi, sözleşme panosu).
- Malı müşteriye götürmenin maliyetini hesaplamak (mesafe, araç kapasitesi, yakıt, sürücü saati, süre).
- Söz verilen miktarı zamanında teslim etmek (itibar puanı, tekrarlayan sözleşmeler).

## 2. Dünya

### Şehirler (5)
| id | Ad | Karakter |
|---|---|---|
| `korfezkent` | Körfezkent | Liman ve sanayi metropolü. Tüketim talebi yüksek, arsa pahalı, nitelikli iş gücü (fabrika verimi). |
| `yesilova` | Yeşilova | Verimli ova. Su ucuz, tarla verimliliği yüksek. |
| `akyayla` | Akyayla | Yayla ve mera. Hayvancılık verimi yüksek, serin. |
| `demirdag` | Demirdağ | Maden kenti. Demir cevheri ve kömür yatakları, enerji ucuz, su pahalı, ücret yüksek. |
| `kavsak` | Kavşak | Ülkenin ortasında lojistik merkezi. Garaj ucuz, yollar her şehre kısa. |

Her şehrin: enerji (kWh), su (m³), ücret (işçi-saat) fiyatı; sektör verim çarpanı; yerel talep ve
arz profili; diğer şehirlere km cinsinden yol mesafesi vardır.

### Arsalar
Her şehirde 4x4 = 16 arsa. Her arsa: fiyat, gereken şirket seviyesi, büyüklük, verimlilik (tarla),
mera kalitesi (hayvancılık), maden yatağı türü ve zenginliği (sadece maden arsaları), şehir merkezine
(müşteriye) ve en yakın hammadde kaynağına uzaklık. Bir arsada bir bina olur.
- Seviye ve bütçe ayrı ayrı denetlenir (`LEVEL_TOO_LOW`, `INSUFFICIENT_FUNDS`).
- Her sektör için en az iki şehirde seviye 1'de başlangıç parasıyla alınabilen arsa vardır (test edilir).
- Maden binası yalnızca maden yatağı olan arsaya kurulur.

### Sektörler ve başlangıç binası
| Sektör | Başlangıç binası | Ne üretir |
|---|---|---|
| `crop` Tarım | Tarla (`field`) | yem bitkisi, tahıl |
| `livestock` Hayvancılık | Ahır (`barn`) | çiğ süt (yem bitkisi tüketir) |
| `mining` Madencilik | Maden ocağı (`mine`) | demir cevheri veya kömür (arsadaki yatağa göre) |
| `manufacturing` İmalat | Gıda fabrikası (`food_plant`) veya çelikhane (`steel_mill`) | un, paketli süt, peynir / çelik |
| `freight` Taşımacılık | Garaj (`garage`) + çalışır kamyon | taşıma işi geliri |

Başlangıç bağışı şirket başına bir kez verilir (`starter_grants` tablosunda şirket benzersiz
kısıtı). Hayvancılık ve imalat için ilk işin girdileri de bağışla verilir; tarım tohumu sistem
tedarikçisinden alır (her şehirde satılır).

### Tedarik zincirleri
1. **Süt zinciri:** tarla (yem bitkisi) → ahır (çiğ süt) → gıda fabrikası (paketli süt, peynir) → şehir tüketicisi. Taşımacı aradaki sevkiyatları yapar.
2. **Un zinciri:** tarla (tahıl) → gıda fabrikası (un) → şehir tüketicisi.
3. **Çelik zinciri:** maden (demir cevheri + kömür) → çelikhane (çelik) → bina yükseltmeleri, yeni bina inşaatı (oyuncular) ve Ulusal İnşaat (sistem alıcı). Kömürün ayrıca santral alıcısı vardır.

Çelik oyuncular için gerçek bir girdidir: bina yükseltmesi ve yeni bina inşaatı depoda çelik ister.

### Veri modeli genişletilebilirliği
Ürün, bina türü, tarif, araştırma, araç modeli ve şehir **metin kimlikli katalog satırlarıdır**
(`products.id = 'grain'`). Katalog varsayılanları koddadır; sunucu açılışında eksik satırlar eklenir
(`ON CONFLICT DO NOTHING`), var olanlar ezilmez (yönetici düzenlemeleri korunur). Yeni ürün/bina eklemek =
katalog dosyasına satır eklemek. Şirket, tesis, stok kayıtları değişmez.

## 3. Üretim

Tarif: bina türü, girdiler (ürün + kg), çıktı (ürün + kg), süre (dakika), işçi-saat, enerji (kWh),
su (m³), minimum bina seviyesi. Bir iş `batches` parti çalıştırır (bina kapasitesi sınırı).

Hesap (`packages/economy/production.ts`, saf):
- Çıktı = taban × parti × arsa çarpanı (verimlilik/mera/yatak) × şehir sektör çarpanı × (1 + araştırma verim bonusu).
- Enerji ve işçi-saat imalat verim araştırmasıyla azalır.
- Süre: taban süre (parti sayısından bağımsız; kapasite paralel çalışır).
- Kalite (1–5): girdisi olan tariflerde girdi kalitelerinin ağırlıklı ortalaması, girdisizlerde 2;
  + (tesis kalite seviyesi − 1) + kalite araştırması seviyesi bonusu; 1..5'e kırpılır.
- Birim maliyet tahmini = (girdi maliyeti + enerji + su + ücret) / çıktı.

İş başlarken: girdiler stoktan düşer (ağırlıklı ortalama maliyetle), enerji+su+ücret nakitten
ödenir, hepsi `wip` (yarı mamul) hesabına yazılır. İş bitince wip → stok (çıktı maliyeti = toplam
maliyet). Gider bir kez sayılır: üretim maliyeti satışta SMM (satılan malın maliyeti) olur.

Tekrar modu: iş bitince aynı tarif, girdi varsa otomatik yeniden başlar; yoksa hat "girdi eksik"
nedeniyle durur (yönetici bunu görür).

Bina seviyesi 1–3: eşzamanlı hat sayısı ve parti kapasitesi. Yükseltme nakit + çelik + süre ister
ve şirket seviyesi ≥ hedef seviye olmalıdır. Kalite iyileştirmesi tesis kalite seviyesini artırır.

## 4. Depo ve muhasebe

`holdings` (şirket, şehir, ürün, kalite) başına: miktar (kg), rezerve miktar, toplam maliyet.
Kullanılabilir = miktar − rezerve. Ağırlıklı ortalama birim maliyet = toplam maliyet / miktar.
Çıkışta maliyet: tamamı çıkıyorsa kalan toplam maliyet, değilse `floor(maliyet × çıkan / miktar)`
(`packages/economy/money.ts` içinde tek kural). Her giriş/çıkış `inventory_movements` satırıdır
(kaynak referansı ve maliyet kırılımı JSON'u ile).

### Çift taraflı defter
- `ledger_accounts`: sahip (şirket veya sistem), kod, tür (asset/liability/equity/revenue/expense), önbellekli bakiye.
- `ledger_transactions`: tür, `idempotency_key` (benzersiz), referans (tür + id), açıklama.
- `ledger_entries`: işlem, hesap, işaretli tutar (borç +, alacak −). Her işlemde toplam 0.
- Bakiye aynı veritabanı işleminde güncellenir. Nakit hiçbir zaman negatife düşmez (CHECK + kod).
- Hiçbir kayıt düzenlenmez veya silinmez; düzeltme ters kayıtla yapılır.

Şirket hesapları: `cash`, `inventory`, `wip`, `escrow` (sözleşme emaneti, teminat, navlun emaneti),
`prepaid_freight`, `fixed_assets`, `loans`, `arrears`, `equity`, `revenue_sales`, `revenue_freight`,
`revenue_other`, `cogs`, `exp_freight`, `exp_fees`, `exp_interest`, `exp_upkeep`, `exp_research`,
`exp_penalties`, `exp_fleet` (taşımacının kendi işi için yakıt ve sürücü), `exp_other`.

Sistem hesapları: `world` (para basımı/yok edilmesi), `utilities`, `labor`, `bank`, `exchange`,
`dealer`, `land_registry` ve her sistem şirketinin kendi hesapları.

### Navlun gideri kuralı (bir kez sayılır)
- Satışa bağlı sevkiyatın (sözleşme teslimi) satıcının ödediği navlunu → teslimde `exp_freight`, satış kaydında "satıcının ödediği navlun".
- Kendi depoları arası transfer ve alım sonrası taşıma → navlun varış stoğunun maliyetine eklenir.
- Ödeme anına kadar `prepaid_freight` (kendi aracı) veya `escrow` (kiralık taşımacı) hesabında durur.

### Satış kaydı (`sales`)
Tahsil edilen tutar, SMM, satıcının ödediği navlun, ücretler (piyasa komisyonu %1), net kâr.
Satış → sözleşme/taksit → sevkiyat → defter işlemleri birbirine bağlıdır.

### Raporlar
Kâr-zarar (gelir − gider hesapları) ve nakit akışı (nakit hesabı hareketleri işlem türüne göre:
faaliyet, yatırım, finansman) ayrı gösterilir.

## 5. Piyasa, teklifler, sözleşmeler

### Anlık piyasa (şehir içi)
- Satış ilanı: ürün, kalite, miktar, birim fiyat, şehir. Miktar rezerve edilir.
- Alım emri: ürün, en düşük kalite, miktar, azami fiyat, şehir. Bedel emanete alınır.
- Alıcı bir ilandan, satıcı bir alım emrine aynı şehirdeki stoğuyla doğrudan satar. Tek işlemde
  stok, nakit, komisyon, satış kaydı. Son birimlere eşzamanlı alımda satır kilidi ile yalnızca biri kazanır.
- Başka şehirdeki alıcıya satmak = ürünü oraya taşımak (sevkiyat) ya da sözleşme.

### Doğrudan teklif ve sözleşme
Sözleşme = teklif. `counterparty` boşsa panoda herkese açıktır, doluysa doğrudan tekliftir.
Koşullar: ürün, en düşük kalite, taksit başına miktar, birim fiyat, teslim şehri, navlunu kim öder,
taksit sayısı, ilk vade, aralık (saat), tolerans süresi, gecikme cezası (%), eksik teslim cezası (%),
iptal koşulu. Kabulde koşullar değişmez bir anlık görüntüye (`terms` JSON) yazılır.

Kabulde: alıcı tüm bedeli emanete yatırır; satıcı ceza oranı × toplam değer kadar teminat yatırır.
- Teslim: satıcının teslim şehrindeki stoğundan (elle) veya sözleşmeye bağlı sevkiyat varınca (otomatik).
  Mal alıcıya geçer, emanetten satıcıya ödeme, vade geçmişse gecikme cezası düşülür.
- Vade + tolerans dolunca: eksik miktarın bedeli alıcıya iade, eksik × fiyat × ceza oranı teminattan alıcıya.
- İptal: iptal eden taraf kalan miktar için cezayı öder; diğer taraf emanet/teminatını geri alır.
- Her taksit için: teslim edilen, eksik, ödenen, ceza, açık yükümlülük gösterilir ("kim kime ne borçlu").

### Taşıma işleri (navlun panosu)
Yük sahibi iş açar: yükleme şehri, varış şehri, yük satırları (stoktan rezerve), alıcı şirket (kendisi
veya sözleşme alıcısı), sözleşme taksiti bağı, ücret (emanete alınır), son tarih. Taşımacı, yükleme
şehrinde boşta olan uygun kapasiteli aracıyla işi alır; sevkiyat başlar. Varışta teslim kanıtı yazılır
(alıcı, miktarlar, zaman, karma), ücret taşımacıya geçer, sözleşmeye bağlıysa teslim otomatik işlenir.

### Sevkiyat
Araç: model (kapasite kg, hız km/sa, yakıt ₺/km), bulunduğu şehir, durum. Sevkiyat: araç, yükleme/varış
şehri, mesafe, kalkış, varış, yük, maliyet (yakıt + sürücü ücreti), kanıt. Araç konumu = kalkış ve
varış zamanından enterpolasyon. Araç yalnızca bulunduğu şehirden kalkar; boş konum değiştirme mümkündür.

## 6. Sistem şirketleri
Her şehirde "Toptan" (hammadde alır/satar), "Tüketici Kooperatifi" (tüketim malı alır), ülke çapında
"Ulusal İnşaat" (çelik), "Enerji Santrali" (kömür), "Anadolu Lojistik" (taşıma). Her biri sistem
şirketidir, emirleri `is_system` ile işaretlidir ve arayüzde "Sistem" rozetiyle görünür.

Saatlik döngü (`packages/economy/system.ts` saf kararlar, sunucu uygular):
- Günlük bütçe ve kapasite sınırlıdır. Bütçe = taban × (1 − oyuncu payı × 0.8): oyuncular bir ürün-şehir
  pazarını doldurdukça sistem payı azalır.
- Alıcısı olmayan oyuncu ilanları (6 saattir dolmamış) → bütçe varsa referansın %85'inden alım.
- Satıcısı olmayan oyuncu alım emirleri → stok varsa referansın %120'si veya altında satış.
- Taşımacısı olmayan işler (2 saattir açık, sistem taşımacısına izinli, ücret sistem tarifesini karşılıyor) → sistem aracı.
- Bir ürün için herhangi bir şehirdeki sistem alış fiyatı, tüm şehirlerdeki en düşük sistem satış fiyatının
  en fazla %80'idir. Sistemden alıp (aynı ya da başka şehirde) sisteme satmak navlundan önce bile zarardır (birim testi).
- Sistem ayrıca tekrarlayan alım sözleşmeleri açar (itibarı yüksek şirketlere %5 prim).

Referans fiyat: ürün taban fiyatı × şehir çarpanı, oyuncu işlemlerinin hacim ağırlıklı ortalamasına
doğru yavaşça kayar ve sistem satışlarının doygunluğuyla düşer (saf fonksiyon, testli).

## 7. Şirket gelişimi
- Seviye 1–5, deneyim puanıyla (tamamlanan iş, teslimat, sözleşme taksiti, taşıma).
- Arsa, bina seviyesi, ağır tır, araştırma seviyeleri seviyeyle açılır.
- Araştırma: sektör verimi, imalat verimliliği, kalite, lojistik (yakıt −, hız +). Nakit + süre.
- Kredi: banka, seviye ve varlığa göre limit, günlük faiz, günlük eşit taksit. Erken ödeme serbest.
  Ödenemeyen taksit `arrears` olur, yeni iş başlatmayı engeller, nakit gelince otomatik kapanır.
- Bakım: her gün bina ve araç başına sabit bakım (enerji/su sabit ücreti dahil). Ödenemezse `arrears`.
- İtibar: zamanında ve tam teslim oranı. Tekliflerde görünür.

## 8. Zaman ve işlerin yerleşmesi
- Sunucu tek saat kaynağıdır (`Clock`). Üretimde gerçek zaman. Test ortamında (`ALLOW_TIME_TRAVEL=1`
  ve `NODE_ENV != production`) saat ileri alınabilir.
- Zamanlayıcı her 5 sn vadesi gelen işleri alır: `FOR UPDATE SKIP LOCKED`, durum geçişi
  (`running → completed`) aynı işlemde. Böylece her iş tam bir kez yerleşir; yeniden başlatmadan sonra
  gecikmiş işler orijinal vadeleriyle yerleşir.
- İş türleri: üretim bitişi, sevkiyat varışı, inşaat/yükseltme/araştırma bitişi, taksit vadesi,
  kredi taksiti, günlük bakım, sistem şirketi döngüsü, fiyat güncelleme, IP kaydı temizliği.

## 9. Kimlik, yönetim, adil oyun
- Kullanıcı adı + parola (scrypt). Oturum: veritabanında karması tutulan rastgele token, httpOnly
  Secure çerez. Değiştiren istekler `x-cf-intent: 1` başlığı ister (CSRF).
- Roller: `player`, `admin`. Yönetici kurulumu: sunucuda üretilen tek kullanımlık kurulum kodu + TOTP.
  Yönetici uçları TOTP etkin ve oturumda doğrulanmış olmadıkça 403 döner.
- IP: ham IP saklanmaz. `HMAC-SHA256(IP_HASH_SECRET, ip)` hesap başına ilk/son görülme ile tutulur,
  30 gün sonra silinir. Yalnızca `can_review_connections` yetkili yöneticiler görür, her erişim
  `admin_audit_log`'a yazılır. Yöneticiler IP değil "bağlantı grubu" görür.
- Aynı bağlantı grubundaki hesaplar arasında ticaret serbesttir. Tek ekranda: anlık işlemler,
  teklifler, sözleşmeler, taşıma işleri, aradaki değer transferleri.
- Fiyat sapma uyarısı: her işlem kalite, şehir, navlun koşulu ve son 72 saatteki karşılaştırılabilir
  işlemlerle karşılaştırılır. Referans, sapma %, karşılaştırma sayısı, taraflar. 5'ten az karşılaştırma
  varsa "yetersiz veri" olarak işaretlenir. |sapma| ≥ %35 uyarı.
- İnceleme dosyası: gerekçe, kapanış, yaptırım (hesap dondurma, işlemi ters kayıtla düzeltme). Yaptırımı
  yalnızca yönetici uygular. Hepsi denetim kaydına yazılır.
- Yönetici: oyuncu/şirket arama, ürün ve şehir kırılımı (stok, alıcı bulma süresi, fiyat, hacim, sistem
  payı), kıtlık, stok fazlası, ani fiyat/servet artışı, taşımacısız işler, girdi eksikliğinden duran hatlar.
  Tarif ve denge ayarlarını düzenleme (kim, ne zaman, önce/sonra, etkilenen kayıt). Kabul edilmiş
  sözleşmeler ve çalışan işler kendi anlık görüntüleriyle devam eder.

## 10. Teknik mimari
- `packages/shared`: katalog varsayılanları, zod şemaları (tüm istekler), API tipleri, i18n sözlükleri (tr/en), hata kodları.
- `packages/economy`: saf formüller. Veritabanı, ağ, saat yok.
- `apps/server`: Fastify REST (`/api/*`, Caddy öneki kırpar) + WebSocket (`/ws/events`) bildirimleri.
  Modüller: `auth`, `world`, `company`, `production`, `inventory`, `market`, `contracts`, `logistics`,
  `finance`, `research`, `system`, `admin`, `fairplay`, `scheduler`, `ledger`.
  Colyseus kaldırıldı: oyun işlemseldir, anlık konum senkronu gerekmez; REST + olay bildirimi daha basit ve
  izlenebilir. BullMQ yerine veritabanı tabanlı zamanlayıcı: tam bir kez yerleşme veritabanı işlemiyle garanti edilir.
- PostgreSQL şeması `cf` (eski oyunun `public` tablolarından bağımsız). Migration tablosu `cf_migrations` şemasında.
- Redis: hız sınırı (oyuncu ve IP başına) ve olay yayını. Kalıcı veri tutmaz.
- `apps/web`: Next.js istemci uygulaması. 3D şehir `three` ile prosedürel geometri (harici model yok,
  lisans riski yok), WebGL yoksa veya hafif mod seçiliyse 2D SVG harita. Mobil ve masaüstü eşit öncelik.
- Hatalar: her istek `reqId` taşır, hata yanıtı `{ error: { code, reqId } }`, sunucu günlüğü pino JSON.

## 11. Tek seferlik sıfırlama
`.github/workflows/reset-legacy.yml` elle tetiklenir, onay girdisi ister. Sunucuda veritabanının bu
projeye ait olduğunu doğrular (veritabanı adı, compose projesi, eski migration özetlerinin
`drizzle.__drizzle_migrations` ile eşleşmesi), sonra yalnızca eski oyunun `public` tablolarını ve
eski Redis anahtarlarını siler. `cf` şemasına dokunmaz. Normal yayın hiçbir zaman veri silmez.
