# Veritabanı yedeği ve Redis parolası

Canlıya hazırlığın devamı (bkz. `canliya-hazirlik.md`, "Sonraki PR'lar"). Ekonomi ve arayüz değişmez; sadece dağıtım ve sunucu yapılandırması.

## 1. Redis parolası
- Parola sunucuda bir kez üretilir ve saklanır: yayın betiği `/opt/capitalforge/secrets/redis_password` yoksa `openssl rand -hex 32` ile oluşturur (izin 600). Kullanıcının GitHub'a sır eklemesi gerekmez; sır CI günlüğüne hiç düşmez.
- `redis` servisi: `redis-server --appendonly yes --requirepass "$REDIS_PASSWORD"` (değer ortam değişkeninden, komut satırında görünmesin diye `--requirepass` yerine yapılandırma dosyası veya `REDIS_ARGS` yaklaşımı tercih edilir). Healthcheck `redis-cli -a ... ping` (veya `REDISCLI_AUTH`).
- `server`: `REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379`, `redis: service_healthy`.
- Kod: `config.ts` üretimde REDIS_URL'de parola yoksa başlangıçta hata verir. Günlüklerde REDIS_URL görünmez.

## 2. Günlük veritabanı yedeği (sunucuda)
- Yeni `backup` servisi (`postgres:17-alpine`, sunucudaki sürümle aynı): döngü içinde her gün 03:00 (Europe/Istanbul) `pg_dump -Fc` alır, `/opt/capitalforge/backups/` (bind mount) altına `capitalforge-YYYYMMDD-HHMM.dump` yazar, önce geçici adla yazıp tamamlanınca yeniden adlandırır.
- Saklama: son 7 günlük + son 4 pazar yedeği; eskiler silinir.
- Her yedekten sonra `pg_restore --list` ile dosyanın okunabildiği doğrulanır; başarısızsa dosya silinir ve hata günlüğe yazılır.
- `deploy/backup.sh` (betik, compose'da bağlanır) ve `deploy/restore.sh` (elle geri yükleme: yığını durdurmadan ayrı veritabanına veya onaylı tam geri yükleme).
- Yayın her seferinde `compose down` çalıştırır; yedek klasörü bind mount olduğu için korunur.

## 3. Sunucu dışı kopya
- Seçenek A (önerilen, yeni hesap gerektirmez): `.github/workflows/backup.yml`, her gün 04:00 TR'de (01:00 UTC) SSH ile en yeni yedeği çeker, `BACKUP_PASSPHRASE` sırrıyla `gpg --symmetric --cipher-algo AES256` şifreler, 30 gün saklanan Actions artifact'i olarak yükler. Aynı iş şifreli dosyayı açıp geçici bir PostgreSQL'e `pg_restore` ederek geri yükleme denemesi yapar ve tablo sayılarını yazdırır. Kullanıcıya iş: `BACKUP_PASSPHRASE` sırrını eklemek (parolayı ayrıca güvenli bir yerde saklamak).
- Seçenek B: UpCloud Object Storage (S3 uyumlu) — ayrı hesap/anahtar gerekir, sonra eklenebilir.

## Testler
- `config` birim testi: üretimde parolasız REDIS_URL reddedilir.
- `backup.sh` ve `restore.sh`: yerelde Docker yoksa geçici PostgreSQL'e karşı betik testi (dump → restore → satır sayısı eşit). `bash -n` ve shellcheck (varsa).
- Workflow YAML ayrıştırma ve `bash -n`.

## Riskler
- Redis parolası değişince var olan oturumlar etkilenmez (veri aynı volume'da), ama server ile redis aynı yayında güncellenmeli.
- Yedek diski doldurabilir: saklama politikası ve boyut günlüğü.
- `BACKUP_PASSPHRASE` kaybolursa sunucu dışı yedekler açılamaz.
