# Proje rehberi

Kısa başvuru: temel kararlar, hangi işe hangi ajan, bir değişikliğin nasıl doğrulandığı ve yayın.

## Temel kararlar

- **Tek kalıcı dünya, oyuncu başına bir şirket.** Dünya verisi `cf` şemasında. Yeniden yayın, yeniden başlatma ve migration oyuncu verisini korur; katalog tohumlama yalnızca eksik satırları ekler, yönetici düzenlemeleri ezilmez.
- **Gerçek zaman.** Üretim, sevkiyat, sözleşme taksitleri ve günlük bakım veritabanındaki zamanlanmış satırlarla yürür. Oyuncu çevrimdışıyken ve sunucu yeniden başladıktan sonra da her iş tam bir kez yerleşir.
- **Para.** Kuruş cinsinden bigint, çift taraflı defter, şirket başına dengeli işlemler, eksi nakit yok. Satış satırı tahsilat, satılan malın maliyeti, satıcının ödediği navlun, komisyon ve net kârı ayrı taşır.
- **Sistem şirketleri** karşılanmayan arz, talep ve navlunu sınırlı bütçe ve kapasiteyle tamamlar; oyuncu payı arttıkça küçülür. Sistemin alış fiyatı, tüm şehirlerdeki güncel sistem satış fiyatlarının en düşüğünün %80'ini geçemez (risksiz arbitraj yok).
- **3D şehir** three.js ile prosedürel üretilir, üçüncü taraf model veya doku yok. Lisans bildirimleri `apps/web/public/LICENSES.txt`.
- **Gizlilik.** Ham IP saklanmaz, HMAC karması 30 gün tutulur; yalnızca 2FA'lı yöneticiler görür ve her erişim denetim kaydına yazılır.

## Hangi işe hangi ajan

| İş | Ajan |
|---|---|
| Yeni sistem, veri modeli veya birden çok katmana dokunan değişiklik planı | mimar |
| Ürün, tarif, şehir, fiyat, sistem talebi değerleri; `pnpm sim` | oyun-tasarimci |
| Uç noktalar, şema, migration, defter, zamanlayıcı | backend-dev |
| 3D sahne, kamera, mobil performans, 2D harita | sehir-3d |
| Ekranlar, paneller, TR/EN metinler, boş durumlar | arayuz-dev |
| Kabul senaryoları, eşzamanlılık, uçtan uca testler | test-qa |
| Para çoğaltma, hile, yetki, IP gizliliği denetimi (birleştirmeden önce) | guvenlik-reviewer |
| İş akışları, Docker, sunucu, yedek, canlı doğrulama | yayin |

Tek dosyalık düzeltmeleri ana oturum doğrudan yapar.

## Doğrulama

1. `pnpm typecheck && pnpm test && pnpm test:int` (entegrasyon testleri her senaryodan sonra defter değişmezlerini denetler).
2. Ekonomiye dokunan her değişiklikte `pnpm sim` ve `docs/economy/denge.md` farkı.
3. Arayüz değişikliğinde telefon (390×844) ve masaüstü (1440×900) ekran görüntüleri, TR ve EN.
4. Kabul senaryoları ve sonuçları: `docs/test-sonuclari.md`.
5. Yayından sonra **Verify live** iş akışı canlı adreste kayıt, şirket, ilk iş, harita ve arayüzü dener; ekran görüntüleri iş akışı çıktısında.

## Yayın

- `main` dalına birleştirme **Deploy** iş akışını tetikler: imajlar GHCR'a, sunucuda yedek, migration, yeniden başlatma, sağlık kontrolü.
- **Reset legacy game** tek seferliktir ve yalnızca elle, onay metniyle çalışır; hedefin bu projenin eski veritabanı olduğunu doğrulamadan hiçbir şey silmez. v2 verisine dokunmaz.
- Yönetici erişimi: sunucuda `cat /opt/capitalforge/secrets/admin_setup_code` ile okunan tek seferlik kod, oyunda Hesap → Yönetici ol ekranına girilir, ardından 2FA zorunludur.
- Ücretli yeni araç, hizmet veya sunucu yükseltmesi için önce proje sahibinin onayı alınır.
