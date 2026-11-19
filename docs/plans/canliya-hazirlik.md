# Canlıya hazırlık (yol haritası 2. adım)

## Amaç
Oyunu canlı trafiğe hazırlamak için dört şey yapılacak. Tüm trafik tek bir alan adından HTTPS/WSS ile geçecek ve 2567 portu dışarıya kapanacak. Sunucu tarafında gerçek bir çıkış ve oturum iptali olacak. Yeni hesaplar belli bir süre alım satım yapamayacak, böylece çoklu hesapla fiyat şişirmek zorlaşacak. Harici bir hesap gerektirmeyen hata izleme kurulacak. Ekonomi formülü değişmediği için ekonomi-tasarimci çağrılmıyor.

## Mimari karar: Caddy ile tek origin
- Compose dosyasına `caddy` servisi eklenir. Dışarıya yalnızca 80 ve 443 açılır. `server` ve `web` servislerinin `ports:` satırları silinir, 2567 kapanır.
- Yönlendirme: `https://$PUBLIC_DOMAIN/api/*` → `server:2567` (önek kırpılır, `handle_path`). `/ws/*` → `server:2567` (önek kırpılır; Colyseus matchmake HTTP ve WS yükseltmesi). Geri kalan her şey → `web:3000`.
- Sertifika Caddy tarafından otomatik alınır (Let's Encrypt), `caddy_data` volume'unda tutulur. Her yayında `compose down` çalışsa da sertifika tekrar istenmez.
- Alan adı GitHub Variables'taki `PUBLIC_DOMAIN` değişkeninden gelir. Kodda IP veya alan adı bulunmaz.
  - (a) Kendi alan adı: `PUBLIC_DOMAIN=oyun.ornek.com` ve DNS'te sunucu IP'sine A kaydı (IPv6 varsa AAAA).
  - (b) Alan adı yoksa: `PUBLIC_DOMAIN=1-2-3-4.sslip.io`. DNS kaydı gerekmez. Paylaşılan alan adı olduğu için Let's Encrypt oran sınırı riski var; geçici yol, kalıcı çözüm (a).
- İstemcideki WS adresi build anında IP ile sabitlenmez. `NEXT_PUBLIC_GAME_SERVER_URL=/ws` (göreli) verilir; istemci adresi `location`'dan üretir (https → `wss://<host>/ws`, http → `ws://`). Değişken boşsa yerel varsayılan `ws://localhost:2567`.
- `/api` istekleri artık doğrudan Caddy'den sunucuya gider. `TRUST_PROXY` Caddy'nin sabit IP'si olur (`172.30.0.11`). Caddy gelen `X-Forwarded-For` başlığına güvenmez, gerçek istemci IP'sini yazar. Next içindeki `/api` rewrite'ı yerel geliştirme için kalır.

## Veri modeli
- **Migration yok.** Bekleme süresi mevcut `players.created_at` alanından hesaplanır. Mevcut oyuncular süreyi geçmiş sayılır.
- Yeni Redis anahtarları:
  - `psess:<playerId>`: SET, oyuncunun oturum özetleri. TTL her yeni oturumda `sessionTtlSeconds` olarak yenilenir.
  - `sess:revoked`: pub/sub kanalı, yük `{ hashes: string[] }`.
  - `rl:clienterr:*`, `rl:guestday:*`: hız sınırı sayaçları.

## Zod şemaları (`packages/shared/src/index.ts`)
- `LogoutRequestSchema = z.object({ all: z.boolean().optional() }).strict()`; boş gövde `{}` kabul edilir.
- `ClientErrorReportSchema = z.object({ kind: z.enum(["error","unhandledrejection","react"]), message: z.string().min(1).max(500), stack: z.string().max(4000).optional(), path: z.string().max(200).regex(/^\//).optional(), release: z.string().max(64).optional() }).strict()`. Yalnızca pathname alınır.
- `ORDER_ERRORS` listesine `"NEW_ACCOUNT_COOLDOWN"`.
- `Me` tipine `tradeUnlockAt: z.string().datetime()` (sunucu hesaplar).

## Akışlar

### 1. Çıkış ve oturum iptali (`POST /auth/logout`)
1. İstemci `Authorization: Bearer` ve `{ all?: boolean }` gövdesiyle istek atar.
2. IP başına sınır uygulanır, zod doğrulaması yapılır.
3. Token geçersizse yine 204 döner (idempotent, bilgi sızdırmaz).
4. `all=false`: ilgili `sess:<hash>` silinir, SREM. `all=true`: SMEMBERS ile tüm oturumlar ve `psess` silinir. MULTI ile yapılır, ardından `sess:revoked` yayını.
5. `MarketRoom` yayını alır, eşleşen istemcileri `leave(4002)` ile atar.
6. Yayın kaybolursa: her eylem öncesi `sessionValid` kontrolü ve 60 sn'de bir yeniden doğrulama zaten var; iptal edilmiş oturumla para işlemi yapılamaz.
7. `MarketRoom` ham token yerine SHA-256 özeti tutar. `session.ts` `hashToken` ve `getSessionByHash` dışa açar.

### 2. Yeni hesap işlem bekleme süresi
- Süre `config.newAccountTradeDelaySeconds` (env `NEW_ACCOUNT_TRADE_DELAY_SECONDS`, varsayılan 600, `0` kapatır, 0–86400 tam sayı doğrulanır). Saat kaynağı veritabanı `now()`.
- Kontrol `executeTrade` transaction'ının ilk adımıdır, ürün kilidinden önce, kilitsiz okuma:
  `select created_at + make_interval(secs => $d) > now() as locked from players where id = $playerId`.
  Kilit sırası (products → hesap → inventories) değişmez. `locked` ise `TradeError("NEW_ACCOUNT_COOLDOWN")`, transaction geri alınır.
- Reddedilen istek `trades` tablosuna yazılmaz; süre dolunca aynı `idempotencyKey` normal işlenir.
- Alış ve satış engellenir. Şirket, tesis, üretim ve ödenek etkilenmez.
- `/me` yanıtına `tradeUnlockAt` (yalnızca gösterim).
- Misafir kaydına IP başına günlük tavan: 20 / 24 saat (`ipBucket`, IPv6 /64). Mevcut 5/dk ve 60/dk sınırları kalır.

### 3. Hata izleme (harici hesap gerekmez)
- `apps/server/src/observability/log.ts`: tek pino örneği, `redact` ile `req.headers.authorization`, `*.token`, `*.password` gizlenir; Fastify'a `loggerInstance` olarak verilir. `reportError(err, ctx)` JSON günlüğe yazar (ileride `SENTRY_DSN` ile Sentry'e de iletebilir).
- `index.ts`: `unhandledRejection` → `reportError`; `uncaughtException` → `fatal` günlük, `shutdown()`, `exit(1)` (compose yeniden başlatır).
- `apps/server/src` altındaki `console.error` çağrıları `reportError` olur.
- `POST /client-errors` (dışarıdan `/api/client-errors`): `bodyLimit` 8 KB, zod, IP başına 10/dk ve toplam 600/dk, Redis hatasında reddeder. Kimlik yok, `warn` + `{src:"web"}`, 204.
- Web: `lib/reportError.ts` (tekrarı göndermez, sayfa başına en fazla 5), `app/ErrorReporter.tsx` (`error`, `unhandledrejection`), `app/error.tsx` ve `app/global-error.tsx` (`kind:"react"`).
- Docker günlük döndürme: `json-file`, `max-size 10m`, `max-file 5`.
- Sentry isteğe bağlı: `.env.example` içinde boş `SENTRY_DSN`; paket bu PR'a girmez.

### 4. Sağlık kontrolü ve geçiş
- `server` servisine healthcheck; `caddy` ve `web` `service_healthy` koşuluna bağlanır.
- `deploy.yml` sağlık adımı: `https://$PUBLIC_DOMAIN/api/health`, `/ws/health`, `/` (60 × 5 sn) ve `http://` → https yönlendirmesi. Başarısızsa `docker compose logs caddy server`.
- Geri dönüş: önceki başarılı commit için `workflow_dispatch`.

## Dosya bazında değişiklikler
- `deploy/Caddyfile` (yeni): site bloğu, `encode zstd gzip`, iki `handle_path`, varsayılan `web:3000`, başlıklar: HSTS `max-age=86400` (bir hafta sonra 1 yıl), `nosniff`, `Referrer-Policy strict-origin-when-cross-origin`, `X-Frame-Options DENY`, `Permissions-Policy`, `-Server`, `Content-Security-Policy-Report-Only`.
- `deploy/docker-compose.prod.yml`: `caddy` (sürüm sabit, 80/443/443udp, IP `172.30.0.11`, volume'lar), `server`/`web` portları kaldırılır, `TRUST_PROXY` `172.30.0.11`, `NEW_ACCOUNT_TRADE_DELAY_SECONDS`, healthcheck, günlük döndürme.
- `.github/workflows/deploy.yml`: build-arg `/ws`, `PUBLIC_DOMAIN` zorunlu, `.env`'e yazılır, Caddyfile kopyalanır, yeni sağlık adımı.
- `deploy/README.md`, `apps/web/Dockerfile` açıklaması, `.env.example`.
- Sunucu: `config.ts`, `auth/session.ts`, `http/routes.ts`, `security/rateLimit.ts`, `market/trade.ts`, `rooms/MarketRoom.ts`, `index.ts`, `observability/log.ts` (yeni), `package.json` (`pino`).
- Ortak: `packages/shared/src/index.ts`.
- Web: `lib/gameServerUrl.ts` (yeni), `GameProvider.tsx`, `Game.tsx` (çıkış çağrısı + onay, geri sayım, hata metni), `lib/reportError.ts`, `ErrorReporter.tsx`, `error.tsx`, `global-error.tsx`, `layout.tsx`.

## Görevler
- backend-dev: (1) Caddy, compose, deploy.yml, README; (2) oturum iptali ve logout; (3) bekleme süresi ve günlük misafir tavanı; (4) gözlemlenebilirlik ve `/client-errors`.
- frontend-dev: adres çözümü, çıkış ve onay, geri sayım, hata bildirimi.
- test-qa: aşağıdaki testler.
- guvenlik-reviewer: TRUST_PROXY/XFF, 2567'nin kapanması, logout yarışları, bekleme süresinin atlatılması, `/client-errors` kötüye kullanımı, Caddy başlıkları, günlüklerde token olmaması.

## Testler (Vitest)
- session: logout sonrası `getSession` null; `all=true` tüm oturumları siler, başkasınınkini değil; geçersiz token 204; `psess` TTL yenilenir.
- MarketRoom: iptal yayınında eşleşen istemci 4002 ile atılır; yayın kaçsa da sonraki emir `UNAUTHORIZED`.
- trade: yeni oyuncu alış/satışta `NEW_ACCOUNT_COOLDOWN` alır, defter/trades/fiyat değişmez; süre geçince aynı anahtar başarılı; `delay=0` kapalı; eşzamanlılık testleri yeşil.
- config: geçersiz süre başlangıçta hata verir.
- routes: `/me.tradeUnlockAt`; `/client-errors` 204/400/429; Redis hatasında reddeder.
- rateLimit: aynı /64'ten 21. misafir kaydı reddedilir.
- log: authorization ve token `[Redacted]`.
- web: `gameServerUrl` çözümü.
- Elle (yayın sonrası): `http://IP:2567/health` zaman aşımı; oyun `wss://` ile bağlanır; "tüm cihazlardan çık" diğer sekmeyi atar.

## Riskler
- Sertifika alınamazsa yayın düşer: DNS ve 80/443 hazır olmadan merge edilmez.
- Colyseus istemcisinin `/ws` önekiyle çalışması uçtan uca doğrulanmalı; olmazsa `ws.` alt alan adı.
- `TRUST_PROXY` yanlışsa herkes tek IP kovasına düşer veya XFF sahteciliği olur.
- Bekleme süresi saldırıyı yalnızca geciktirir; kalıcı çözüm kapsam dışı.
- Misafir hesabından çıkış hesabın kaybıdır; onay penceresi şart.
- Token localStorage'da; CSP önce Report-Only.
- `compose down/up` birkaç saniyelik kesinti yaratır (değişmiyor).

## Kullanıcının elle yapması gerekenler
1. (a) yolunda DNS'e A kaydı; (b) yolunda bir şey gerekmez.
2. GitHub → Settings → Environments → production → Variables: `PUBLIC_DOMAIN` (isteğe bağlı `NEW_ACCOUNT_TRADE_DELAY_SECONDS`). `PUBLIC_GAME_SERVER_URL` başarılı yayından sonra silinir.
3. Merge'den önce UpCloud güvenlik duvarında ve ufw'de 80/tcp, 443/tcp (isteğe bağlı 443/udp) açılır.
4. Yayın yeşil olunca 2567/tcp kapatılır.

## Sonraki PR'lar
Postgres günlük yedeği ve Redis parolası (öncelik yüksek), WS Origin kontrolü, kesintisiz yayın, Sentry, zorunlu CSP, httpOnly çerezli oturum, hesap kurtarma.
