# Proje durumu

Tamamlanan aşamalar ve sıradaki adım. Her aşama bitince en üste eklenir.

## Aşamalar

### 2026-11-18: İlk yayın ✅
- PR #1 (iskelet, ajan ekibi, CI, otomatik yayın) `main` dalına birleşti.
- UpCloud sunucusuna ilk yayın başarılı: `/health` → `{"ok":true}`, ana sayfada "Bağlantı: bağlı", "Fiyat: ₺100,00".
- Öğrenilen: `/opt/capitalforge` klasörü ilk yayından önce root tarafından `deploy` kullanıcısı için hazırlanmalı (bkz. `deploy/README.md`).
- Henüz yok: HTTPS/alan adı, kimlik doğrulama, emirlerin deftere bağlanması, PostgreSQL üzerinde transfer testleri.

## Sıradaki adım

**Temel ekonomi döngüsü (ilk oynanabilir sürüm):** misafir girişi → başlangıç parası → piyasadan alım/satım → bakiye ve envanter.
Akış: mimar → ekonomi-tasarimci → backend-dev → frontend-dev → test-qa → guvenlik-reviewer.
