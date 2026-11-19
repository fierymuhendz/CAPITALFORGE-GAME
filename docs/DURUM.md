# Proje durumu

Tamamlanan aşamalar ve sıradaki adım. Her aşama bitince en üste eklenir.

## Aşamalar

### 2026-11-18: Şirket ve üretim ✅
- PR #3: misafir girişi, defterli alım satım, canlı fiyat grafiği (ilk oynanabilir sürüm).
- PR #4: şirket, tesis, süreli üretim, ortak piyasa havuzu, bakım ve ödenek.
- PR #5–#7: yayında migration hatalarının görünür olması ve yığının temiz ağla yeniden kurulması.

### 2026-11-18: İlk yayın ✅
- PR #1 (iskelet, ajan ekibi, CI, otomatik yayın) `main` dalına birleşti.
- UpCloud sunucusuna ilk yayın başarılı: `/health` → `{"ok":true}`, ana sayfada "Bağlantı: bağlı", "Fiyat: ₺100,00".
- Öğrenilen: `/opt/capitalforge` klasörü ilk yayından önce root tarafından `deploy` kullanıcısı için hazırlanmalı (bkz. `deploy/README.md`).
- O an eksik olanlar (sonraki PR'larda kapandı): kimlik doğrulama, emirlerin deftere bağlanması.

## Sıradaki adım

Proje sohbetinde belirlenir ve tamamlanınca buraya aşama olarak eklenir. Açık altyapı işi: alan adı ve HTTPS (`wss://`).
