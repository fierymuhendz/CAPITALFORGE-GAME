# Yayın (UpCloud)

`main` dalına her birleştirmede `.github/workflows/deploy.yml` çalışır:

1. Sunucu ve web Docker imajlarını derler, GitHub Container Registry'ye (ghcr.io) gönderir.
2. SSH ile sunucuya bağlanır, `/opt/capitalforge/` altına `docker-compose.yml` ve `.env` yazar.
3. `docker compose up -d` ile PostgreSQL, Redis, migration, oyun sunucusu ve web arayüzünü başlatır.
4. `http://SUNUCU:2567/health` adresini kontrol eder.

Actions sekmesinden **Deploy → Run workflow** ile elle de çalıştırılabilir.

## GitHub ayarları

Depo → Settings → Environments → `production` ortamı oluşturun, aşağıdakileri oraya ekleyin.

**Secrets**

| Ad | Değer |
|---|---|
| `DEPLOY_HOST` | Sunucunun IP adresi |
| `DEPLOY_USER` | SSH kullanıcısı (ör. `deploy`) |
| `DEPLOY_SSH_KEY` | Sadece yayın için üretilmiş özel anahtar (tamamı, BEGIN/END satırlarıyla) |
| `DEPLOY_KNOWN_HOSTS` | `ssh-keyscan SUNUCU_IP` çıktısı |
| `POSTGRES_PASSWORD` | Uzun, rastgele parola (`openssl rand -hex 32`) |
| `JWT_SECRET` | Uzun, rastgele değer (`openssl rand -hex 32`) |

**Variables**

| Ad | Değer |
|---|---|
| `PUBLIC_GAME_SERVER_URL` | `ws://SUNUCU_IP:2567` (alan adı ve TLS gelince `wss://...`) |

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

# Güvenlik duvarı: sadece SSH, web ve oyun sunucusu
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 2567/tcp && ufw enable
```

UpCloud panelindeki güvenlik duvarı kullanılıyorsa orada da TCP 22, 80 ve 2567 için gelen trafiğe izin verilmelidir.

## İlk yayın kontrol listesi

1. `ls -ld /opt/capitalforge` çıktısında sahip `deploy` olmalı.
2. `production` ortamında 6 secret ve `PUBLIC_GAME_SERVER_URL` değişkeni tanımlı olmalı.
3. Güvenlik duvarında 22, 80 ve 2567 açık olmalı.
4. Yayından sonra `http://SUNUCU_IP:2567/health` adresi `{"ok":true}` döndürmeli.
5. `http://SUNUCU_IP` adresinde oyun açılmalı ve bağlantı göstergesi "● Bağlı" olmalı.

## Sorun giderme

| Belirti | Neden | Çözüm |
|---|---|---|
| `mkdir: cannot create directory '/opt/capitalforge': Permission denied` | Klasör hazırlanmamış | Yukarıdaki zorunlu adımı root ile çalıştırıp Actions'ta **Re-run jobs** |
| Sağlık kontrolü zaman aşımı | 2567 portu kapalı | UpCloud ve ufw'de 2567'yi açın |
| Sayfada "Bağlantı koptu" uyarısı | 2567 kapalı veya `PUBLIC_GAME_SERVER_URL` hatalı | Değer tam olarak `ws://SUNUCU_IP:2567` olmalı, değiştirince yeniden yayın gerekir |

Not: Docker, yayınladığı portlar için ufw kurallarını atlar. PostgreSQL ve Redis bu yüzden hiç port açmaz.

## Sonraki adım

Alan adı alındığında önüne Caddy koyup otomatik HTTPS ve `wss://` eklenecek, 2567 portu dışarıya kapatılacak.
