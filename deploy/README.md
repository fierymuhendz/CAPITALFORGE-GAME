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

```bash
# root olarak
adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy
mkdir -p /home/deploy/.ssh && chmod 700 /home/deploy/.ssh
# Kendi bilgisayarınızda: ssh-keygen -t ed25519 -f capitalforge_deploy -N ""
# capitalforge_deploy.pub içeriğini aşağıdaki dosyaya ekleyin:
nano /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys && chown -R deploy:deploy /home/deploy/.ssh
mkdir -p /opt/capitalforge && chown deploy:deploy /opt/capitalforge

# Güvenlik duvarı: sadece SSH, web ve oyun sunucusu
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 2567/tcp && ufw enable
```

Not: Docker, yayınladığı portlar için ufw kurallarını atlar. PostgreSQL ve Redis bu yüzden hiç port açmaz.

## Sonraki adım

Alan adı alındığında önüne Caddy koyup otomatik HTTPS ve `wss://` eklenecek, 2567 portu dışarıya kapatılacak.
