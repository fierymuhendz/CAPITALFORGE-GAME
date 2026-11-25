# Oyuncu Yönetimi ve oyun testi kipi (60 sn)

## Oyuncu Yönetimi (Yönetim → Oyuncu Yönetimi)
- `GET /admin/players?q=` kullanıcı adı / şirket adı araması; hesap, şirket, nakit (sistem şirketleri hariç).
- `GET /admin/players/:accountId` ayrıntı + bakiye ayarı geçmişi + askıya alma geçmişi (denetim kaydından).
- `POST /admin/players/:accountId/status` `{ suspended, reason }`: mevcut `freezeAccount` (yönetici askıya alınamaz).
- `POST /admin/players/:accountId/balance` `{ mode: add|deduct|set, amount (kuruş), reason, idempotencyKey }`:
  nakit hesabı satır kilidiyle okunur, fark tek defter işlemi (`admin_balance_adjust`, nakit ↔ özkaynak) olarak yazılır,
  defter anahtarı `admin-balance:<yönetici>:<istek anahtarı>`; istek düzeyinde idempotency aynı yanıtı döndürür.
  Bakiye eksiye düşemez. Denetim kaydı: `player.balance_adjust` (yönetici, gerekçe, zaman, önce/sonra nakit, defter işlemi).
  Oyuncuya `admin_balance_adjusted` bildirimi.
- Yalnızca 2FA'lı yönetici (`auth: "admin"`), mutasyonlar `x-cf-intent` ister.

## Oyun testi kipi
- Ayar: `settings.pace.playtestSeconds` (varsayılan 60; 0 = kapalı). Kural: bekleme = min(özgün, tavan).
- Yeni işler: `catalog/pace.ts` (`paceDuration`, `paceTrip`, `pickupMinutes`) tavanı uygular, kesirli dakika döndürebilir.
  Kapsam: üretim (tekrarlı dahil), inşaat, yükseltme/kalite, araştırma, sevkiyatlar (kendi, navlun işi, sözleşme teslimatı,
  boş dönüş), sistem taşımacısının devralma beklemesi, sözleşme teslim penceresinin açılması, yeniden kurma soğuması,
  sahipsiz ilan/emirlerin sisteme devri.
- Çalışan işler: `catalog/playtest.ts` görevi her turda `ends_at > now + tavan` olan kayıtları `now + tavan`a çeker
  (üretim, tesis inşaat/yükseltme, araştırma, yoldaki sevkiyat, sözleşme penceresi). Geri sayım bu sütunlardan gelir.
- Zamanlayıcı kip açıkken en çok 1 sn'de bir tur atar; sevkiyat varışı ve pencere açılışı her turda denetlenir.
- Kapsam dışı: sözleşme vadesi/ek süresi, teklif son geçerliliği, navlun işi son tarihi, kredi taksitleri, günlük bakım
  ve sistem döngüleri (son tarihler/ekonomi takvimi), oturumlar, hız sınırları, temizlik görevleri.
- Kapatma: Yönetim → Oyuncu Yönetimi → "Oyun testi kipi" kartı → Kapat (veya ayarlarda `pace.playtestSeconds = 0`).
  60 dk tempo tavanı (`pace.maxMinutes`) ayrı bir ayardır.

## Doğrulama
`apps/server/src/test/players-playtest.int.test.ts`, `packages/economy/src/pace.test.ts`.
