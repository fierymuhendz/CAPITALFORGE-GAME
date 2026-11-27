# Şirket Muhasebesi ve ilk satış akışı

Hedef: yeni oyuncu yardım almadan üretir, ürünü depoda görür, satar ve satışın muhasebesini açar. Her şirketin yalnız kendi defterini gördüğü "Şirket Muhasebesi" (EN "Company Accounting") sayfası.

## Sunucu (`apps/server/src/finance/accounting.ts`)

- `GET /finance/accounting?period=today|7d|30d` → `AccountingDto`: kasa (şimdi), dönem geliri, toplam gider (cogs dahil), net; hesap kalemleri; oyun günü başına gelir/gider; nakit akışı (açılış + faaliyet + yatırım + finansman = kapanış).
- `GET /finance/accounting/transactions?period&before&beforeId&limit` → işlem başına bir satır (kasa etkisi, gelir, gider, satış kimliği, ters kayıt bağı); imleç (zaman, kimlik), `before` ve `beforeId` birlikte.
- Şirket yalnız oturumdan; her sorgu `ledger_accounts.company_id` ile süzülür; yanıtlar `cache-control: private, no-store`.
- Oyun günü İstanbul saati (UTC+3, sabit). "Bugün" yerel gece yarısından şimdiye; 7/30 gün bugünle birlikte takvim günleri.
- Gelir yalnız gelir hesapları; kredi anaparası (`loans`), başlangıç sermayesi ve yönetici ayarı (`equity`) gelir değildir. Stok alışı `inventory`e yazılır, gider satışta `cogs` olarak bir kez doğar.
- Ters kayıt kendi kayıt anına düşer; nakit akışında düzelttiği işlemin grubunda sayılır. `admin_balance_adjust` finansman grubunda.
- Satış izi (`/finance/sales/:id`): `viewerRole`; alıcıya satıcının maliyeti, navlunu, komisyonu, kârı, defter işlem kimlikleri ve işlem kayıtları verilmez.

## Arayüz

- Panel `finance` = Şirket Muhasebesi; varsayılan görünüm muhasebe. URL: `view` (accounting, sales, results, loans, ledger), `period`, `sale`. Eski `/play?tab=finance`, `?tab=sales` ve kredi işlemleri çalışır.
- Ana ekranda "Şirket Muhasebesi" düğmesi (tek dokunuş).
- Üretim bitti bildirimi ve tesisteki "Son üretim → Depoda aç" ürünü depoda açar (`tab=inventory&product&city&quality`).
- Depo/pano → pazar "Sat": `side, product, city, quality, qty` URL'de; yenilemede korunur.
- Satış sonrası "Satış tamamlandı" penceresi → "Satışın muhasebesini aç".
- Üretim başlayamıyorsa eylem çubuğunda "20 kg buğday eksik" + "20 kg buğday al" (pazara, tesise dönüş bağlantısıyla); nakit yetmiyorsa kredi.

## Açık konular

- Yönetici ters kaydı `sales` satırını güncellemez (satış listesi ile defter ayrışabilir); muhasebe özeti defterden hesaplandığı için doğru kalır.
- `shipment_arrive` kayıtları varış anına (`arrivesAt`) tarihlenir; geç çalışan zamanlayıcı geçmiş güne yazabilir.
