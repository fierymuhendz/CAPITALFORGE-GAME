# Yayın (UpCloud)

`main` dalına her birleştirmede `.github/workflows/deploy.yml` çalışır:

1. `PUBLIC_DOMAIN` tanımlı değilse hemen hata verir.
2. Sunucu ve web Docker imajlarını derler, GitHub Container Registry'ye (ghcr.io) gönderir. Web imajı `NEXT_PUBLIC_GAME_SERVER_URL=/ws` ile derlenir (göreli; adres tarayıcıdan üretilir, imaja IP/alan adı gömülmez).
3. SSH ile sunucuya bağlanır, `/opt/capitalforge/` altına `docker-compose.yml`, `backup.sh`, `restore.sh` ve `.env` dosyalarını önce `.new` adıyla yükler, doğrulamalar (Redis parolası biçimi, `backups` klasörü sahipliği) geçince hepsini birlikte yerine taşır. Root olarak bağlanılırsa `BACKUP_UID/GID=1000` kullanılır ve `backups` klasörü buna chown edilir; klasör root sahipliyse açık hatayla durur.
4. İmajları çeker, **yayın öncesi yedek alır** (`docker compose run --rm --no-deps -e BACKUP_RUN_ONCE=1 backup`; postgres çalışmıyorsa, yani ilk kurulumda, atlanır; yedek başarısızsa yayın durur). İlk yedek bu yüzden yayından hemen önce alınır. Sonra `docker compose down` ve `docker compose up -d` ile PostgreSQL, Redis, migration, oyun sunucusu, web ve Caddy'yi başlatır.
5. `https://$PUBLIC_DOMAIN/api/health`, `/ws/health`, `/` adreslerini (60 x 5 sn) ve `http://` -> `https://` yönlendirmesini kontrol eder. Başarısızsa `caddy` ve `server` günlüklerini basar.

Tüm trafik tek adresten geçer. Dışarıya yalnızca **80 ve 443** açıktır:

| Yol | Hedef |
|---|---|
| `https://ALAN_ADI/api/*` | `server:2567` (önek kırpılır) |
| `https://ALAN_ADI/ws/*` | `server:2567` (önek kırpılır; Colyseus HTTP + WebSocket) |
| diğer her şey | `web:3000` |

Sertifikayı Caddy otomatik alır (Let's Encrypt) ve `caddy_data` volume'unda saklar; `compose down` volume'ları silmediği için her yayında yeniden istenmez.

Actions sekmesinden **Deploy -> Run workflow** ile elle de çalıştırılabilir. Geri dönüş için önceki başarılı commit üzerinden bu iş çalıştırılır.

## Alan adı (`PUBLIC_DOMAIN`)

Değer yalnızca alan adıdır (`https://`, yol veya port yazılmaz). İki yol vardır:

- **(a) Kendi alan adınız (kalıcı çözüm):** `PUBLIC_DOMAIN=oyun.ornek.com`. DNS'te sunucu IP'sine bir A kaydı (IPv6 varsa AAAA) ekleyin; kayıt yayılmadan yayın yapmayın.
- **(b) Alan adı yoksa sslip.io (geçici):** sunucu IP'sindeki **noktaları tire** yapıp sonuna `.sslip.io` ekleyin. Ör. IP `1.2.3.4` ise `PUBLIC_DOMAIN=1-2-3-4.sslip.io`. DNS kaydı gerekmez. sslip.io paylaşılan bir alan adı olduğundan Let's Encrypt oran sınırına takılma riski vardır; kalıcı kullanım için (a)'ya geçin.

Alan adı kodda veya imajda yoktur; değiştirmek için değişkeni güncelleyip yeniden yayınlamak yeterlidir.

## GitHub ayarları

Depo -> Settings -> Environments -> `production` ortamı oluşturun, aşağıdakileri oraya ekleyin.

**Secrets**

| Ad | Değer |
|---|---|
| `DEPLOY_HOST` | Sunucunun IP adresi |
| `DEPLOY_USER` | SSH kullanıcısı (ör. `deploy`) |
| `DEPLOY_SSH_KEY` | Sadece yayın için üretilmiş özel anahtar (tamamı, BEGIN/END satırlarıyla) |
| `DEPLOY_KNOWN_HOSTS` | `ssh-keyscan SUNUCU_IP` çıktısı |
| `POSTGRES_PASSWORD` | Uzun, rastgele parola (`openssl rand -hex 32`) |
| `JWT_SECRET` | Uzun, rastgele değer (`openssl rand -hex 32`) |
| `BACKUP_PASSPHRASE` | Sunucu dışı yedekleri şifreleyen parola: **en az 32 karakter, rastgele** (ör. `openssl rand -base64 48`), ayrıca parola yöneticisinde saklayın. Kısaysa `Backup` iş akışı hata verir (aşağıda "Yedekler") |

Ortam koruması: `production` ortamında **Deployment branches: `main`** (yalnızca `main` dalı) kısıtını açın. Böylece başka bir dal bu ortamın sırlarına (SSH anahtarı, `BACKUP_PASSPHRASE`) erişen bir iş akışı çalıştıramaz.

**Variables**

| Ad | Değer |
|---|---|
| `PUBLIC_DOMAIN` | **Zorunlu.** `oyun.ornek.com` veya `1-2-3-4.sslip.io` |
| `NEW_ACCOUNT_TRADE_DELAY_SECONDS` | İsteğe bağlı. Yeni hesapların alım-satım bekleme süresi (saniye, varsayılan 600, `0` kapatır) |

`PUBLIC_GAME_SERVER_URL` **artık kullanılmaz**; web imajı göreli `/ws` ile derlenir. Eski değişken varsa ilk başarılı yayından sonra silin.

## Sunucuda bir kez yapılacaklar

> **İlk yayından önce zorunlu:** `/opt/capitalforge` klasörü root tarafından oluşturulmalı ve `deploy` kullanıcısına ait olmalıdır.
> `deploy` kullanıcısının `/opt` altında klasör açma izni yoktur. Bu adım atlanırsa yayın
> `mkdir: cannot create directory '/opt/capitalforge': Permission denied` hatasıyla durur.

```bash
# root olarak
adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy
mkdir -p /home/deploy/.ssh && chmod 700 /home/deploy/.ssh
# Kendi bilgisayarınızda: ssh-keygen -t ed25519 -f capitalforge_deploy -N ""
# capitalforge_deploy.pub içeriğini aşağıdaki dosyaya ekleyin:
nano /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys && chown -R deploy:deploy /home/deploy/.ssh

# Yayın klasörü (ZORUNLU, root olarak)
mkdir -p /opt/capitalforge && chown deploy:deploy /opt/capitalforge
ls -ld /opt/capitalforge   # sahibi "deploy deploy" görünmeli

# Güvenlik duvarı: SSH, HTTP (sertifika doğrulaması + yönlendirme) ve HTTPS
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp && ufw enable
# Eskiden 2567 açıldıysa, ilk başarılı HTTPS yayınından SONRA kapatın:
ufw delete allow 2567/tcp
```

UpCloud panelindeki güvenlik duvarında da TCP 22, 80, 443 (isteğe bağlı UDP 443) açık olmalıdır. **80 kapalı kalırsa Caddy sertifika alamaz ve yayın düşer.** 2567, yayın yeşil olduktan sonra hem ufw'de hem UpCloud panelinde kapatılır.

## İlk yayın kontrol listesi

1. `ls -ld /opt/capitalforge` çıktısında sahip `deploy` olmalı.
2. `production` ortamında 6 secret (+ yedek için en az 32 karakterlik `BACKUP_PASSPHRASE`) ve `PUBLIC_DOMAIN` değişkeni tanımlı, Deployment branches `main` ile kısıtlı olmalı.
3. (a) yolunda DNS A kaydı sunucu IP'sine işaret etmeli.
4. Güvenlik duvarında (ufw + UpCloud) 22, 80, 443 açık olmalı.
5. Yayından sonra `https://ALAN_ADI/api/health` adresi `{"ok":true}` döndürmeli.
6. `https://ALAN_ADI` adresinde oyun açılmalı ve bağlantı göstergesi "● Bağlı" olmalı (WebSocket `wss://ALAN_ADI/ws` üzerinden).
7. Yayın yeşil olunca 2567/tcp kapatılır; `http://SUNUCU_IP:2567/health` zaman aşımına uğramalıdır.
8. HSTS başlangıçta `max-age=86400`; bir hafta sorunsuz çalışınca `deploy/Caddyfile` içinde 1 yıla (`31536000`) çıkarın.

## Redis parolası

Redis parolası sunucuda ilk yayında otomatik üretilir: `/opt/capitalforge/secrets/redis_password` (izin 600). Yayın betiği dosya yoksa oluşturur, varsa dokunmaz; değeri sunucuda `.env`'e ekler, GitHub'a veya CI günlüğüne çıkmaz. Redis parolayı komut satırında değil geçici yapılandırma dosyasında alır (`ps`'te görünmez). Üretimde `REDIS_URL` parolasız ise sunucu başlamaz. Redis verisi (oturumlar) aynı volume'da kalır, parola eklemek oturumları silmez.

## Yedekler

**Sunucuda:** `backup` servisi her gün 03:00'te (Türkiye saati) `pg_dump` alır ve `/opt/capitalforge/backups/capitalforge-YYYYMMDD-SSDD-G.dump` (`G` haftanın günü, 1=Pazartesi ... 7=Pazar; saklama pazar yedeklerini bundan tanır, eski etiketsiz adlar da okunur) olarak yazar. Her yedek `pg_restore --list` ile doğrulanır, bozuksa silinir. Saklama: son 7 gün + son 4 pazar günü yedeği. Klasör `compose down` ile silinmez. Günlük: `docker compose logs backup`. Elle yedek almak için: `docker compose run --rm --no-deps -e BACKUP_RUN_ONCE=1 backup`. Yayın öncesi alınan yedek de aynı klasöre yazılır.

**Sunucu dışı kopya:** `.github/workflows/backup.yml` her gün 04:00'te (Türkiye saati) en yeni yedeği SSH ile çeker, `BACKUP_PASSPHRASE` ile şifreler (`gpg`, AES256, SHA512 ile yinelemeli anahtar türetme), 30 gün saklanan Actions artifact'i olarak yükler. Aynı iş geçici bir PostgreSQL 17'ye geri yükleme denemesi yapıp `cf.accounts`, `cf.companies` ve `cf.ledger_entries` satır sayılarını günlüğe yazar ve defter değişmezini denetler (`cf.ledger_entries` tutarları toplamı 0, her işlem dengeli; tablo yoksa veya sorgu hata verirse iş kırmızı biter). Şifreli dosya doğrulamadan önce artifact olarak yüklenir, doğrulama başarısız olsa da yedek elde kalır. Elle çalıştırmak için Actions -> **Backup** -> Run workflow.

**`BACKUP_PASSPHRASE` ekleme:** En az 32 karakterlik rastgele bir parola üretin (ör. `openssl rand -base64 48`), Settings -> Environments -> `production` -> Secrets altına `BACKUP_PASSPHRASE` olarak ekleyin ve **ayrıca** parola yöneticisinde saklayın. Kaybolursa sunucu dışı yedekler açılamaz. Tanımlı değilse veya 32 karakterden kısaysa iş (değeri yazdırmadan) açık bir hatayla durur.

**Artifact'ten geri yükleme:**

1. Actions -> **Backup** -> ilgili çalışma -> Artifacts bölümünden `capitalforge-yedek-...` dosyasını indirin, zip'ten çıkarın.
2. Şifreyi çözün (parolayı sorar):
   ```bash
   gpg -d -o capitalforge.dump capitalforge-YYYYMMDD-SSDD-G.dump.gpg
   ```
3. Dosyayı sunucuya kopyalayın: `scp capitalforge.dump deploy@SUNUCU:/opt/capitalforge/backups/`
4. Sunucuda önce **ayrı bir veritabanına** yükleyip kontrol edin (canlıya dokunmaz):
   ```bash
   cd /opt/capitalforge
   docker compose run --rm --no-deps backup sh /restore.sh /backups/capitalforge.dump
   # yeni veritabanı: capitalforge_restore_YYYYMMDD, satır sayıları yazdırılır
   ```
5. Canlı veritabanının üzerine yazmak gerekiyorsa önce oyunu durdurun. `restore.sh` şunları zorunlu kılar:
   - hedefte (kendisi dışında) bağlantı olmamalı; varsa reddeder ve `docker compose stop server` der,
   - `RESTORE_CONFIRM` değeri **hedef veritabanı adına** eşit olmalı (`capitalforge`),
   - üzerine yazmadan önce `/backups/pre-restore-<zaman>.dump` güvenlik yedeği alır,
   - geri yükleme tek transaction'dadır; hata olursa canlı veri değişmez.
   ```bash
   docker compose stop server web
   docker compose run --rm --no-deps -e RESTORE_CONFIRM=capitalforge backup sh /restore.sh /backups/capitalforge.dump capitalforge
   docker compose start server web
   ```
   Sonunda tablolar, satır sayıları ve defter toplamı (0) denetlenir; eksik tablo hata sayılır. `pre-restore-*.dump` dosyaları saklama politikasıyla silinmez, işiniz bitince elle temizleyin.
Sunucudaki yedekten geri yüklemek için 1-3. adımları atlayıp 4'te `/backups/` altındaki dosya adını verin.

## Sorun giderme

| Belirti | Neden | Çözüm |
|---|---|---|
| `mkdir: cannot create directory '/opt/capitalforge': Permission denied` | Klasör hazırlanmamış | Yukarıdaki zorunlu adımı root ile çalıştırıp Actions'ta **Re-run jobs** |
| `PUBLIC_DOMAIN değişkeni ... tanımlı değil` | Variable eksik | production ortamına ekleyin |
| Sağlık kontrolü zaman aşımı, Caddy günlüğünde sertifika hatası | 80/443 kapalı, DNS yanlış veya Let's Encrypt oran sınırı (sslip.io) | Güvenlik duvarını/DNS'i düzeltin; sslip.io'da sınır doluysa kendi alan adınıza geçin |
| Sayfada "Bağlantı koptu" uyarısı | `/ws` yönlendirmesi veya wss çalışmıyor | `https://ALAN_ADI/ws/health` yanıtını ve `docker compose logs caddy server` çıktısını kontrol edin |
| Yeni hesap emirlerde "bekleme" hatası | Beklenen davranış: yeni hesaplar süre dolana kadar alım-satım yapamaz | `NEW_ACCOUNT_TRADE_DELAY_SECONDS` ile ayarlanır |

Not: Docker, yayınladığı portlar için ufw kurallarını atlar. Bu yüzden `server` ve `web` hiç port yayınlamaz; PostgreSQL ve Redis de açmaz. Yalnızca `caddy` 80/443 yayınlar.

## Hata günlükleri

Sunucu JSON günlük yazar (yetki başlığı, token ve parola alanları `[Redacted]`). İstemci hataları `POST /api/client-errors` ile gelir ve `src: "web"` alanıyla `warn` düzeyinde günlüğe yazılır:

```bash
cd /opt/capitalforge && docker compose logs --since 1h server | grep '"src":"web"'
```

Docker günlükleri `json-file`, servis başına 10 MB x 5 dosya ile döndürülür.
